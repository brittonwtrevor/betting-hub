import React, { useEffect, useState } from 'react';
import { Badge, EmptyState, InfoNote, Panel } from '../../components/ui';
import './telegram.css';

async function api(action, method = 'POST', body = {}) {
  const response = await fetch(`/api/telegram/${action}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'telegram' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Unable to connect to Telegram.');
  return result;
}
const eastern = value => value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function TelegramPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [destination, setDestination] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState(null);
  const [inbox, setInbox] = useState(null);
  useEffect(() => {
    let active = true;
    api('config', 'GET').then(result => {
      if (active) { setConfig(result); setDefaultChatId(result.defaultChatId); setDestination(result.defaultChatId); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function run(action, work) {
    setBusy(action); setError(''); setNotice('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const disabled = loading || !!busy;
  return <div className="telegram-page">
    <Panel title="Bot connection" description="Save your bot once to use it across computers." action={<Badge tone={config?.configured ? 'success' : 'neutral'}>{config?.configured ? `@${config.bot.username || config.bot.name}` : 'No bot saved'}</Badge>}>
      <form className="telegram-form" onSubmit={event => { event.preventDefault(); run('save', async () => {
        const result = await api('config', 'PUT', { token, defaultChatId });
        setConfig(result); setToken(''); setConnection(null); setInbox(null); setDestination(result.defaultChatId);
        setNotice(`Credentials saved. Connected to @${result.bot.username || result.bot.name}.`);
      }); }}>
        <fieldset disabled={disabled}>
          <label htmlFor="telegram-token">Bot token</label>
          <input id="telegram-token" type="password" autoComplete="new-password" spellCheck={false} value={token} maxLength={128} placeholder={config?.configured ? 'Token saved · leave blank to keep it' : 'Paste the token from BotFather'} onChange={event => setToken(event.target.value)} aria-describedby="telegram-token-help" required={!config?.configured} />
          <p id="telegram-token-help">Encrypted on the server. The saved token is never returned to your browser. Saving verifies the bot without sending a message.</p>
          <label htmlFor="telegram-default-chat">Default chat ID (optional)</label>
          <input id="telegram-default-chat" value={defaultChatId} maxLength={64} placeholder="-1001234567890 or @channel" onChange={event => setDefaultChatId(event.target.value)} />
          <div className="telegram-actions"><button className="button button-primary" type="submit">{busy === 'save' ? 'Verifying and saving…' : 'Save credentials'}</button><button className="button button-secondary" type="button" disabled={!config?.configured} onClick={() => run('test', async () => {
            setConnection(null);
            const result = await api('test'); setConnection(result); setNotice(`Connection verified for @${result.bot.username || result.bot.name}.`);
          })}>{busy === 'test' ? 'Checking…' : 'Test connection'}</button></div>
        </fieldset>
      </form>
      {connection && <div className="telegram-connection"><p>Receiving: {connection.webhookActive ? 'Existing webhook active' : 'Manual pending update preview ready'}</p><p>Group privacy: {connection.bot.canReadAllGroupMessages ? 'All group messages enabled' : 'Privacy mode enabled; some group messages are hidden from the bot'}</p><p>Pending updates: {connection.pendingUpdates}</p></div>}
    </Panel>
    {loading && <p role="status">Loading Telegram connection…</p>}
    {error && <p className="telegram-error" role="alert">{error}</p>}
    {notice && <p className="telegram-notice" role="status">{notice}</p>}
    <div className="telegram-grid">
      <Panel title="Send a message" description="Send plain text to a chat your bot can access.">
        <form className="telegram-form" onSubmit={event => { event.preventDefault(); run('send', async () => {
          const result = await api('messages', 'POST', { chatId: destination, text });
          setText(''); setNotice(`Message sent to ${result.message.chat} (${result.message.chatId}) at ${eastern(result.message.date)} ET.`);
        }); }}>
          <fieldset disabled={disabled || !config?.configured}>
            <label htmlFor="telegram-destination">Destination chat</label>
            <input id="telegram-destination" value={destination} maxLength={64} placeholder="Chat ID or @channel" onChange={event => setDestination(event.target.value)} required />
            <label htmlFor="telegram-message">Message</label>
            <textarea id="telegram-message" rows={6} maxLength={4096} value={text} onChange={event => setText(event.target.value)} required />
            <p>{text.length.toLocaleString()} / 4,096 characters. Clicking Send message posts this text to the destination above.</p>
            <div className="telegram-actions"><button className="button button-primary" type="submit" disabled={!text.trim() || !destination.trim()}>{busy === 'send' ? 'Sending…' : 'Send message'}</button></div>
          </fieldset>
        </form>
      </Panel>
      <Panel title="Pending inbox" description="Preview up to 100 pending updates. Refresh manually to check for messages." action={<button type="button" className="button button-secondary" disabled={disabled || !config?.configured} onClick={() => run('read', async () => {
        setInbox(null); setInbox(await api('updates'));
      })}>{busy === 'read' ? 'Reading…' : 'Read pending messages'}</button>}>
        {inbox?.messages.length ? <ul className="telegram-messages">{inbox.messages.map(message => <li key={`${message.updateId}-${message.kind}`}>
          <div><strong>{message.chat}</strong><span>{eastern(message.date)} ET</span></div><p className="telegram-message-meta">Chat ID: {message.chatId}{message.from ? ` · ${message.from}` : ''}{message.kind.startsWith('edited') ? ' · Edited' : ''}</p><p className="telegram-message-text">{message.text}</p>
          <button type="button" className="partner-link" disabled={disabled} onClick={() => { setDestination(message.chatId); document.getElementById('telegram-message').focus(); }}>Use this chat</button>
        </li>)}</ul> : <EmptyState compact title={inbox ? 'No pending text or media messages' : 'Ready when your bot is connected'} description={inbox ? `${inbox.updateCount} updates checked. Send a new message to the bot, then refresh.` : 'Send /start to your bot in Telegram, then read pending messages to find your chat ID.'} />}
        {inbox && <p className="telegram-inbox-note">Checked {eastern(inbox.fetchedAt)} ET. Updates stay pending, so repeated refreshes may show the same messages.</p>}
      </Panel>
    </div>
    <InfoNote>Add the bot to your group, or make it a channel administrator with permission to post. The inbox shows pending bot updates, not chat history. An existing webhook or another reader can affect availability. Automatic receiving and bet confirmations will be connected later.</InfoNote>
  </div>;
}
