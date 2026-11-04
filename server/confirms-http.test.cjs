const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHandler } = require('./index.cjs');
const auth = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;
function fixture(service) {
  const handler = createHandler({ username: 'test-user', password: 'test-password', directory: path.join(__dirname, '..', 'public'), confirmsService: service });
  return async (url, options = {}) => {
    const req = Readable.from([options.raw ?? JSON.stringify(options.body || {})]);
    Object.assign(req, { url, method: options.method || 'GET', socket: {}, headers: { authorization: auth, 'x-forwarded-proto': 'https', 'x-betting-hub': 'confirms', 'content-type': 'application/json', ...options.headers } });
    const result = {};
    await handler(req, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body?.toString() || ''; } });
    return result;
  };
}
test('confirmation reads and grading enforce login, HTTPS, same-site JSON and size limits', async () => {
  let writes = 0;
  const request = fixture({ async list() { return { sources: [] }; }, async update() { writes++; return {}; } });
  const url = '/api/confirms/bets/test-bet';
  const edit = { method: 'PATCH' };
  assert.equal((await request('/api/confirms', { headers: { authorization: '' } })).status, 401);
  assert.equal((await request('/api/confirms', { headers: { 'x-forwarded-proto': 'http' } })).status, 426);
  assert.equal((await request(url, { ...edit, headers: { 'x-betting-hub': '' } })).status, 403);
  assert.equal((await request(url, { ...edit, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(url, { ...edit, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(url, { ...edit, raw: '{' })).status, 400);
  assert.equal((await request(url, { ...edit, raw: 'x'.repeat(32769) })).status, 413);
  assert.equal(writes, 0);
  assert.equal((await request(url, edit)).status, 200);
  assert.equal((await request('/api/confirms', { method: 'HEAD' })).body, '');
  assert.equal((await request('/api/confirms')).headers['Cache-Control'], 'private, no-store');
});
test('routes manual additions and retries by source ID and keeps errors sanitized', async () => {
  const calls = [];
  const request = fixture({ async addManual(...args) { calls.push(['manual', ...args]); return {}; }, async retry(...args) { calls.push(['retry', ...args]); return { queued: true }; } });
  for (const action of ['manual', 'retry']) assert.equal((await request(`/api/confirms/sources/${'a'.repeat(64)}/${action}`, { method: 'POST', body: { revision: 1 } })).status, 200);
  assert.equal(calls[0][3], 'test-user');
  assert.equal((await request('/api/confirms', { method: 'POST' })).status, 405);
  const failed = fixture({ async list() { throw new Error('private-host password=secret'); } });
  assert.doesNotMatch((await failed('/api/confirms')).body, /private-host|secret/);
});
