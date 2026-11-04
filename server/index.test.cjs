const { Readable } = require('node:stream');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHandler } = require('./index.cjs');

let temp;
let directory;
let handler;
const credentials = { username: 'test-user', password: 'test-only:password' };
const auth = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;

before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'betting-hub-auth-'));
  directory = path.join(temp, '_static');
  await fs.mkdir(path.join(directory, 'static'), { recursive: true });
  await fs.writeFile(path.join(directory, 'index.html'), '<html>private dashboard</html>');
  await fs.writeFile(path.join(directory, 'static', 'main.js'), 'private script');
  await fs.writeFile(path.join(temp, 'outside.txt'), 'outside secret');
  await fs.symlink(path.join(temp, 'outside.txt'), path.join(directory, 'leak.txt'));
  handler = createHandler({ ...credentials, directory });
});
after(async () => { if (temp) await fs.rm(temp, { recursive: true, force: true }); });

async function request(url, { authorization, https = true, method = 'GET', useHandler = handler, headers = {}, body } = {}) {
  const request = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(request, { url, method, socket: {}, headers: { ...headers } });
  if (authorization) request.headers.authorization = authorization;
  if (https) request.headers['x-forwarded-proto'] = 'https';
  const result = { status: null, headers: {}, body: '' };
  await useHandler(request, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body?.toString() || ''; },
  });
  return result;
}

test('requires both credentials; missing configuration never starts an open server', () => {
  assert.throws(() => createHandler({ directory }), /APP_AUTH_USERNAME/);
  assert.throws(() => createHandler({ username: 'test', directory }), /APP_AUTH_PASSWORD/);
});

test('protects HTML, assets, deep links, and missing paths before any content is served', async () => {
  for (const url of ['/', '/index.html', '/static/main.js', '/sports/hockey', '/missing.json']) {
    const result = await request(url);
    assert.equal(result.status, 401, url);
    assert.match(result.headers['WWW-Authenticate'], /Basic realm="Betting Hub"/);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.doesNotMatch(result.body, /private dashboard|private script/);
  }
});

test('rejects incorrect and malformed credentials', async () => {
  for (const authorization of ['Basic ???', 'Bearer token', `Basic ${Buffer.from('test-user:wrong').toString('base64')}`, `Basic ${Buffer.from('other:test-only:password').toString('base64')}`]) {
    assert.equal((await request('/', { authorization })).status, 401);
  }
});

test('accepts correct credentials and serves protected HTML and assets', async () => {
  const page = await request('/', { authorization: auth });
  assert.equal(page.status, 200);
  assert.equal(page.body, '<html>private dashboard</html>');
  assert.match(page.headers['Content-Type'], /text\/html/);
  const asset = await request('/static/main.js', { authorization: auth });
  assert.equal(asset.status, 200);
  assert.equal(asset.body, 'private script');
  assert.equal((await request('/sports/hockey', { authorization: auth })).status, 200);
});

test('requires HTTPS before presenting a credential prompt', async () => {
  const result = await request('/', { https: false, authorization: auth });
  assert.equal(result.status, 426);
  assert.equal(result.headers['WWW-Authenticate'], undefined);
});

test('blocks traversal, malformed URLs, and symlink escapes', async () => {
  for (const url of ['/%2e%2e/outside.txt', '/%2e%2e%2foutside.txt', '/.env', '/leak.txt', '/%00', '/%ZZ']) {
    const result = await request(url, { authorization: auth });
    assert.ok([400, 404].includes(result.status), url);
    assert.doesNotMatch(result.body, /outside secret/);
  }
});

test('HEAD is authenticated and body-free; missing assets and write methods are rejected', async () => {
  assert.equal((await request('/', { method: 'HEAD' })).status, 401);
  const head = await request('/', { method: 'HEAD', authorization: auth });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request('/missing.js', { authorization: auth })).status, 404);
  assert.equal((await request('/', { method: 'POST', authorization: auth })).status, 405);
});

test('health endpoint exposes only a content-free liveness response', async () => {
  const result = await request('/healthz', { https: false });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'ok\n');
  assert.equal((await request('/healthz/', { https: false })).status, 426);
});

test('protects the database API before querying and returns uncached JSON only after sign-in', async () => {
  let reads = 0;
  const data = { games: [{ match_id: 1 }], columns: [], source: { name: 'DigitalOcean MySQL' } };
  const useHandler = createHandler({ ...credentials, directory, upcomingGamesService: {
    async getUpcomingGames() { reads++; return data; },
  } });
  assert.equal((await request('/api/lol/upcoming-games', { useHandler })).status, 401);
  assert.equal((await request('/api/lol/upcoming-games', { useHandler, authorization: auth, method: 'POST' })).status, 405);
  assert.equal(reads, 0);
  const result = await request('/api/lol/upcoming-games', { useHandler, authorization: auth });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.match(result.headers['Content-Type'], /application\/json/);
  assert.deepEqual(JSON.parse(result.body), data);
  assert.equal((await request('/api/lol/upcoming-games', { useHandler, authorization: auth, method: 'HEAD' })).body, '');
  assert.equal((await request('/api/unknown', { useHandler, authorization: auth })).status, 404);
});

test('database errors have actionable statuses and never reveal connection details', async () => {
  const missing = await request('/api/lol/upcoming-games', { authorization: auth });
  assert.equal(missing.status, 503);
  assert.equal(JSON.parse(missing.body).code, 'DB_NOT_CONFIGURED');
  const useHandler = createHandler({ ...credentials, directory, upcomingGamesService: {
    async getUpcomingGames() { throw new Error('private-host password=secret SELECT *'); },
  } });
  const failed = await request('/api/lol/upcoming-games', { useHandler, authorization: auth });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(failed.body, /private-host|secret|SELECT/);
});


test('draft writes are authenticated, JSON-only, and reject cross-site requests', async () => {
  let writes = 0;
  const useHandler = createHandler({ ...credentials, directory, sendsService: {
    async list() { return []; }, async add(body) { writes++; return body; },
    async update(id, body) { writes++; return { id, ...body }; },
    async remove() { writes++; },
  } });
  const headers = { 'content-type': 'application/json', 'x-betting-hub': 'sends' };
  const options = { useHandler, authorization: auth, method: 'POST', headers, body: { game: 'test' } };
  assert.equal((await request('/api/send-drafts', { ...options, authorization: null })).status, 401);
  assert.equal((await request('/api/send-drafts', { ...options, https: false })).status, 426);
  assert.equal((await request('/api/send-drafts', { ...options, headers: {} })).status, 403);
  assert.equal((await request('/api/send-drafts', { ...options, headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/send-drafts', { ...options, headers: { ...headers, 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/send-drafts', { ...options, body: 'broken JSON' })).status, 400);
  assert.equal((await request('/api/send-drafts', { ...options, body: 'x'.repeat(100000) })).status, 413);
  assert.equal(writes, 0);
  const added = await request('/api/send-drafts', options);
  assert.equal(added.status, 200);
  assert.deepEqual(JSON.parse(added.body).draft, options.body);
  assert.equal((await request('/api/send-drafts/abc', { ...options, method: 'PATCH' })).status, 200);
  assert.equal((await request('/api/send-drafts/abc', { ...options, method: 'DELETE', body: { revision: 1 } })).status, 200);
  assert.equal(writes, 3);
  assert.equal((await request('/api/send-drafts', { ...options, method: 'GET' })).status, 200);
  assert.equal((await request('/api/send-drafts', { ...options, method: 'PUT' })).status, 405);
});

test('draft failures preserve useful validation errors and never expose database credentials', async () => {
  assert.equal((await request('/api/send-drafts', { authorization: auth })).status, 503);
  const useHandler = createHandler({ ...credentials, directory, sendsService: {
    async list() { throw new Error('private-host password=secret'); },
  } });
  const result = await request('/api/send-drafts', { authorization: auth, useHandler });
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.body, /private-host|secret/);
});

test('card send endpoint requires authenticated same-site JSON POST and passes only through Sends', async () => {
  const calls = [];
  const telegramService = {};
  const useHandler = createHandler({ ...credentials, directory, telegramService, sendsService: {
    async send(id, input, telegram) { calls.push({ id, input, telegram }); return { id, deliveries: [] }; },
  } });
  const options = { useHandler, authorization: auth, method: 'POST', headers: { 'content-type': 'application/json', 'x-betting-hub': 'sends' }, body: { revision: 2 } };
  const url = '/api/send-drafts/draft-1/send';
  assert.equal((await request(url, { ...options, authorization: undefined })).status, 401);
  assert.equal((await request(url, { ...options, method: 'GET' })).status, 405);
  assert.equal((await request(url, { ...options, method: 'PATCH' })).status, 405);
  assert.equal((await request(url, { ...options, headers: { ...options.headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal(calls.length, 0);
  const result = await request(url, options);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [{ id: 'draft-1', input: { revision: 2 }, telegram: telegramService }]);
  assert.deepEqual(JSON.parse(result.body), { draft: { id: 'draft-1', deliveries: [] } });
});
