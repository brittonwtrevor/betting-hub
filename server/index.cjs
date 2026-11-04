const http = require('node:http');
const fs = require('node:fs');
const { readFile, realpath, stat } = require('node:fs/promises');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const digest = value => createHash('sha256').update(value).digest();

function createHandler({ username, password, directory, requireHttps = true, upcomingGamesService }) {
  if (!username || !password || username.includes(':') || /[\r\n]/.test(username)) {
    throw new Error('Set APP_AUTH_USERNAME and APP_AUTH_PASSWORD before starting Betting Hub.');
  }
  const root = fs.realpathSync(directory);
  const expected = digest(`${username}:${password}`);

  function reply(response, status, body, extraHeaders = {}, head = false) {
    response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Length': Buffer.byteLength(body),
      ...extraHeaders,
    });
    response.end(head ? undefined : body);
  }

  async function handle(request, response) {
    const head = request.method === 'HEAD';
    const rawPath = (request.url || '/').split('?')[0];

    // A content-free endpoint for platform probes; the app itself stays gated.
    if (rawPath === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
      return reply(response, 200, 'ok\n', {}, head);
    }

    // DigitalOcean terminates TLS and forwards the original scheme.
    const secure = request.socket?.encrypted || request.headers['x-forwarded-proto'] === 'https';
    if (requireHttps && !secure) {
      return reply(response, 426, 'Open Betting Hub over HTTPS.\n', {}, head);
    }

    const authorization = request.headers.authorization || '';
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    const supplied = match ? digest(Buffer.from(match[1], 'base64')) : digest('');
    if (!match || !timingSafeEqual(supplied, expected)) {
      return reply(response, 401, 'Authentication required.\n', {
        'WWW-Authenticate': 'Basic realm="Betting Hub", charset="UTF-8"',
      }, head);
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return reply(response, 405, 'Method not allowed.\n', { Allow: 'GET, HEAD' });
    }

    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { return reply(response, 400, 'Invalid path.\n', {}, head); }
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) {
      return reply(response, 404, 'Not found.\n', {}, head);
    }

    if (pathname === '/api/lol/upcoming-games') {
      try {
        if (!upcomingGamesService) throw Object.assign(new Error(), { code: 'DB_NOT_CONFIGURED' });
        const data = await upcomingGamesService.getUpcomingGames();
        return reply(response, 200, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' }, head);
      } catch (error) {
        const unconfigured = error.code === 'DB_NOT_CONFIGURED';
        return reply(response, unconfigured ? 503 : 502, JSON.stringify({
          code: unconfigured ? 'DB_NOT_CONFIGURED' : 'DB_UNAVAILABLE',
          message: unconfigured ? 'League of Legends data connection is not configured yet.' : 'Unable to load League of Legends data. Try refreshing shortly.',
        }), { 'Content-Type': 'application/json; charset=utf-8' }, head);
      }
    }
    if (pathname.startsWith('/api/')) return reply(response, 404, 'Not found.\n', {}, head);

    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      return reply(response, 404, 'Not found.\n', {}, head);
    }
    try {
      const info = await stat(file).catch(error => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      });
      if (!info?.isFile()) {
        if (path.extname(pathname)) return reply(response, 404, 'Not found.\n', {}, head);
        file = path.join(root, 'index.html');
      }
      file = await realpath(file);
      if (!file.startsWith(`${root}${path.sep}`)) {
        return reply(response, 404, 'Not found.\n', {}, head);
      }
      const body = await readFile(file);
      return reply(response, 200, body, {
        'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      }, head);
    } catch (error) {
      return reply(response, error.code === 'ENOENT' ? 404 : 500, 'Unable to serve this page.\n', {}, head);
    }
  }

  return (request, response) => handle(request, response).catch(() => {
    if (!response.headersSent) reply(response, 500, 'Unable to serve this page.\n');
    else response.end();
  });
}

if (require.main === module) {
  try {
    const development = process.argv.includes('--dev');
    const upcomingGamesService = require('./lol.cjs').createUpcomingGamesService();
    const handler = createHandler({
      username: process.env.APP_AUTH_USERNAME,
      password: process.env.APP_AUTH_PASSWORD,
      directory: path.join(__dirname, '..', development ? 'public' : '_static'),
      requireHttps: !development && process.env.APP_ALLOW_HTTP !== 'true',
      upcomingGamesService,
    });
    const port = Number(process.env.PORT || 8080);
    http.createServer(handler).listen(port, development ? '127.0.0.1' : '0.0.0.0', () => {
      console.log(`Betting Hub listening on port ${port}; authentication required.`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createHandler };
