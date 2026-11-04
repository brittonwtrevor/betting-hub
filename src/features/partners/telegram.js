// Store a channel reference only; saving a partner never contacts Telegram.
function normalizeTelegramChannel(value) {
  const channel = value.trim();
  if (!channel) return '';
  if (/^-\d+$/.test(channel)) return channel;
  if (/^@[a-zA-Z0-9_]+$/.test(channel)) return channel;
  let url;
  try { url = new URL(channel.startsWith('t.me/') ? `https://${channel}` : channel); }
  catch { throw new Error('Use an @channel username, a t.me channel link, or a negative chat ID such as -1001234567890.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 't.me' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Use an @channel username, a t.me channel link, or a negative chat ID such as -1001234567890.');
  }
  const path = url.pathname.replace(/\/$/, '');
  if (/^\/[a-zA-Z0-9_]+$/.test(path) && path !== '/joinchat') return `@${path.slice(1)}`;
  if (/^\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(path)) return `https://t.me${path}`;
  throw new Error('Enter a channel link, rather than a link to an individual Telegram message.');
}
module.exports = { normalizeTelegramChannel };
