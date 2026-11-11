const { createHash, randomUUID } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');
const { normalizeFields } = require('../src/features/bets/confirmationFields');
const { fullSplitBps, splitError, splitToBps, splitAmount } = require('../src/features/partners/split');
const { createConfirmParser, eligibleContexts, partnerFor, defaultFields } = require('./confirm-parser.cjs');
const { recordMetadata, migrateRecords, iso } = require('./confirm-record.cjs');
const { createConfirmNotifications } = require('./confirm-notifications.cjs');
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, confirmSafe: true });
const sourceId = message => createHash('sha256').update(JSON.stringify([String(message.botId), String(message.chatId), String(message.messageId)])).digest('hex');

function reportSplit(bps, risk, profit) {
  return { splitPercent: bps / 100, yourRisk: splitAmount(risk, bps), yourShare: splitAmount(profit, bps) };
}

function createConfirmsService({ env = process.env, telegramReceiver, sendsService, telegramService, partnersService,
  parser = createConfirmParser({ env, readImages: message => telegramReceiver.readImages(message) }),
  createPool, now = () => new Date(), makeId = randomUUID, logger = console } = {}) {
  let pool, schema, timer, pending, notificationTimer, notificationPending;
  let stopping = false;
  let workerError = null;
  const notifications = createConfirmNotifications({ telegramService, now, logger });
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
      await migrateRecords(pool);
      await notifications.ensure(pool);
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
    const [[origin]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [source]);
    fields = { ...fields, ...recordMetadata(decode(origin.payload), fields, at) };
    try {
      fields.splitBps = await partnersService?.findSplitBps(fields.partnerId) ?? fullSplitBps;
    } catch {
      throw Object.assign(fail('Could not load the partner split. The reply will retry.', 503), { retryable: true });
    }
    await connection.execute('INSERT INTO hub_confirm_bets (id, source_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, source, JSON.stringify(fields), at, at]);
    await history(connection, source, id, actor === 'AI' ? 'ai_extract' : 'manual_add', null, fields, actor);
    if (actor === 'AI') await notifications.enqueue(connection, source, id, 1, 'logged', fields);
    return { id, sourceId: source, revision: 1, createdAt: at, updatedAt: at, ...fields };
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
  function notificationTick() {
    if (stopping || !telegramService) return Promise.resolve();
    if (!notificationPending) notificationPending = (async () => {
      try { await notifications.flush(await database()); } catch { /* The next scheduled pass retries storage access. */ }
    })().finally(() => { notificationPending = null; });
    return notificationPending;
  }
  function tick() {
    if (stopping) return Promise.resolve();
    if (!pending) pending = (async () => {
      await runWorker();
      await notificationTick();
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    tick,
    start() {
      if (timer) return;
      stopping = false;
      timer = setInterval(() => { void tick(); }, 10000); timer.unref?.();
      // Grade receipts must not wait behind a slow batch of LLM requests.
      notificationTimer = setInterval(() => { void notificationTick(); }, 10000); notificationTimer.unref?.();
      void tick(); void notificationTick();
    },
    async listReportBets({ includeIncomplete = false } = {}) {
      const db = await database();
      const [rows] = await db.query(`SELECT id, bet_id, partner_id, partner_name, bet_date, bet_at,
        game, team, bet, sport, league, risk, odds, grade, partial_return, pl, graded_at, raw_response, revision, split_bps
        FROM hub_confirm_bets
        WHERE deleted_at IS NULL${includeIncomplete ? '' : ` AND risk IS NOT NULL AND odds IS NOT NULL
          AND game <> '' AND team <> '' AND bet <> ''`}
        ORDER BY bet_date DESC, bet_at DESC, id`);
      return rows.map(row => {
        const stake = row.risk === null ? null : Number(row.risk);
        const settledProfit = row.pl === null ? null : Number(row.pl);
        return {
          id: row.id, revision: row.revision, betId: row.bet_id, partnerId: row.partner_id, partnerName: row.partner_name,
          betDate: row.bet_date, placedAt: row.bet_at, event: row.game, selection: row.bet, team: row.team,
          sport: row.sport, league: row.league, stake, odds: row.odds,
          status: row.grade, partialReturn: row.partial_return === null ? null : Number(row.partial_return),
          settledProfit, gradedAt: row.graded_at, rawResponse: row.raw_response || '',
          ...reportSplit(row.split_bps ?? fullSplitBps, stake, settledProfit),
        };
      });
    },
    async list() {
      const receiver = await sync();
      const db = await database();
      const [rows] = await db.query('SELECT * FROM hub_confirm_sources ORDER BY updated_at DESC, id');
      const sources = [];
      // Bound each IN query while allowing the date filter to reach the full history.
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const ids = batch.map(row => row.id);
        const placeholders = ids.map(() => '?').join(', ');
        const [bets] = await db.execute(`SELECT * FROM hub_confirm_bets WHERE source_id IN (${placeholders}) ORDER BY created_at, id`, ids);
        const [receipts] = await db.execute(`SELECT id, bet_row_id, kind, status, last_error, updated_at FROM hub_confirm_notifications
          WHERE source_id IN (${placeholders}) ORDER BY created_at, bet_revision, id`, ids);
        for (const row of batch) {
          const payload = decode(row.payload);
          const savedBets = bets.filter(bet => bet.source_id === row.id).map(bet => ({ ...bet, fields: decode(bet.payload) }));
          const byBet = new Map(savedBets.map(bet => [bet.id, bet.fields]));
          const contexts = eligibleContexts(payload.message);
          const sports = [...new Set(contexts.map(item => item.context.game.sport).filter(Boolean))];
          sources.push({ id: row.id, revision: row.revision, status: row.status, ...payload, sports, eligibleBetIds: contexts.map(item => item.betId),
            error: row.last_error, deletedBetCount: savedBets.filter(bet => bet.fields.deletedAt).length,
            deletionNotifications: receipts.filter(receipt => receipt.kind === 'delete' && byBet.has(receipt.bet_row_id))
              .map(receipt => ({ id: receipt.id, kind: receipt.kind, status: receipt.status, error: receipt.last_error, updatedAt: receipt.updated_at,
                betId: byBet.get(receipt.bet_row_id).betId })),
            bets: savedBets.filter(bet => !bet.fields.deletedAt).map(bet => ({ id: bet.id, sourceId: row.id,
              revision: bet.revision, createdAt: bet.created_at, updatedAt: bet.updated_at, ...bet.fields,
              notifications: receipts.filter(receipt => receipt.bet_row_id === bet.id).map(receipt => ({ id: receipt.id, kind: receipt.kind, status: receipt.status, error: receipt.last_error, updatedAt: receipt.updated_at })) })) });
        }
      }
      return { sources,
      receiver, parser: { configured: parser.configured(), enabled: env.DO_INFERENCE_ENABLED !== 'false', model: parser.model(), error: workerError } };
    },
    async update(id, input, actor = 'app') {
      if (!Number.isInteger(input?.revision)) throw fail('Refresh Confirms before saving.');
      let fields = normalizeFields(input);
      const [send] = await sendsService.findByBetIds([fields.betId]);
      if (!send) throw fail('This Bet ID does not exist in Sends.');
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This bet no longer exists. Refresh Confirms.', 404);
        if (row.revision !== input.revision) throw fail('This bet changed on another screen. Refresh Confirms before saving.', 409);
        const before = decode(row.payload);
        if (before.deletedAt) throw fail('This bet was deleted. Refresh Confirms.', 409);
        const at = now().toISOString();
        const [[source]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ?', [row.source_id]);
        const metadata = recordMetadata(decode(source.payload), fields, at);
        const game = send.context?.game;
        // Only the bettor's display name and bet date are editable attribution.
        const bettorName = input.bettorName === undefined ? before.bettorName : input.bettorName;
        if (typeof bettorName !== 'string' || !bettorName.trim() || bettorName.trim().length > 200) throw fail('Enter the person who placed this bet (maximum 200 characters).');
        const betDate = input.betDate === undefined ? before.betDate : input.betDate;
        if (typeof betDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(betDate) || !Number.isFinite(Date.parse(`${betDate}T00:00:00Z`)) || new Date(`${betDate}T00:00:00Z`).toISOString().slice(0, 10) !== betDate) throw fail('Enter a valid bet date.');
        const regraded = before.grade !== fields.grade || before.pl !== fields.pl || before.partialReturn !== fields.partialReturn;
        fields = { ...before, ...fields, bettorName: bettorName.trim(), betDate,
          // Correcting the Bet ID also corrects game metadata from that send.
          ...(before.betId !== fields.betId ? { gameAt: game ? iso(game.begin_at) : metadata.gameAt,
            gameId: game?.match_id || game?.game_id || metadata.gameId, sport: game?.sport || metadata.sport, league: game?.league || metadata.league } : {}),
          gradedAt: fields.grade === 'UNGRADED' ? null : regraded ? at : before.gradedAt };
        await connection.execute('UPDATE hub_confirm_bets SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [JSON.stringify(fields), now().toISOString(), id]);
        await history(connection, row.source_id, id, before.grade !== fields.grade || before.pl !== fields.pl ? 'grade' : 'edit', before, fields, actor);
        if (regraded) await notifications.enqueue(connection, row.source_id, id, row.revision + 1, 'grade', fields);
        return { id, sourceId: row.source_id, revision: row.revision + 1, createdAt: row.created_at, updatedAt: at, ...fields };
      });
    },
    async updateSplit(id, input, actor = 'app') {
      if (!Number.isInteger(input?.revision)) throw fail('Refresh the bet report before saving.');
      const splitBps = splitToBps(input.splitPercent);
      if (splitBps === null) throw fail(splitError);
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This bet no longer exists. Refresh the bet report.', 404);
        const before = decode(row.payload);
        if (before.deletedAt || row.revision !== input.revision) throw fail('This bet changed. Refresh the bet report before saving.', 409);
        const share = reportSplit(splitBps, before.risk, before.pl);
        if (splitBps === (before.splitBps ?? fullSplitBps)) return { id, revision: row.revision, ...share };
        const after = { ...before, splitBps };
        await connection.execute('UPDATE hub_confirm_bets SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          [JSON.stringify(after), now().toISOString(), id]);
        await history(connection, row.source_id, id, 'split_edit', before, after, actor);
        return { id, revision: row.revision + 1, ...share };
      });
    },
    async remove(id, input, actor = 'app') {
      if (!Number.isInteger(input?.revision)) throw fail('Refresh Confirms before deleting.');
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_bets WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This bet no longer exists. Refresh Confirms.', 404);
        if (row.revision !== input.revision) throw fail('This bet changed on another screen. Refresh Confirms before deleting.', 409);
        const before = decode(row.payload);
        if (before.deletedAt) throw fail('This bet was already deleted. Refresh Confirms.', 409);
        const at = now().toISOString();
        const after = { ...before, deletedAt: at };
        await connection.execute('UPDATE hub_confirm_bets SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [JSON.stringify(after), at, id]);
        await history(connection, row.source_id, id, 'delete', before, after, actor);
        await connection.execute("UPDATE hub_confirm_notifications SET status = 'cancelled', updated_at = ? WHERE bet_row_id = ? AND status IN ('pending', 'error')", [at, id]);
        const notification = await notifications.enqueue(connection, row.source_id, id, row.revision + 1, 'delete', after);
        return { id, sourceId: row.source_id, revision: row.revision + 1, deletedAt: at, notification };
      });
    },
    async addManual(id, input, actor = 'app') {
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT * FROM hub_confirm_sources WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw fail('This reply no longer exists. Refresh Confirms.', 404);
        if (row.revision !== input?.revision) throw fail('This reply changed. Refresh Confirms before adding a bet.', 409);
        const { message } = decode(row.payload);
        const context = eligibleContexts(message).find(item => item.betId === input.betId);
        if (input.betId !== undefined && !context) throw fail('This Bet ID is unavailable for manual entry from this reply.');
        const fields = normalizeFields(defaultFields(message, context));
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
    async close() { stopping = true; clearInterval(timer); clearInterval(notificationTimer); timer = null;
      await Promise.all([pending, notificationPending]); if (pool) await pool.end(); },
  };
}
module.exports = { createConfirmsService, sourceId };
