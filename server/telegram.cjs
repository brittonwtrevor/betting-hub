const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');

const failure = (message, status = 400) => Object.assign(new Error(message), { status, telegramSafe: true });
const aad = Buffer.from('betting-hub:telegram:v1');

function encryptionKey(env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.TELEGRAM_CREDENTIALS_KEY || '')) {
    throw failure('Set TELEGRAM_CREDENTIALS_KEY to a 64-character hex key in the server runtime environment to enable secure Telegram storage.', 503);
  }
  return Buffer.from(env.TELEGRAM_CREDENTIALS_KEY, 'hex');
}
function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(value, key) {
  try {
    const sealed = typeof value === 'string' ? JSON.parse(value) : value;
    if (sealed.v !== 1) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw failure('Unable to unlock Telegram credentials. Restore the original TELEGRAM_CREDENTIALS_KEY.', 503); }
}
function chatId(value, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string') throw failure('Enter a numeric chat ID or @channel username.');
  const id = value.trim();
  if (optional && !id) return '';
  if (!/^-?[1-9]\d{0,19}$/.test(id) && !/^@[A-Za-z0-9_]{5,32}$/.test(id)) throw failure('Enter a numeric chat ID or @channel username. Invite links cannot be used to send messages.');
  return id;
}
const publicConfig = config => ({ configured: !!config, bot: config?.bot || null, defaultChatId: config?.defaultChatId || '', savedAt: config?.savedAt || null });
function messageView(message, updateId, kind) {
  return {
    updateId, kind, messageId: message.message_id,
    date: message.date ? new Date(message.date * 1000).toISOString() : null,
    chatId: String(message.chat?.id ?? ''),
    chat: message.chat?.title || message.chat?.username || message.chat?.first_name || 'Unknown chat',
    from: message.from?.username || [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.sender_chat?.title || '',
    text: message.text || message.caption || '[Non-text message]',
  };
}

function createTelegramService({ env = process.env, createPool, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  let pool;
  let schema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = pool.query(`CREATE TABLE IF NOT EXISTS hub_telegram_settings (
      id TINYINT PRIMARY KEY, encrypted_payload JSON NOT NULL,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    )`).catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function load(bootstrap = true) {
    const key = encryptionKey(env);
    const db = await database();
    const [[row]] = await db.execute('SELECT encrypted_payload FROM hub_telegram_settings WHERE id = 1');
    if (row) return decrypt(row.encrypted_payload, key);
    if (!bootstrap || !env.TELEGRAM_BOT_TOKEN) return null;
    const token = env.TELEGRAM_BOT_TOKEN.trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw failure('Check the TELEGRAM_BOT_TOKEN runtime setting.', 503);
    const bot = await call(token, 'getMe');
    const config = { token, defaultChatId: '', bot: { id: bot.id, username: bot.username || '', name: bot.first_name || '' }, savedAt: now().toISOString() };
    // Provision once from the encrypted runtime secret; never replace settings saved in the app.
    await db.execute('INSERT INTO hub_telegram_settings (id, encrypted_payload) VALUES (1, ?) ON DUPLICATE KEY UPDATE id = id', [encrypt(config, key)]);
    const [[saved]] = await db.execute('SELECT encrypted_payload FROM hub_telegram_settings WHERE id = 1');
    return decrypt(saved.encrypted_payload, key);
  }
  async function required() {
    const config = await load();
    if (!config) throw failure('Save your Telegram bot token first.', 409);
    return config;
  }
  async function call(token, method, body = {}) {
    // Never propagate fetch errors or Telegram descriptions: either can contain the token URL or user text.
    let response;
    let data;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000), redirect: 'error',
      });
      data = await response.json();
    } catch { throw Object.assign(failure(method === 'sendMessage' ? 'Telegram did not confirm delivery. Check the chat before retrying to avoid a duplicate message.' : 'Unable to reach Telegram. Please try again.', 502), { deliveryUncertain: method === 'sendMessage' }); }
    if (!response.ok || data?.ok !== true) {
      const code = data?.error_code || response.status;
      if (code === 401 || code === 404) throw failure('Telegram rejected the bot token. Check the token from BotFather.', 400);
      if (code === 403) throw failure('The bot cannot access that chat. Start the bot in a private chat, or add it to the group/channel with permission to post.', 400);
      if (code === 409) throw failure('Telegram receiving is already in use by a webhook or another reader. This app has not changed it.', 409);
      if (code === 429) throw failure('Telegram rate limit reached. Wait before trying again.', 429);
      throw failure(method === 'sendMessage' ? 'Telegram rejected this message. Check the chat ID and bot permissions.' : 'Telegram could not complete this request. Try again.', 502);
    }
    return data.result;
  }
  async function inspect(config) {
    const bot = await call(config.token, 'getMe');
    const webhook = await call(config.token, 'getWebhookInfo');
    return { bot: { id: bot.id, username: bot.username || '', name: bot.first_name || '', canReadAllGroupMessages: !!bot.can_read_all_group_messages }, webhookActive: !!webhook.url, pendingUpdates: webhook.pending_update_count || 0 };
  }
  return {
    async getConfig() { return publicConfig(await load()); },
    async saveConfig(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Enter the Telegram connection details.');
      if (input.token != null && typeof input.token !== 'string') throw failure('Enter a valid bot token from BotFather.');
      const key = encryptionKey(env);
      const previous = await load(false);
      const token = input.token?.trim() || previous?.token;
      if (!token || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw failure('Enter a valid bot token from BotFather.');
      const defaultChatId = chatId(input.defaultChatId, true);
      const bot = await call(token, 'getMe');
      const config = { token, defaultChatId, bot: { id: bot.id, username: bot.username || '', name: bot.first_name || '' }, savedAt: now().toISOString() };
      const db = await database();
      await db.execute('INSERT INTO hub_telegram_settings (id, encrypted_payload) VALUES (1, ?) ON DUPLICATE KEY UPDATE encrypted_payload = VALUES(encrypted_payload)', [encrypt(config, key)]);
      return publicConfig(config);
    },
    async testConnection() { return inspect(await required()); },
    async receiveUpdates({ botId, offset } = {}) {
      const config = await required();
      if (String(config.bot.id) !== String(botId)) throw failure('The Telegram bot changed. Receiving will resume with the saved bot on the next poll.', 409);
      const webhook = await call(config.token, 'getWebhookInfo');
      if (webhook.url) throw failure('This bot already has a webhook. Remove it from the previous integration before enabling polling. The webhook has been left in place.', 409);
      return call(config.token, 'getUpdates', {
        timeout: 0, limit: 100,
        ...(offset == null ? {} : { offset }),
        allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
      });
    },
    async sendMessage(input) {
      if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096) throw failure('Enter a message between 1 and 4,096 characters.');
      const config = await required();
      const id = chatId(input.chatId || config.defaultChatId);
      const message = await call(config.token, 'sendMessage', { chat_id: id, text: input.text });
      return { message: messageView(message, null, 'sent') };
    },
    async close() { if (pool) await pool.end(); },
  };
}
module.exports = { createTelegramService, encrypt, decrypt, chatId };
