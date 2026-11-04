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

async function request(url, { authorization, https = true, method = 'GET' } = {}) {
  const request = { url, method, socket: {}, headers: {} };
  if (authorization) request.headers.authorization = authorization;
  if (https) request.headers['x-forwarded-proto'] = 'https';
  const result = { status: null, headers: {}, body: '' };
  await handler(request, {
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
