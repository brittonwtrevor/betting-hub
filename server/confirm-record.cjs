const { eligibleContexts, partnerFor } = require('./confirm-parser.cjs');

const iso = value => {
  if (!value) return null;
  const text = String(value).replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const easternDate = value => value ? new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value)) : '';

// Attribution comes from the archived send and Telegram event, never from the LLM.
function recordMetadata(source, fields, at) {
  const { message } = source;
  const contexts = eligibleContexts(message).filter(item => item.betId === fields.betId);
  const partner = contexts.length ? partnerFor(message, contexts) : source.partner;
  const game = contexts[0]?.context.game;
  const betAt = iso(message.date) || iso(message.receivedAt);
  return {
    recordVersion: 2, partnerId: partner?.id || `telegram:${message.chatId}`, partnerName: partner?.name || message.chat,
    bettorName: message.senderName || message.from || partner?.name || '',
    telegramBotId: String(message.botId), telegramChatId: String(message.chatId), telegramChatName: message.chat,
    telegramMessageId: String(message.messageId), telegramSenderId: message.senderId ? String(message.senderId) : null,
    telegramSenderName: message.senderName || message.from || '', telegramSenderUsername: message.senderUsername || '',
    betDate: easternDate(betAt), betAt, receivedAt: iso(message.receivedAt),
    gameAt: iso(game?.begin_at), sport: game?.sport || '', league: game?.league || '',
    gameId: game?.match_id || game?.game_id || '',
    rawResponse: message.text || '',
    gradedAt: fields.grade !== 'UNGRADED' ? at : null, deletedAt: null,
  };
}

// Queryable columns are generated from the current JSON record. A single UPDATE
// therefore changes both the app record and its reporting columns atomically.
const columns = {
  bet_id: ['CHAR(6)', 'betId'], game: ['VARCHAR(400)', 'game'], team: ['VARCHAR(200)', 'team'], bet: ['VARCHAR(300)', 'bet'],
  risk: ['DECIMAL(12,2)', 'risk'], odds: ['INT', 'odds'], grade: ['VARCHAR(16)', 'grade'],
  partial_return: ['DECIMAL(12,2)', 'partialReturn'], pl: ['DECIMAL(16,2)', 'pl'],
  partner_id: ['VARCHAR(100)', 'partnerId'], partner_name: ['VARCHAR(200)', 'partnerName'], bettor_name: ['VARCHAR(200)', 'bettorName'],
  telegram_bot_id: ['VARCHAR(32)', 'telegramBotId'], telegram_chat_id: ['VARCHAR(32)', 'telegramChatId'],
  telegram_chat_name: ['VARCHAR(255)', 'telegramChatName'], telegram_message_id: ['VARCHAR(32)', 'telegramMessageId'],
  telegram_sender_id: ['VARCHAR(32)', 'telegramSenderId'], telegram_sender_name: ['VARCHAR(255)', 'telegramSenderName'],
  telegram_sender_username: ['VARCHAR(64)', 'telegramSenderUsername'],
  bet_date: ['VARCHAR(10)', 'betDate'], bet_at: ['VARCHAR(24)', 'betAt'], received_at: ['VARCHAR(24)', 'receivedAt'],
  game_at: ['VARCHAR(24)', 'gameAt'], graded_at: ['VARCHAR(24)', 'gradedAt'], deleted_at: ['VARCHAR(24)', 'deletedAt'],
  sport: ['VARCHAR(40)', 'sport'], league: ['VARCHAR(200)', 'league'], game_id: ['VARCHAR(100)', 'gameId'],
  raw_response: ['TEXT', 'rawResponse'],
  split_bps: ['SMALLINT UNSIGNED', 'splitBps'],
};

async function migrateRecords(pool) {
  const db = await pool.getConnection();
  let locked = false, reusable = true;
  try {
    const [[lock]] = await db.execute("SELECT GET_LOCK('betting-hub:confirm-schema', 30) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Confirmation schema migration is busy.');
    locked = true;
    const [existing] = await db.query('SHOW COLUMNS FROM hub_confirm_bets');
    const names = new Set(existing.map(column => column.Field));
    const additions = Object.entries(columns).filter(([name]) => !names.has(name)).map(([name, [type, field]]) =>
      `ADD COLUMN ${name} ${type} GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.${field}')), 'null')) STORED`);
    const [indexes] = await db.query('SHOW INDEX FROM hub_confirm_bets');
    if (!indexes.some(index => index.Key_name === 'partner_bet_dates')) additions.push('ADD INDEX partner_bet_dates (partner_id, bet_date, deleted_at)');
    if (!indexes.some(index => index.Key_name === 'sender_bet_dates')) additions.push('ADD INDEX sender_bet_dates (telegram_sender_id, bet_date)');
    if (additions.length) await db.query(`ALTER TABLE hub_confirm_bets ${additions.join(', ')}`);

    // Fill only missing snapshots; later Telegram edits cannot replace them.
    await db.query(`UPDATE hub_confirm_bets b JOIN hub_confirm_sources s ON s.id = b.source_id
      SET b.payload = JSON_SET(b.payload, '$.rawResponse', COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.payload, '$.message.text')), 'null'), ''))
      WHERE JSON_EXTRACT(b.payload, '$.rawResponse') IS NULL`);

    const [legacy] = await db.query(`SELECT b.id, b.payload, b.updated_at, s.bot_id, s.update_id, s.payload AS source_payload
      FROM hub_confirm_bets b JOIN hub_confirm_sources s ON s.id = b.source_id
      WHERE JSON_EXTRACT(b.payload, '$.recordVersion') IS NULL`);
    for (const row of legacy) {
      const source = typeof row.source_payload === 'string' ? JSON.parse(row.source_payload) : row.source_payload;
      const fields = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const [[original]] = await db.execute('SELECT sender_id, raw_update, kind FROM hub_telegram_inbox WHERE bot_id = ? AND update_id = ?', [row.bot_id, row.update_id]);
      const raw = typeof original?.raw_update === 'string' ? JSON.parse(original.raw_update) : original?.raw_update;
      const event = raw?.[original?.kind];
      source.message = { ...source.message, senderId: event?.from?.id || source.message.senderId,
        senderName: event?.from ? [event.from.first_name, event.from.last_name].filter(Boolean).join(' ') : source.message.senderName,
        senderUsername: event?.from?.username || source.message.senderUsername };
      // Merge only metadata, preserving any concurrent bet/grade correction.
      await db.execute(`UPDATE hub_confirm_bets SET payload = JSON_MERGE_PATCH(payload, ?)
        WHERE id = ? AND JSON_EXTRACT(payload, '$.recordVersion') IS NULL`,
      [JSON.stringify(recordMetadata(source, fields, row.updated_at)), row.id]);
    }
  } finally {
    if (locked) {
      try { await db.execute("SELECT RELEASE_LOCK('betting-hub:confirm-schema')"); }
      catch { reusable = false; db.destroy(); }
    }
    if (reusable) db.release();
  }
}
module.exports = { recordMetadata, migrateRecords, columns, iso };
