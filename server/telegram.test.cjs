const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramService, encrypt, decrypt, chatId } = require('./telegram.cjs');

const token = '123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345';
const env = { TELEGRAM_CREDENTIALS_KEY: 'ab'.repeat(32), LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' };
const bot = { id: 123456789, first_name: 'Test Bot', username: 'test_bot', can_read_all_group_messages: true };
function fixture(options = {}) {
  let stored;
  const calls = [];
  const pool = {
    async query() { return [[]]; },
    async execute(sql, params) {
      if (sql.startsWith('SELECT')) return [stored ? [{ encrypted_payload: stored }] : []];
      stored = params[0]; return [{ affectedRows: 1 }];
    },
  };
  const fetchImpl = async (url, init) => {
    const method = url.split('/').at(-1);
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (options.fetch) return options.fetch(method, init);
    const results = {
      getMe: bot, getWebhookInfo: { url: options.webhook || '', pending_update_count: 1 },
      getUpdates: [{ update_id: 42, message: { message_id: 10, date: 1793808000, chat: { id: -1001234567890, title: 'Testing' }, from: { username: 'tester' }, text: 'hello' } }],
      sendMessage: { message_id: 11, date: 1793808000, chat: { id: -1001234567890, title: 'Testing' }, text: 'test message' },
    };
    return { ok: true, json: async () => ({ ok: true, result: results[method] }) };
  };
  const service = createTelegramService({ env: options.env || env, createPool: () => pool, fetchImpl });
  return { service, calls, get stored() { return stored; }, pool, fetchImpl };
}

test('encrypts with randomized authenticated ciphertext and rejects tampering or a different key', () => {
  const key = Buffer.from(env.TELEGRAM_CREDENTIALS_KEY, 'hex');
  const first = encrypt({ token }, key);
  assert.notEqual(first, encrypt({ token }, key));
  assert.equal(first.includes(token), false);
  assert.deepEqual(decrypt(first, key), { token });
  assert.throws(() => decrypt(first, Buffer.alloc(32)), /unlock/);
  const tampered = JSON.parse(first); tampered.data = Buffer.alloc(32).toString('base64');
  assert.throws(() => decrypt(tampered, key), /unlock/);
});

test('saves verified credentials encrypted and reloads across service instances without exposing the token', async () => {
  const f = fixture();
  assert.equal((await f.service.getConfig()).configured, false);
  const saved = await f.service.saveConfig({ token, defaultChatId: '-1001234567890' });
  assert.equal(saved.bot.username, 'test_bot');
  assert.equal(saved.configured, true);
  assert.equal(JSON.stringify(saved).includes(token), false);
  assert.equal(f.stored.includes(token), false);
  const second = createTelegramService({ env, createPool: () => f.pool, fetchImpl: f.fetchImpl });
  assert.deepEqual(await second.getConfig(), saved);
  await second.saveConfig({ token: '', defaultChatId: '12345678' });
  assert.equal((await second.getConfig()).defaultChatId, '12345678');
  assert.deepEqual(f.calls.map(call => call.method), ['getMe', 'getMe']);
});

test('requires a dedicated encryption key and validates token/chat before contacting Telegram', async () => {
  const missing = fixture({ env: { ...env, TELEGRAM_CREDENTIALS_KEY: '' } });
  await assert.rejects(missing.service.getConfig(), error => error.status === 503 && /TELEGRAM_CREDENTIALS_KEY/.test(error.message));
  const f = fixture();
  await assert.rejects(f.service.saveConfig({ token: 'bad' }), /valid bot token/);
  await assert.rejects(f.service.saveConfig({ token, defaultChatId: 'https://t.me/+invite' }), /Invite links/);
  await assert.rejects(f.service.sendMessage({ text: '' }), /4,096/);
  await assert.rejects(f.service.sendMessage({ text: 'x'.repeat(4097) }), /4,096/);
  assert.equal(f.calls.length, 0);
  assert.equal(chatId('123456'), '123456');
  assert.equal(chatId('@channel'), '@channel');
});

test('provisions the bot from a runtime secret once without returning the token or overwriting app settings', async () => {
  const f = fixture({ env: { ...env, TELEGRAM_BOT_TOKEN: token } });
  const config = await f.service.getConfig();
  assert.equal(config.configured, true);
  assert.equal(config.bot.username, 'test_bot');
  assert.equal(JSON.stringify(config).includes(token), false);
  assert.equal(f.stored.includes(token), false);
  assert.deepEqual(f.calls.map(call => call.method), ['getMe']);
  await f.service.saveConfig({ token: token + 'x', defaultChatId: '@new_chat' });
  const saved = f.stored;
  assert.equal((await f.service.getConfig()).defaultChatId, '@new_chat');
  assert.equal(f.stored, saved);
  assert.equal(f.calls.length, 2);
});

test('rejects invalid runtime tokens before contacting Telegram and allows manual recovery', async () => {
  const f = fixture({ env: { ...env, TELEGRAM_BOT_TOKEN: 'invalid' } });
  await assert.rejects(f.service.getConfig(), /TELEGRAM_BOT_TOKEN/);
  assert.equal(f.calls.length, 0);
  await f.service.saveConfig({ token });
  assert.equal((await f.service.getConfig()).configured, true);
});

test('polls only with the durable receiver offset and subscribes to new and edited chat messages', async () => {
  const f = fixture();
  await f.service.saveConfig({ token });
  const status = await f.service.testConnection();
  assert.equal(status.webhookActive, false);
  assert.equal(status.bot.canReadAllGroupMessages, true);
  const updates = await f.service.receiveUpdates({ botId: bot.id, offset: 42 });
  assert.equal(updates[0].message.text, 'hello');
  assert.deepEqual(f.calls.find(call => call.method === 'getUpdates').body, { timeout: 0, limit: 100, offset: 42, allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'] });
  await f.service.receiveUpdates({ botId: bot.id });
  assert.equal(Object.hasOwn(f.calls.filter(call => call.method === 'getUpdates')[1].body, 'offset'), false);
  assert.ok(f.calls.every(call => ['getMe', 'getWebhookInfo', 'getUpdates'].includes(call.method)));
});

test('preserves an existing webhook and does not try polling it', async () => {
  const f = fixture({ webhook: 'https://existing.example/secret' });
  await f.service.saveConfig({ token });
  await assert.rejects(f.service.receiveUpdates({ botId: bot.id }), error => error.status === 409 && !error.message.includes('existing.example'));
  assert.ok(f.calls.every(call => ['getMe', 'getWebhookInfo'].includes(call.method)));
});

test('does not apply a previous bot cursor after changing the configured bot', async () => {
  const f = fixture();
  await f.service.saveConfig({ token });
  await assert.rejects(f.service.receiveUpdates({ botId: 999, offset: 100 }), error => error.status === 409);
  assert.equal(f.calls.some(call => call.method === 'getUpdates'), false);
});

test('sends exactly once using only the requested destination and text', async () => {
  const f = fixture();
  await f.service.saveConfig({ token, defaultChatId: '@default_channel' });
  await f.service.sendMessage({ chatId: '-1001234567890', text: 'test message' });
  const sent = f.calls.filter(call => call.method === 'sendMessage');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { chat_id: '-1001234567890', text: 'test message' });
});

test('automated receipts cannot send through a replacement bot', async () => {
  const f = fixture();
  await f.service.saveConfig({ token });
  await assert.rejects(f.service.sendMessage({ chatId: '-1001234567890', expectedBotId: '999', text: 'receipt' }), /original bot/);
  assert.equal(f.calls.filter(call => call.method === 'sendMessage').length, 0);
});

test('marks send network timeouts as uncertain so card retries cannot duplicate delivery', async () => {
  const f = fixture();
  await f.service.saveConfig({ token });
  const service = createTelegramService({ env, createPool: () => f.pool, fetchImpl: async () => { throw new Error('network timeout'); } });
  await assert.rejects(service.sendMessage({ chatId: '-100123', text: 'test message' }), error => error.deliveryUncertain === true && error.telegramSafe && /Check the chat/.test(error.message));
});

test('does not replace a working saved token when Telegram rejects a replacement', async () => {
  const f = fixture({ fetch: method => ({ ok: true, json: async () => ({ ok: true, result: bot }) }) });
  await f.service.saveConfig({ token });
  const before = f.stored;
  // Use the same database, but a failing Telegram client.
  const failing = createTelegramService({ env, createPool: () => f.pool, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: token }) }) });
  await assert.rejects(failing.saveConfig({ token: token + 'x' }), error => error.status === 400 && !error.message.includes(token));
  assert.equal(f.stored, before);
});

test('sanitizes Telegram and network errors so token URLs cannot leak', async () => {
  for (const fetchImpl of [async () => { throw new Error(`https://api.telegram.org/bot${token}/getMe`); }, async () => ({ ok: false, status: 500, json: async () => ({ ok: false, description: token }) })]) {
    const f = fixture();
    const service = createTelegramService({ env, createPool: () => f.pool, fetchImpl });
    await assert.rejects(service.saveConfig({ token }), error => error.telegramSafe && !error.message.includes(token));
    assert.equal(f.stored, undefined);
  }
});

async function mediaFixture({ file = {}, download } = {}) {
  const f = fixture();
  await f.service.saveConfig({ token });
  const calls = [];
  const service = createTelegramService({ env, createPool: () => f.pool, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/getFile')) return { ok: true, json: async () => ({ ok: true, result: { file_path: 'photos/file_1.jpg', ...file } }) };
    return download ? download(url, init) : new Response(Buffer.from([255, 216, 255, 0]), { headers: { 'content-type': 'application/octet-stream' } });
  } });
  return { service, calls };
}

test('downloads Telegram images server-side as data URLs and detects MIME type from bytes', async () => {
  const f = await mediaFixture();
  const result = await f.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' });
  assert.equal(result, 'data:image/jpeg;base64,/9j/AA==');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { file_id: 'saved-photo' });
  assert.equal(f.calls[1].url, `https://api.telegram.org/file/bot${token}/photos/file_1.jpg`);
  assert.equal(f.calls[1].init.redirect, 'error');
  assert.equal(f.calls[1].init.method, 'GET');
  assert.equal(result.includes(token), false);
});

test('blocks wrong bots, invalid paths, unsupported image bytes and oversize images', async () => {
  const f = await mediaFixture();
  await assert.rejects(f.service.downloadImage({ botId: 999, fileId: 'saved-photo' }), /different Telegram bot/);
  await assert.rejects(f.service.downloadImage({ botId: bot.id, fileId: 'saved-photo', fileSize: 11 * 1024 * 1024 }), /10 MB/);
  assert.equal(f.calls.length, 0);
  for (const file_path of ['../secret.jpg', 'https://other.example/image.jpg', '/photos/a.jpg', 'photos/../a.jpg']) {
    const bad = await mediaFixture({ file: { file_path } });
    await assert.rejects(bad.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.telegramSafe && /usable image/.test(error.message));
    assert.equal(bad.calls.length, 1);
  }
  const badBytes = await mediaFixture({ download: () => new Response('<html>not an image</html>') });
  await assert.rejects(badBytes.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.status === 415);
  const tooLarge = await mediaFixture({ file: { file_size: 11 * 1024 * 1024 } });
  await assert.rejects(tooLarge.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.status === 413);
  assert.equal(tooLarge.calls.length, 1);
});

test('bounds downloads using both headers and streamed bytes', async () => {
  const largeHeader = await mediaFixture({ download: () => new Response('small', { headers: { 'content-length': String(11 * 1024 * 1024) } }) });
  await assert.rejects(largeHeader.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.status === 413);
  const largeStream = await mediaFixture({ download: () => new Response(Buffer.alloc(11 * 1024 * 1024)) });
  await assert.rejects(largeStream.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.status === 413);
});

test('sanitizes download errors and marks transient failures for parsing retries', async () => {
  for (const download of [() => { throw new Error(`https://api.telegram.org/file/bot${token}/photos/a.jpg`); }, () => new Response('secret provider details', { status: 503 })]) {
    const f = await mediaFixture({ download });
    await assert.rejects(f.service.downloadImage({ botId: bot.id, fileId: 'saved-photo' }), error => error.telegramSafe && error.retryable && !error.message.includes(token) && !error.message.includes('secret provider'));
  }
});
