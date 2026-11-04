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

function createHandler({ username, password, directory, requireHttps = true, upcomingGamesService, sendsService, telegramService, telegramReceiver, confirmsService }) {
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

    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { return reply(response, 400, 'Invalid path.\n', {}, head); }
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) {
      return reply(response, 404, 'Not found.\n', {}, head);
    }

    const telegramRoute = /^\/api\/telegram\/(config|test|updates|messages)$/.exec(pathname);
    if (telegramRoute) {
      const action = telegramRoute[1];
      const allowed = action === 'config' ? ['GET', 'HEAD', 'PUT'] : ['POST'];
      if (!allowed.includes(request.method)) return reply(response, 405, 'Method not allowed.\n', { Allow: allowed.join(', ') });
      const json = (status, value) => reply(response, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' }, head);
      try {
        let body;
        if (!['GET', 'HEAD'].includes(request.method)) {
          if (request.headers['x-betting-hub'] !== 'telegram' || request.headers['sec-fetch-site'] === 'cross-site') return json(403, { message: 'Open Telegram in Betting Hub to use this connection.' });
          if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return json(415, { message: 'Telegram requests require JSON.' });
          let size = 0;
          const chunks = [];
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk);
            if (size > 32768) return json(413, { message: 'This Telegram request is too large.' });
            chunks.push(Buffer.from(chunk));
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return json(400, { message: 'Invalid Telegram JSON.' }); }
        }
        if (!telegramService) return json(503, { message: 'Telegram is not configured on this server yet.' });
        if (action === 'config') return json(200, request.method === 'PUT' ? await telegramService.saveConfig(body) : await telegramService.getConfig());
        if (action === 'test') return json(200, await telegramService.testConnection());
        if (action === 'updates') {
          if (!telegramReceiver) return json(503, { message: 'Telegram inbox storage is not configured on this server yet.' });
          return json(200, await telegramReceiver.readInbox());
        }
        return json(200, await telegramService.sendMessage(body));
      } catch (error) {
        if (error.telegramSafe) return json(error.status, { message: error.message });
        return json(error.code === 'DB_NOT_CONFIGURED' ? 503 : 502, { message: error.code === 'DB_NOT_CONFIGURED' ? 'Configure the app database to save Telegram credentials.' : 'Unable to load or save the Telegram connection. Please try again.' });
      }
    }

    const confirmRoute = /^\/api\/confirms(?:\/sources\/([a-f0-9]{64})\/(manual|retry)|\/bets\/([a-zA-Z0-9-]{1,36}))?$/.exec(pathname);
    if (confirmRoute) {
      const [, sourceId, action, betId] = confirmRoute;
      const allowed = sourceId ? ['POST'] : betId ? ['PATCH', 'DELETE'] : ['GET', 'HEAD'];
      if (!allowed.includes(request.method)) return reply(response, 405, 'Method not allowed.\n', { Allow: allowed.join(', ') });
      const json = (status, value) => reply(response, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' }, head);
      try {
        let body;
        if (!['GET', 'HEAD'].includes(request.method)) {
          if (request.headers['x-betting-hub'] !== 'confirms' || request.headers['sec-fetch-site'] === 'cross-site') return json(403, { message: 'Open Confirms in Betting Hub to edit or grade bets.' });
          if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return json(415, { message: 'Confirms requests require JSON.' });
          let size = 0;
          const chunks = [];
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk);
            if (size > 32768) return json(413, { message: 'This confirmation request is too large.' });
            chunks.push(Buffer.from(chunk));
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return json(400, { message: 'Invalid confirmation JSON.' }); }
        }
        if (!confirmsService) return json(503, { message: 'Confirms storage is not configured yet.' });
        if (betId) return json(200, { bet: await (request.method === 'DELETE' ? confirmsService.remove(betId, body, username) : confirmsService.update(betId, body, username)) });
        if (action === 'manual') return json(200, { bet: await confirmsService.addManual(sourceId, body, username) });
        if (action === 'retry') return json(200, await confirmsService.retry(sourceId, body));
        return json(200, await confirmsService.list());
      } catch (error) {
        if (error.confirmSafe) return json(error.status || 400, { message: error.message });
        return json(error.code === 'DB_NOT_CONFIGURED' ? 503 : 502, { message: 'Unable to load or save Confirms. Please try again.' });
      }
    }
    const draftRoute = /^\/api\/send-drafts(?:\/([a-zA-Z0-9-]{1,36})(\/send)?)?$/.exec(pathname);
    if (draftRoute) {
      const id = draftRoute[1];
      const sending = !!draftRoute[2];
      const allowed = sending ? ['POST'] : id ? ['PATCH', 'DELETE'] : ['GET', 'HEAD', 'POST'];
      if (!allowed.includes(request.method)) return reply(response, 405, 'Method not allowed.\n', { Allow: allowed.join(', ') });
      const json = (status, value) => reply(response, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' }, head);
      try {
        let body;
        if (!['GET', 'HEAD'].includes(request.method)) {
          // A custom header plus JSON prevents authenticated cross-site form writes.
          if (request.headers['x-betting-hub'] !== 'sends' || request.headers['sec-fetch-site'] === 'cross-site') return json(403, { message: 'Open Sends in Betting Hub to edit drafts.' });
          if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return json(415, { message: 'Drafts require JSON.' });
          let size = 0;
          const chunks = [];
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk);
            if (size > 98304) throw Object.assign(new Error('This draft is too large.'), { status: 413 });
            chunks.push(Buffer.from(chunk));
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw Object.assign(new Error('Invalid draft JSON.'), { status: 400 }); }
        }
        if (!sendsService) throw Object.assign(new Error(), { code: 'DB_NOT_CONFIGURED' });
        if (sending) return json(200, { draft: await sendsService.send(id, body, telegramService) });
        if (request.method === 'GET' || head) return json(200, { drafts: await sendsService.list() });
        if (request.method === 'POST') return json(200, { draft: await sendsService.add(body) });
        if (request.method === 'PATCH') return json(200, { draft: await sendsService.update(id, body) });
        await sendsService.remove(id, body?.revision);
        return json(200, { removed: true });
      } catch (error) {
        if ([400, 404, 409, 413].includes(error.status)) return json(error.status, { message: error.message });
        const missing = error.code === 'DB_NOT_CONFIGURED';
        return json(missing ? 503 : 502, { message: missing ? 'Sends storage is not configured yet.' : sending ? 'Unable to confirm delivery. Refresh Sends and check the partner chats before retrying.' : 'Unable to save or load Sends. Please try again.' });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return reply(response, 405, 'Method not allowed.\n', { Allow: 'GET, HEAD' });
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
    const sendsService = require('./sends.cjs').createSendsService();
    const telegramService = require('./telegram.cjs').createTelegramService();
    const telegramReceiver = require('./telegram-receiver.cjs').createTelegramReceiver({ telegramService, sendsService });
    const confirmsService = require('./confirms.cjs').createConfirmsService({ telegramReceiver, sendsService });
    const handler = createHandler({
      username: process.env.APP_AUTH_USERNAME,
      password: process.env.APP_AUTH_PASSWORD,
      directory: path.join(__dirname, '..', development ? 'public' : '_static'),
      requireHttps: !development && process.env.APP_ALLOW_HTTP !== 'true',
      upcomingGamesService, sendsService, telegramService, telegramReceiver, confirmsService,
    });
    const port = Number(process.env.PORT || 8080);
    const server = http.createServer(handler).listen(port, development ? '127.0.0.1' : '0.0.0.0', () => {
      console.log(`Betting Hub listening on port ${port}; authentication required.`);
      telegramReceiver.start();
      confirmsService.start();
    });
    async function shutdown() {
      server.close();
      await confirmsService.close();
      await telegramReceiver.close();
      await Promise.allSettled([telegramService.close(), sendsService.close(), upcomingGamesService.close()]);
    }
    process.once('SIGTERM', () => { void shutdown(); });
    process.once('SIGINT', () => { void shutdown(); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createHandler };
