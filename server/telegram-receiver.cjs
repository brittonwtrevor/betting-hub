const { mysqlOptions } = require('./lol.cjs');
const { messageImage } = require('./telegram-media.cjs');

const POLL_INTERVAL_MS = 10000;
const messageKinds = ['message', 'edited_message', 'channel_post', 'edited_channel_post'];
// Letters/digits inside another word do not identify a send. Preserve the input verbatim.
function extractBetIds(text) {
  return [...new Set(Array.from(text.matchAll(/(?<![A-Za-z0-9_])[A-Za-z]{3}\d{3}(?![A-Za-z0-9_])/g), match => match[0].toUpperCase()))];
}
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value;
const safeError = error => error.telegramSafe ? error.message : error.code === 'DB_NOT_CONFIGURED'
  ? 'Configure the app database before receiving Telegram messages.'
  : 'Telegram messages could not be saved. Receiving will retry without advancing past unsaved updates.';

function createTelegramReceiver({ telegramService, sendsService, env = process.env, createPool,
  now = () => new Date(), logger = console, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  let pool;
  let schema;
  let timer;
  let pending;
  let stopping = false;
  let lastLocalError = null;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_telegram_poll_state (
        bot_id BIGINT PRIMARY KEY, next_offset BIGINT NULL,
        last_update_at_ms BIGINT NULL, last_poll_at_ms BIGINT NULL, last_error TEXT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_telegram_inbox (
        bot_id BIGINT NOT NULL, update_id BIGINT NOT NULL, kind VARCHAR(64) NOT NULL,
        chat_id BIGINT NULL, message_id BIGINT NULL, sender_id BIGINT NULL,
        raw_text MEDIUMTEXT NOT NULL, candidate_bet_ids JSON NOT NULL,
        raw_update JSON NOT NULL, received_at VARCHAR(24) NOT NULL,
        PRIMARY KEY (bot_id, update_id), INDEX chat_messages (bot_id, chat_id, message_id),
        INDEX received_messages (bot_id, received_at, update_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_telegram_message_bets (
        bot_id BIGINT NOT NULL, update_id BIGINT NOT NULL, bet_id CHAR(6) NOT NULL,
        draft_id VARCHAR(36) NOT NULL, send_context JSON NULL,
        PRIMARY KEY (bot_id, update_id, bet_id), INDEX bet_messages (bet_id, bot_id, update_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    })().catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function pollOnce() {
    let connection;
    let lockName;
    let locked = false;
    let botId;
    try {
      const config = await telegramService.getConfig();
      if (!config.configured) throw Object.assign(new Error('Set TELEGRAM_BOT_TOKEN in DigitalOcean runtime settings to start receiving.'), { telegramSafe: true });
      botId = String(config.bot.id);
      const db = await database();
      connection = await db.getConnection();
      // Session lock elects one reader across server replicas and rolling deployments.
      lockName = `betting-hub:telegram:${botId}`;
      const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      if (Number(lock.acquired) !== 1) return { skipped: true };
      locked = true;
      await connection.execute('INSERT INTO hub_telegram_poll_state (bot_id) VALUES (?) ON DUPLICATE KEY UPDATE bot_id = bot_id', [botId]);
      const [[state]] = await connection.execute('SELECT * FROM hub_telegram_poll_state WHERE bot_id = ?', [botId]);
      // Telegram randomizes IDs after a week without new updates. Old pending updates
      // have expired by then, so omit the stale offset to discover the new sequence.
      let offset = state.next_offset == null ? undefined : Number(state.next_offset);
      if (state.last_update_at_ms != null && now().getTime() - Number(state.last_update_at_ms) >= 7 * 86400000) offset = undefined;
      let count = 0;
      for (let batch = 0; batch < 10 && !stopping; batch++) {
        const updates = await telegramService.receiveUpdates({ botId, offset });
        if (!Array.isArray(updates) || updates.some(update => !Number.isSafeInteger(update.update_id) || update.update_id < 0)) throw new Error('Invalid Telegram update batch.');
        const records = updates.map(update => {
          const kind = messageKinds.find(key => update[key]) || Object.keys(update).find(key => key !== 'update_id') || 'unknown';
          const message = messageKinds.includes(kind) ? update[kind] : null;
          const text = message?.text ?? message?.caption ?? '';
          return { update, kind, message, text, ids: extractBetIds(text) };
        });
        const ids = [...new Set(records.flatMap(record => record.ids))];
        const sends = new Map((ids.length ? await sendsService.findByBetIds(ids) : []).map(send => [send.betId, send]));
        const receivedAt = now();
        const nextOffset = updates.length ? Math.max(...updates.map(update => update.update_id)) + 1 : offset;
        await connection.beginTransaction();
        try {
          for (const { update, kind, message, text, ids: candidates } of records) {
            // A repeated delivery leaves the original event intact; edits have their
            // own update IDs and are appended as separate events.
            await connection.execute(`INSERT INTO hub_telegram_inbox
              (bot_id, update_id, kind, chat_id, message_id, sender_id, raw_text, candidate_bet_ids, raw_update, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE update_id = update_id`,
            [botId, update.update_id, kind, message?.chat?.id ?? null, message?.message_id ?? null,
              message?.from?.id ?? message?.sender_chat?.id ?? null, text, JSON.stringify(candidates), JSON.stringify(update), receivedAt.toISOString()]);
            for (const betId of candidates) {
              const send = sends.get(betId);
              if (!send) continue;
              await connection.execute(`INSERT INTO hub_telegram_message_bets (bot_id, update_id, bet_id, draft_id, send_context)
                VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE bet_id = bet_id`,
              [botId, update.update_id, betId, send.draftId, send.context == null ? null : JSON.stringify(send.context)]);
            }
          }
          await connection.execute(`UPDATE hub_telegram_poll_state SET next_offset = ?, last_poll_at_ms = ?,
            last_update_at_ms = COALESCE(?, last_update_at_ms), last_error = NULL WHERE bot_id = ?`,
          [nextOffset ?? null, receivedAt.getTime(), updates.length ? receivedAt.getTime() : null, botId]);
          await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        // Only the NEXT request acknowledges these events, after their transaction commits.
        offset = nextOffset;
        count += updates.length;
        if (updates.length < 100) break;
      }
      lastLocalError = null;
      return { updateCount: count };
    } catch (error) {
      const message = safeError(error);
      if (locked) {
        try { await connection.execute('UPDATE hub_telegram_poll_state SET last_error = ? WHERE bot_id = ?', [message, botId]); }
        catch { /* The committed cursor remains the recovery point if MySQL is unavailable. */ }
      }
      if (lastLocalError !== message) logger.error(`Telegram receiver: ${message}`);
      lastLocalError = message;
      return { error: message };
    } finally {
      if (connection) {
        let reusable = true;
        if (locked) {
          try { await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]); }
          catch { reusable = false; connection.destroy(); }
        }
        if (reusable) connection.release();
      }
    }
  }
  function poll() {
    if (stopping) return Promise.resolve({ skipped: true });
    if (!pending) pending = pollOnce().finally(() => { pending = null; });
    return pending;
  }
  return {
    poll,
    async readImages(message) {
      // Read the original event, including events imported before image support.
      // File IDs or external URLs supplied by clients are never used here.
      const db = await database();
      const [[row]] = await db.execute(`SELECT kind, raw_update FROM hub_telegram_inbox
        WHERE bot_id = ? AND update_id = ? AND chat_id = ? AND message_id = ?`,
      [message.botId, message.updateId, message.chatId, message.messageId]);
      if (!row) throw Object.assign(new Error('The original Telegram attachment is unavailable. Resend the screenshot.'), { confirmSafe: true });
      const original = parseJson(row.raw_update)[row.kind];
      const image = messageImage(original);
      if (!image) return [];
      return [await telegramService.downloadImage({ botId: message.botId, ...image })];
    },
    start() {
      if (timer || env.TELEGRAM_POLLING_ENABLED === 'false') return;
      stopping = false;
      timer = setIntervalImpl(() => { void poll(); }, POLL_INTERVAL_MS);
      timer.unref?.();
      void poll();
    },
    async readInbox({ forParsing = false } = {}) {
      const config = await telegramService.getConfig();
      if (!config.configured) return { messages: [], updateCount: 0, fetchedAt: now().toISOString(), receiver: { intervalMs: POLL_INTERVAL_MS, error: lastLocalError } };
      const db = await database();
      const botId = String(config.bot.id);
      const [rows] = await db.execute(`SELECT inbox.*, COALESCE((SELECT JSON_ARRAYAGG(bets.bet_id)
        FROM hub_telegram_message_bets bets WHERE bets.bot_id = inbox.bot_id AND bets.update_id = inbox.update_id), JSON_ARRAY()) AS matched_bet_ids,
        COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('betId', context.bet_id, 'draftId', context.draft_id, 'context', context.send_context))
        FROM hub_telegram_message_bets context WHERE context.bot_id = inbox.bot_id AND context.update_id = inbox.update_id), JSON_ARRAY()) AS send_contexts
        FROM hub_telegram_inbox inbox WHERE bot_id = ? AND message_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM hub_telegram_message_bets linked
          WHERE linked.bot_id = inbox.bot_id AND linked.update_id = inbox.update_id AND (
            JSON_CONTAINS(JSON_EXTRACT(linked.send_context, '$.recipients[*].telegramChannel'), JSON_QUOTE(CAST(inbox.chat_id AS CHAR)))
            OR JSON_CONTAINS(LOWER(JSON_EXTRACT(linked.send_context, '$.recipients[*].telegramChannel')),
              JSON_QUOTE(LOWER(CONCAT('@', JSON_UNQUOTE(JSON_EXTRACT(inbox.raw_update, CONCAT('$.', inbox.kind, '.chat.username')))))))
            OR JSON_CONTAINS(JSON_EXTRACT(linked.send_context, '$.deliveries[*].chatId'), JSON_QUOTE(CAST(inbox.chat_id AS CHAR)))
          ))
        ${forParsing ? `AND NOT EXISTS (SELECT 1 FROM hub_confirm_sources imported WHERE imported.bot_id = inbox.bot_id
          AND imported.chat_id = inbox.chat_id AND imported.message_id = inbox.message_id AND imported.update_id = inbox.update_id)
        AND NOT EXISTS (SELECT 1 FROM hub_telegram_inbox newer WHERE newer.bot_id = inbox.bot_id AND newer.chat_id = inbox.chat_id
          AND newer.message_id = inbox.message_id AND (newer.received_at > inbox.received_at
          OR (newer.received_at = inbox.received_at AND newer.update_id > inbox.update_id)))` : ''}
        ORDER BY received_at DESC, update_id DESC LIMIT 100`, [botId]);
      const [[state]] = await db.execute('SELECT * FROM hub_telegram_poll_state WHERE bot_id = ?', [botId]);
      const messages = rows.map(row => {
        const update = parseJson(row.raw_update);
        const message = update[row.kind];
        return {
          botId: String(row.bot_id), updateId: Number(row.update_id), kind: row.kind, messageId: Number(row.message_id),
          date: message.date ? new Date(message.date * 1000).toISOString() : null,
          chatId: String(row.chat_id), chatUsername: message.chat?.username || '', chat: message.chat?.title || message.chat?.username || message.chat?.first_name || 'Unknown chat',
          from: message.from?.username || [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.sender_chat?.title || '',
          senderId: message.from?.id == null ? null : String(message.from.id),
          senderName: message.from ? [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') : '',
          senderUsername: message.from?.username || '',
          text: row.raw_text, hasMedia: !message.text && !!(message.photo || message.document || message.video || message.voice || message.audio || message.sticker),
          candidateBetIds: parseJson(row.candidate_bet_ids), betIds: parseJson(row.matched_bet_ids), contexts: parseJson(row.send_contexts) || [], receivedAt: row.received_at,
        };
      });
      return { messages, updateCount: messages.length, fetchedAt: now().toISOString(), receiver: {
        enabled: env.TELEGRAM_POLLING_ENABLED !== 'false', intervalMs: POLL_INTERVAL_MS, lastPolledAt: state?.last_poll_at_ms == null ? null : new Date(Number(state.last_poll_at_ms)).toISOString(),
        error: state?.last_error || lastLocalError,
      } };
    },
    async close() {
      stopping = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
      if (pending) await pending;
      if (pool) await pool.end();
    },
  };
}

module.exports = { createTelegramReceiver, extractBetIds, POLL_INTERVAL_MS };
