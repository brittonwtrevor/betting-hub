const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHandler } = require('./index.cjs');
const id = '9709b3c0-bddd-4ad0-8e9b-2c6c53f98a11';
function fixture(service) {
  const handler = createHandler({ username: 'user', password: 'password', directory: path.join(__dirname, '..', 'public'), partnerMessagesService: service });
  return async (url, options = {}) => {
    const request = Readable.from([options.raw ?? JSON.stringify(options.body || {})]);
    Object.assign(request, { url, method: options.method || 'GET', socket: {}, headers: {
      authorization: `Basic ${Buffer.from('user:password').toString('base64')}`, 'x-forwarded-proto': 'https',
      'x-betting-hub': 'partner-messages', 'content-type': 'application/json', ...options.headers } });
    const result = {};
    await handler(request, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body?.toString() || ''; } });
    return result;
  };
}
test('message routes protect authenticated reads and same-site JSON queue and retry actions', async () => {
  const calls = [];
  const request = fixture({ async list() { return []; }, async get(messageId) { return { id: messageId }; },
    async add(input) { calls.push(input); return input; }, async retry(messageId) { calls.push(messageId); return { id: messageId }; } });
  const url = '/api/partner-messages';
  assert.equal((await request(url, { headers: { authorization: '' } })).status, 401);
  assert.equal((await request(url, { headers: { 'x-forwarded-proto': 'http' } })).status, 426);
  for (const target of [url, `${url}/${id}/retry`]) {
    for (const [headers, status] of [[{ 'x-betting-hub': '' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415]]) {
      assert.equal((await request(target, { method: 'POST', headers })).status, status);
    }
    assert.equal((await request(target, { method: 'POST', raw: '{' })).status, 400);
    assert.equal((await request(target, { method: 'POST', raw: 'x'.repeat(98305) })).status, 413);
  }
  assert.equal(calls.length, 0);
  const body = { id, text: 'Hello\n+odds', partnerIds: ['a'] };
  const queued = await request(url, { method: 'POST', body });
  assert.equal(queued.status, 201);
  assert.deepEqual(JSON.parse(queued.body), { message: body });
  assert.equal((await request(`${url}/${id}/retry`, { method: 'POST' })).status, 200);
  assert.deepEqual(calls, [body, id]);
  assert.equal((await request(url, { method: 'HEAD' })).body, '');
  assert.equal((await request(url)).headers['Cache-Control'], 'private, no-store');
  assert.equal((await request(`${url}/${id}/retry`)).status, 405);
  assert.equal((await request(`${url}/${id}`, { method: 'POST' })).status, 405);
});
test('messaging errors expose only safe validation messages', async () => {
  const failed = fixture({ async list() { throw new Error('private-host password=secret'); } });
  const result = await failed('/api/partner-messages');
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.body, /private-host|secret/);
  const safe = fixture({ async get() { throw Object.assign(new Error('Message not found'), { partnerMessageSafe: true, status: 404 }); } });
  assert.equal((await safe(`/api/partner-messages/${id}`)).status, 404);
  assert.equal((await fixture()('/api/partner-messages')).status, 503);
});
