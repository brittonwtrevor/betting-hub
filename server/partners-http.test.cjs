const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHandler } = require('./index.cjs');
function fixture(service) {
  const handler = createHandler({ username: 'user', password: 'password', directory: path.join(__dirname, '..', 'public'), partnersService: service });
  return async (url, options = {}) => {
    const request = Readable.from([options.raw ?? JSON.stringify(options.body || {})]);
    Object.assign(request, { url, method: options.method || 'GET', socket: {}, headers: {
      authorization: `Basic ${Buffer.from('user:password').toString('base64')}`, 'x-forwarded-proto': 'https',
      'x-betting-hub': 'partners', 'content-type': 'application/json', ...options.headers } });
    const result = {};
    await handler(request, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body?.toString() || ''; } });
    return result;
  };
}
test('partner reads, creates, edits and imports require authentication and protected JSON writes', async () => {
  const calls = [];
  const request = fixture({ async list() { return []; }, async add(input) { calls.push(['add', input]); return input; },
    async update(id, input) { calls.push(['update', id, input]); return input; }, async importLegacy(input) { calls.push(['import', input]); return { imported: true }; } });
  assert.equal((await request('/api/partners', { headers: { authorization: '' } })).status, 401);
  assert.equal((await request('/api/partners', { headers: { 'x-forwarded-proto': 'http' } })).status, 426);
  for (const method of ['POST', 'PATCH']) {
    const url = method === 'POST' ? '/api/partners' : '/api/partners/local-1';
    for (const [headers, status] of [[{ 'x-betting-hub': '' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415]]) {
      assert.equal((await request(url, { method, headers })).status, status);
    }
    assert.equal((await request(url, { method, raw: '{' })).status, 400);
    assert.equal((await request(url, { method, raw: 'x'.repeat(98305) })).status, 413);
    assert.equal((await request(url, { method, body: { name: 'Sam', revision: 1 } })).status, 200);
  }
  assert.equal((await request('/api/partners/import', { method: 'POST', body: { partners: [] } })).status, 200);
  assert.deepEqual(calls.map(call => call[0]), ['add', 'update', 'import']);
  assert.equal((await request('/api/partners', { method: 'HEAD' })).body, '');
  assert.equal((await request('/api/partners')).headers['Cache-Control'], 'private, no-store');
  assert.equal((await request('/api/partners/local-1', { method: 'DELETE' })).status, 405);
});
test('partner failures never expose database connection details or claim success', async () => {
  const request = fixture({ async add() { throw new Error('private-host password=secret'); } });
  const result = await request('/api/partners', { method: 'POST' });
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.body, /private-host|secret/);
});
