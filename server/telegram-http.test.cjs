const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHandler } = require('./index.cjs');
const auth = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;
const headers = { authorization: auth, 'x-forwarded-proto': 'https', 'x-betting-hub': 'telegram', 'content-type': 'application/json' };
function fixture(service, receiver) {
  const handler = createHandler({ username: 'test-user', password: 'test-password', directory: path.join(__dirname, '..', 'public'), telegramService: service, telegramReceiver: receiver });
  return async (url, options = {}) => {
    const req = Readable.from([options.raw ?? JSON.stringify(options.body || {})]);
    Object.assign(req, { url, method: options.method || 'POST', socket: {}, headers: { ...headers, ...options.headers } });
    const result = {};
    await handler(req, { writeHead(status, values) { result.status = status; result.headers = values; }, end(body) { result.body = body?.toString() || ''; } });
    return result;
  };
}

test('Telegram routes enforce login, TLS, same-site JSON writes, and body limits before service access', async () => {
  let calls = 0;
  const request = fixture({ async saveConfig() { calls++; return { configured: true }; } });
  const url = '/api/telegram/config';
  const options = { method: 'PUT', body: { token: 'test' } };
  assert.equal((await request(url, { ...options, headers: { authorization: '' } })).status, 401);
  assert.equal((await request(url, { ...options, headers: { 'x-forwarded-proto': 'http' } })).status, 426);
  assert.equal((await request(url, { ...options, headers: { 'x-betting-hub': '' } })).status, 403);
  assert.equal((await request(url, { ...options, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(url, { ...options, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(url, { ...options, raw: '{' })).status, 400);
  assert.equal((await request(url, { ...options, raw: 'x'.repeat(32769) })).status, 413);
  assert.equal(calls, 0);
  assert.equal((await request(url, options)).status, 200);
  assert.equal(calls, 1);
});

test('dispatches only supported operations and keeps config responses uncached and HEAD body-free', async () => {
  const calls = [];
  const service = Object.fromEntries(['getConfig', 'saveConfig', 'testConnection', 'sendMessage', 'readInbox'].map(method => [method, async body => { calls.push([method, body]); return { configured: true }; }]));
  const request = fixture(service, service);
  const config = await request('/api/telegram/config', { method: 'GET' });
  assert.equal(config.status, 200);
  assert.equal(config.headers['Cache-Control'], 'private, no-store');
  assert.equal((await request('/api/telegram/config', { method: 'HEAD' })).body, '');
  for (const action of ['test', 'updates', 'messages']) {
    assert.equal((await request(`/api/telegram/${action}`, { method: 'GET' })).status, 405);
    assert.equal((await request(`/api/telegram/${action}`, { method: 'HEAD' })).status, 405);
    assert.equal((await request(`/api/telegram/${action}`, { body: { text: 'test' } })).status, 200);
  }
  assert.deepEqual(calls.map(call => call[0]), ['getConfig', 'getConfig', 'testConnection', 'readInbox', 'sendMessage']);
  assert.equal((await request('/api/telegram/unknown')).status, 405);
});

test('saved inbox requires authentication and never bypasses storage to read Telegram directly', async () => {
  let reads = 0;
  const request = fixture({}, { async readInbox() { reads++; return { messages: [] }; } });
  assert.equal((await request('/api/telegram/updates', { headers: { authorization: '' } })).status, 401);
  assert.equal(reads, 0);
  assert.equal((await request('/api/telegram/updates')).status, 200);
  assert.equal(reads, 1);
  assert.equal((await fixture({})('/api/telegram/updates')).status, 503);
});

test('service failures do not expose credentials or connection details', async () => {
  const failed = fixture({ async getConfig() { throw new Error('private-host password=secret token=123'); } });
  const result = await failed('/api/telegram/config', { method: 'GET' });
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.body, /private-host|secret|123/);
  const missing = fixture();
  assert.equal((await missing('/api/telegram/config', { method: 'GET' })).status, 503);
});
