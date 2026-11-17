const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHandler } = require('./index.cjs');
const auth = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;
function fixture(service) {
  const handler = createHandler({ username: 'test-user', password: 'test-password', directory: path.join(__dirname, '..', 'public'), lukeOriginatorService: service });
  return async (options = {}) => {
    const req = Readable.from([options.raw ?? JSON.stringify(options.body || {})]);
    Object.assign(req, { url: options.url || '/api/luke-originator', method: options.method || 'GET', socket: {}, headers: {
      authorization: auth, 'x-forwarded-proto': 'https', 'x-betting-hub': 'luke-originator', 'content-type': 'application/json', ...options.headers,
    } });
    const result = {};
    await handler(req, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body?.toString() || ''; } });
    return result;
  };
}

test('protects Luke allocation reads and writes with the app login and same-site JSON requirements', async () => {
  const writes = [];
  const report = { settings: { allocationPercent: 45, revision: 1 }, rows: [] };
  const request = fixture({ report: async () => report, save: async body => { writes.push(body); return body; } });
  assert.equal((await request({ headers: { authorization: '' } })).status, 401);
  assert.equal((await request({ headers: { 'x-forwarded-proto': 'http' } })).status, 426);
  assert.deepEqual(JSON.parse((await request()).body), report);
  assert.equal((await request({ method: 'HEAD' })).body, '');
  assert.equal((await request({ method: 'POST' })).status, 405);
  for (const [headers, status] of [[{ 'x-betting-hub': '' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415]]) {
    assert.equal((await request({ method: 'PATCH', headers })).status, status);
  }
  assert.equal((await request({ method: 'PATCH', raw: '{' })).status, 400);
  assert.equal((await request({ method: 'PATCH', raw: 'x'.repeat(4097) })).status, 413);
  assert.equal(writes.length, 0);
  const body = { allocationPercent: 25, revision: 1 };
  assert.equal((await request({ method: 'PATCH', body })).status, 200);
  assert.deepEqual(writes, [body]);
  const failed = fixture({ report: async () => { throw new Error('private-host password=secret'); } });
  assert.doesNotMatch((await failed()).body, /private-host|secret/);
});

test('routes persistent settlement checks by Bet ID with the same authentication and write protections', async () => {
  const calls = [];
  const request = fixture({ async setSettlement(betId, body) { calls.push([betId, body]); return { betId, ...body }; } });
  const options = { url: '/api/luke-originator/settlements/HAR561', method: 'PATCH',
    body: { settledWithLuke: true, settlementRevision: 0 } };
  assert.equal((await request({ ...options, method: 'GET' })).status, 405);
  for (const [headers, status] of [[{ authorization: '' }, 401], [{ 'x-betting-hub': '' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415]]) {
    assert.equal((await request({ ...options, headers })).status, status);
  }
  assert.equal(calls.length, 0);
  const result = await request(options);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [['HAR561', options.body]]);
  assert.equal(JSON.parse(result.body).settlement.settledWithLuke, true);
});
