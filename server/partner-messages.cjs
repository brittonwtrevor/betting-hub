const { mysqlOptions } = require('./lol.cjs');
const { chatId } = require('./telegram.cjs');

const invalid = (message, status = 400) => Object.assign(new Error(message), { status, partnerMessageSafe: true });
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const view = (row, deliveries) => ({ id: row.id, text: row.message_text, createdAt: row.created_at,
  deliveries: deliveries.map(delivery => ({ channel: delivery.channel, partners: decode(delivery.partner_names), status: delivery.status,
    sentAt: delivery.sent_at, messageId: delivery.telegram_message_id, error: delivery.error })) });

function normalize(input) {
  if (!validId(input?.id)) throw invalid('Invalid message ID. Refresh this page.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096) throw invalid('Enter a message between 1 and 4,096 characters.');
  if (!Array.isArray(input.partnerIds) || !input.partnerIds.length || input.partnerIds.length > 500 ||
      input.partnerIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw invalid('Select between 1 and 500 saved partners.');
  return { id: input.id, text: input.text, partnerIds: [...new Set(input.partnerIds)].sort() };
}

function createPartnerMessagesService({ env = process.env, createPool, partnersService, telegramService, now = () => new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let pool, schema, timer, running, stopped = false;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_partner_messages (
        id CHAR(36) NOT NULL PRIMARY KEY, message_text TEXT NOT NULL,
        partner_ids JSON NOT NULL, bot_id VARCHAR(32) NOT NULL, created_at VARCHAR(24) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_partner_message_deliveries (
        message_id CHAR(36) NOT NULL, channel VARCHAR(64) NOT NULL, partner_names JSON NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'pending', attempted_at VARCHAR(24) NULL,
        sent_at VARCHAR(24) NULL, telegram_message_id BIGINT NULL, error VARCHAR(300) NOT NULL DEFAULT '',
        PRIMARY KEY (message_id, channel), INDEX pending_messages (status, message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function transaction(work) {
    const connection = await (await database()).getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async function get(id) {
    if (!validId(id)) throw invalid('Invalid message ID.');
    const db = await database();
    const [[row]] = await db.execute('SELECT * FROM hub_partner_messages WHERE id = ?', [id]);
    if (!row) throw invalid('This message was not found.', 404);
    const [deliveries] = await db.execute('SELECT * FROM hub_partner_message_deliveries WHERE message_id = ? ORDER BY channel', [id]);
    return view(row, deliveries);
  }
  async function add(input) {
    const message = normalize(input);
    const db = await database();
    const [[existing]] = await db.execute('SELECT * FROM hub_partner_messages WHERE id = ?', [message.id]);
    if (existing) {
      if (existing.message_text !== message.text || JSON.stringify(decode(existing.partner_ids)) !== JSON.stringify(message.partnerIds)) throw invalid('This message ID was already used for different content or partners.', 409);
      return get(message.id);
    }
    const partners = await partnersService.list();
    const destinations = new Map();
    for (const id of message.partnerIds) {
      const partner = partners.find(item => item.id === id);
      if (!partner) throw invalid('A selected partner no longer exists. Refresh partners.');
      let channel;
      try { channel = chatId(partner.telegramChannel).toLowerCase(); }
      catch { throw invalid(`Add a numeric Telegram chat ID or public @channel for ${partner.name} in Partner Accounting.`); }
      if (!destinations.has(channel)) destinations.set(channel, []);
      destinations.get(channel).push(partner.name);
    }
    const config = await telegramService.getConfig();
    if (!config.configured || !config.bot?.id) throw invalid('Configure the Telegram bot before sending messages.', 409);
    try {
      await transaction(async connection => {
        await connection.execute('INSERT INTO hub_partner_messages (id, message_text, partner_ids, bot_id, created_at) VALUES (?, ?, ?, ?, ?)',
          [message.id, message.text, JSON.stringify(message.partnerIds), String(config.bot.id), now().toISOString()]);
        for (const [channel, names] of destinations) await connection.execute(
          'INSERT INTO hub_partner_message_deliveries (message_id, channel, partner_names) VALUES (?, ?, ?)', [message.id, channel, JSON.stringify(names)]);
      });
    } catch (error) {
      // A repeated click or a lost HTTP response must reuse the original receipt.
      if (error.code === 'ER_DUP_ENTRY') return add(message);
      throw error;
    }
    return get(message.id);
  }
  async function processQueue() {
    const db = await database();
    // A stopped process may have posted to Telegram before saving its receipt.
    // These deliveries require checking the chat and are never automatically retried.
    await db.execute("UPDATE hub_partner_message_deliveries SET status = 'uncertain', error = ? WHERE status = 'sending' AND attempted_at < ?",
      ['Delivery was interrupted. Check this Telegram channel before sending the message again.', new Date(now().getTime() - 120000).toISOString()]);
    while (!stopped) {
      const delivery = await transaction(async connection => {
        const [[row]] = await connection.execute(`SELECT d.*, m.message_text, m.bot_id FROM hub_partner_message_deliveries d
          JOIN hub_partner_messages m ON m.id = d.message_id WHERE d.status = 'pending' ORDER BY m.created_at, d.channel LIMIT 1 FOR UPDATE`);
        if (!row) return null;
        await connection.execute("UPDATE hub_partner_message_deliveries SET status = 'sending', attempted_at = ?, error = '' WHERE message_id = ? AND channel = ?",
          [now().toISOString(), row.message_id, row.channel]);
        return row;
      });
      if (!delivery) break;
      let outcome;
      try {
        const result = await telegramService.sendMessage({ chatId: delivery.channel, text: delivery.message_text, expectedBotId: delivery.bot_id });
        outcome = ['sent', now().toISOString(), result.message.messageId, ''];
      } catch (error) {
        const uncertain = error.deliveryUncertain || !error.telegramSafe;
        outcome = [uncertain ? 'uncertain' : 'failed', null, null,
          error.telegramSafe ? error.message.slice(0, 300) : 'Delivery could not be confirmed. Check this Telegram channel before sending again.'];
      }
      await db.execute('UPDATE hub_partner_message_deliveries SET status = ?, sent_at = ?, telegram_message_id = ?, error = ? WHERE message_id = ? AND channel = ?',
        [...outcome, delivery.message_id, delivery.channel]);
      await pause(100);
    }
  }
  function processPending() {
    if (!running) running = processQueue().finally(() => { running = null; });
    return running;
  }
  return {
    add, get, processPending,
    async list() {
      const db = await database();
      const [rows] = await db.query('SELECT * FROM hub_partner_messages ORDER BY created_at DESC, id DESC LIMIT 30');
      if (!rows.length) return [];
      const [deliveries] = await db.execute(`SELECT * FROM hub_partner_message_deliveries WHERE message_id IN (${rows.map(() => '?').join(',')}) ORDER BY channel`, rows.map(row => row.id));
      return rows.map(row => view(row, deliveries.filter(delivery => delivery.message_id === row.id)));
    },
    async retry(id) {
      await get(id);
      // Confirmed deliveries and uncertain outcomes remain untouched.
      await (await database()).execute("UPDATE hub_partner_message_deliveries SET status = 'pending', error = '' WHERE message_id = ? AND status = 'failed'", [id]);
      return get(id);
    },
    start() {
      if (timer) return;
      stopped = false;
      const tick = () => { void processPending().catch(() => {}); };
      timer = setInterval(tick, 1500);
      timer.unref?.();
      tick();
    },
    async close() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      if (running) await running.catch(() => {});
      if (pool) await pool.end();
    },
  };
}
module.exports = { createPartnerMessagesService, normalize };
