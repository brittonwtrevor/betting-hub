const { createHash, randomUUID } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');
const { normalizeFields } = require('../src/features/bets/confirmationFields');
const { createConfirmParser, eligibleContexts, partnerFor, defaultFields } = require('./confirm-parser.cjs');
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, confirmSafe: true });
const sourceId = message => createHash('sha256').update(JSON.stringify([String(message.botId), String(message.chatId), String(message.messageId)])).digest('hex');

function createConfirmsService({ env = process.env, telegramReceiver, sendsService, parser = createConfirmParser({ env }),
  createPool, now = () => new Date(), makeId = randomUUID, logger = console } = {}) {
  let pool, schema, timer, pending;
  let stopping = false;
  let workerError = null;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_confirm_sources (
        id CHAR(64) PRIMARY KEY, bot_id BIGINT NOT NULL, chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL,
        update_id BIGINT NOT NULL, revision INT NOT NULL DEFAULT 1, status VARCHAR(16) NOT NULL,
        payload JSON NOT NULL, attempts INT NOT NULL DEFAULT 0, retry_at_ms BIGINT NOT NULL DEFAULT 0,
        lease_until_ms BIGINT NOT NULL DEFAULT 0, last_error TEXT NULL,
        created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL,
        UNIQUE KEY telegram_message (bot_id, chat_id, message_id), INDEX pending_sources (status, retry_at_ms)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_confirm_bets (
        id VARCHAR(36) PRIMARY KEY, source_id CHAR(64) NOT NULL, revision INT NOT NULL DEFAULT 1,
        payload JSON NOT NULL, created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL,
        INDEX source_bets (source_id, created_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_confirm_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, source_id CHAR(64) NOT NULL, bet_row_id VARCHAR(36) NULL,
        action VARCHAR(32) NOT NULL, actor VARCHAR(200) NOT NULL, payload JSON NOT NULL, created_at VARCHAR(24) NOT NULL,
        INDEX source_history (source_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    })().catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function transaction(work) {
    const db = await database();
    const connection = await db.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async function history(db, source, bet, action, before, after, actor = 'system') {
    await db.execute('INSERT INTO hub_confirm_history (source_id, bet_row_id, action, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [source, bet, action, actor, JSON.stringify({ before, after }), now().toISOString()]);
  }
  async function sync() {
    await database();
    const inbox = await telegramReceiver.readInbox({ forParsing: true });
    for (const message of inbox.messages) {
      const contexts = eligibleContexts(message);
      if (!contexts.length) continue;
      const id = sourceId(message);
      const at = now().toISOString();
      await transaction(async connection => {
        const payload = { message, partner: partnerFor(message, contexts), issues: [] };
        await connection.execute(`INSERT INTO hub_confirm_sources
          (id, bot_id, chat_id, message_id, update_id, status, payload, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
        [id, message.botId, message.chatId, message.messageId, message.updateId, JSON.stringify(payload), at, at]);
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [id]);
        if (Number(row.update_id) === Number(message.updateId)) return;
        const previous = decode(row.payload);
        // A stale concurrent sync must never restore an older edit.
        if (previous.message.receivedAt > message.receivedAt || (previous.message.receivedAt === message.receivedAt && previous.message.updateId > message.updateId)) return;
        const [bets] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE source_id = ?', [id]);
        payload.issues = bets.length ? ['Telegram reply edited. Existing bets and grades were kept; review them against the latest raw reply.'] : [];
        await connection.execute(`UPDATE hub_confirm_sources SET update_id = ?, payload = ?, status = ?, revision = revision + 1,
          attempts = 0, retry_at_ms = 0, lease_until_ms = 0, last_error = NULL, updated_at = ? WHERE id = ?`,
        [message.updateId, JSON.stringify(payload), bets.length ? 'review' : 'pending', at, id]);
        await history(connection, id, null, 'telegram_edit', previous, payload);
      });
    }
    return inbox.receiver;
  }
  async function insertBet(connection, source, fields, actor) {
    const id = makeId();
    const at = now().toISOString();
    await connection.execute('INSERT INTO hub_confirm_bets (id, source_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, source, JSON.stringify(fields), at, at]);
    await history(connection, source, id, actor === 'AI' ? 'ai_extract' : 'manual_add', null, fields, actor);
    return { id, sourceId: source, revision: 1, ...fields };
  }
  async function runWorker() {
    let connection, locked = false;
    try {
      await sync();
      if (!parser.configured() || env.DO_INFERENCE_ENABLED === 'false' || stopping) return;
      const db = await database();
      connection = await db.getConnection();
      const [[lock]] = await connection.execute("SELECT GET_LOCK('betting-hub:confirm-parser', 0) AS acquired");
      if (Number(lock.acquired) !== 1) return;
      locked = true;
      // Bound paid work per pass. Stale processing leases recover after a crash.
      const [sources] = await connection.execute(`SELECT * FROM hub_confirm_sources WHERE
        (status = 'pending' OR (status = 'error' AND attempts < 3 AND retry_at_ms <= ?) OR (status = 'processing' AND lease_until_ms <= ?))
        ORDER BY created_at, id LIMIT 5`, [now().getTime(), now().getTime()]);
      for (const source of sources) {
        if (stopping) break;
        const [claimed] = await connection.execute("UPDATE hub_confirm_sources SET status = 'processing', attempts = attempts + 1, lease_until_ms = ?, last_error = NULL WHERE id = ? AND revision = ?",
          [now().getTime() + 60000, source.id, source.revision]);
        if (!claimed.affectedRows) continue;
        try {
          const result = await parser.parse(decode(source.payload).message);
          await transaction(async tx => {
            const [[current]] = await tx.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [source.id]);
            const [existing] = await tx.execute('SELECT * FROM hub_confirm_bets WHERE source_id = ?', [source.id]);
            // Human corrections/additions and newer Telegram edits always win.
            if (current.revision !== source.revision || current.status !== 'processing' || existing.length) return;
            for (const fields of result.bets) await insertBet(tx, source.id, fields, 'AI');
            const payload = { ...decode(current.payload), issues: result.issues, model: result.model, usage: result.usage };
            const status = !result.bets.length || result.issues.length || result.bets.some(bet => !bet.complete) ? 'review' : 'parsed';
            await tx.execute('UPDATE hub_confirm_sources SET status = ?, payload = ?, revision = revision + 1, lease_until_ms = 0, last_error = NULL, updated_at = ? WHERE id = ?',
              [status, JSON.stringify(payload), now().toISOString(), source.id]);
          });
        } catch (error) {
          const message = error.confirmSafe ? error.message : 'AI extraction could not be saved. The raw reply is preserved.';
          await connection.execute(`UPDATE hub_confirm_sources SET status = 'error', last_error = ?, retry_at_ms = ?,
            attempts = ?, lease_until_ms = 0, updated_at = ? WHERE id = ? AND revision = ? AND status = 'processing'`,
          [message, now().getTime() + 60000, error.retryable ? Number(source.attempts) + 1 : 3, now().toISOString(), source.id, source.revision]);
        }
      }
      workerError = null;
    } catch {
      const message = 'Confirmation processing is unavailable. Saved Telegram replies remain preserved.';
      if (workerError !== message) logger.error(message);
      workerError = message;
    } finally {
      if (connection) {
        let reusable = true;
        if (locked) {
          try { await connection.execute("SELECT RELEASE_LOCK('betting-hub:confirm-parser')"); }
          catch { reusable = false; connection.destroy(); }
        }
        if (reusable) connection.release();
      }
    }
  }
  function tick() {
    if (stopping) return Promise.resolve();
    if (!pending) pending = runWorker().finally(() => { pending = null; });
    return pending;
  }
  return {
    tick,
    start() { if (timer) return; stopping = false; timer = setInterval(() => { void tick(); }, 10000); timer.unref?.(); void tick(); },
    async list() {
      const receiver = await sync();
      const db = await database();
      const [sources] = await db.query('SELECT * FROM hub_confirm_sources ORDER BY updated_at DESC, id LIMIT 100');
      const ids = sources.map(row => row.id);
      const [bets] = ids.length ? await db.execute(`SELECT * FROM hub_confirm_bets WHERE source_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at, id`, ids) : [[]];
      return { sources: sources.map(row => ({ id: row.id, revision: row.revision, status: row.status, ...decode(row.payload),
        error: row.last_error, bets: bets.filter(bet => bet.source_id === row.id).map(bet => ({ id: bet.id, sourceId: row.id, revision: bet.revision, ...decode(bet.payload) })) })),
      receiver, parser: { configured: parser.configured(), enabled: env.DO_INFERENCE_ENABLED !== 'false', model: parser.model(), error: workerError } };
    },
    async update(id, input, actor = 'app') {
      if (!Number.isInteger(input?.revision)) throw fail('Refresh Confirms before saving.');
      const fields = normalizeFields(input);
      if (!(await sendsService.findByBetIds([fields.betId])).length) throw fail('This Bet ID does not exist in Sends.');
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This bet no longer exists. Refresh Confirms.', 404);
        if (row.revision !== input.revision) throw fail('This bet changed on another screen. Refresh Confirms before saving.', 409);
        const before = decode(row.payload);
        await connection.execute('UPDATE hub_confirm_bets SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [JSON.stringify(fields), now().toISOString(), id]);
        await history(connection, row.source_id, id, before.grade !== fields.grade || before.pl !== fields.pl ? 'grade' : 'edit', before, fields, actor);
        return { id, sourceId: row.source_id, revision: row.revision + 1, ...fields };
      });
    },
    async addManual(id, input, actor = 'app') {
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This reply no longer exists. Refresh Confirms.', 404);
        if (row.revision !== input?.revision) throw fail('This reply changed. Refresh Confirms before adding a bet.', 409);
        const fields = normalizeFields(defaultFields(decode(row.payload).message));
        const bet = await insertBet(connection, id, fields, actor);
        await connection.execute("UPDATE hub_confirm_sources SET status = 'manual', revision = revision + 1, lease_until_ms = 0, last_error = NULL, updated_at = ? WHERE id = ?", [now().toISOString(), id]);
        return bet;
      });
    },
    async retry(id, input) {
      if (!parser.configured()) throw fail('Add the DigitalOcean model access key in server settings to enable AI parsing.', 503);
      await transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This reply no longer exists. Refresh Confirms.', 404);
        const [bets] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE source_id = ?', [id]);
        if (row.revision !== input?.revision || row.status === 'processing') throw fail('This reply changed or is being parsed. Refresh Confirms.', 409);
        if (bets.length) throw fail('Edit the existing bets. AI will not replace saved bets or grades.', 409);
        await connection.execute("UPDATE hub_confirm_sources SET status = 'pending', attempts = 0, retry_at_ms = 0, last_error = NULL, revision = revision + 1 WHERE id = ?", [id]);
      });
      return { queued: true };
    },
    async close() { stopping = true; clearInterval(timer); timer = null; if (pending) await pending; if (pool) await pool.end(); },
  };
}
module.exports = { createConfirmsService, sourceId };
