import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Panel } from '../../components/ui';
import Icon from '../../components/Icon';
import { usePartners } from '../partners/usePartners';
import './messages.css';

const endpoint = '/api/partner-messages';
const statusLabels = { pending: 'Queued', sending: 'Sending…', sent: 'Sent', failed: 'Failed', uncertain: 'Check Telegram' };
const statusTones = { pending: 'neutral', sending: 'neutral', sent: 'success', failed: 'danger', uncertain: 'warning' };
function channelFor(partner) {
  const channel = partner.telegramChannel?.trim() || '';
  return /^-?[1-9]\d{0,19}$/.test(channel) || /^@[a-zA-Z0-9_]{5,32}$/.test(channel) ? channel.toLowerCase() : '';
}
async function request(path = '', method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${endpoint}${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'partner-messages' }, body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw Object.assign(new Error(result?.message || 'Unable to load or queue the message. Check delivery status before trying again.'), { status: response.status });
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Check delivery status before trying again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function readMessage(result, id) {
  if (result.message?.id !== id || !Array.isArray(result.message.deliveries)) throw new Error('Unable to read the message receipt. Check delivery status.');
  return result.message;
}
function sentTime(value) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function PartnerMessagesPage() {
  const registry = usePartners();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [pending, setPending] = useState(null);
  const [retryQueue, setRetryQueue] = useState(false);
  const [notice, setNotice] = useState('');
  const historyVersion = useRef(0);
  const historyRequest = useRef(null);
  const eligible = registry.partners.filter(channelFor);
  const recipients = eligible.filter(partner => selected.includes(partner.id));
  const channelCount = new Set(recipients.map(channelFor)).size;
  const locked = saving || !!pending;
  const sending = messages.some(message => message.deliveries.some(delivery => ['pending', 'sending'].includes(delivery.status)));

  const load = useCallback(() => {
    if (historyRequest.current) return historyRequest.current;
    const version = historyVersion.current;
    historyRequest.current = (async () => {
      try {
        const result = await request();
        if (!Array.isArray(result.messages)) throw new Error('Unable to read message history. Refresh to try again.');
        if (version === historyVersion.current) { setMessages(result.messages); setLoadError(''); }
      } catch (error) { if (version === historyVersion.current) setLoadError(error.message); }
      finally { setLoading(false); historyRequest.current = null; }
    })();
    return historyRequest.current;
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(timer);
  }, [sending, load]);

  function accepted(message) {
    historyVersion.current++;
    setMessages(current => [message, ...current.filter(item => item.id !== message.id)]);
    setText(''); setSelected([]); setPending(null); setRetryQueue(false); setSendError('');
    setNotice('Message queued. Delivery status updates below.');
  }
  async function send(event) {
    event.preventDefault();
    if (saving || !text.trim() || !recipients.length || registry.loading || registry.error || loading || loadError) return;
    const attempt = pending || { id: window.crypto.randomUUID(), text, partnerIds: recipients.map(partner => partner.id) };
    setSaving(true); setSendError(''); setNotice(''); setRetryQueue(false);
    try { accepted(readMessage(await request('', 'POST', attempt), attempt.id)); }
    catch (error) {
      setPending(error.status >= 400 && error.status < 500 ? null : attempt);
      setSendError(error.message);
    } finally { setSaving(false); }
  }
  async function checkPending() {
    if (!pending || saving) return;
    setSaving(true);
    try { accepted(readMessage(await request(`/${pending.id}`), pending.id)); }
    catch (error) {
      if (error.status === 404) {
        setRetryQueue(true);
        setSendError('This message has not been queued yet. Retry queueing to safely use the same message.');
      } else setSendError(error.message);
    } finally { setSaving(false); }
  }
  async function retry(message) {
    if (retrying) return;
    setRetrying(message.id); setSendError(''); setNotice('');
    try {
      const updated = readMessage(await request(`/${message.id}/retry`, 'POST', {}), message.id);
      historyVersion.current++;
      setMessages(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice('Failed channels queued for another attempt.');
    } catch (error) { setSendError(error.message); void load(); }
    finally { setRetrying(null); }
  }

  return <>
    <h1>Partner Messages</h1>
    <p className="page-description">Send a Telegram message to the partners you choose.</p>
    {notice && <p className="message-notice" role="status">{notice}</p>}
    {sendError && <p className="message-error" role="alert">{sendError}</p>}
    <form onSubmit={send} className="partner-message-form">
      <div className="message-compose-grid">
        <Panel title="Message">
          <div className="message-compose-body">
            <label htmlFor="partner-message-text">Telegram message</label>
            <textarea id="partner-message-text" rows={12} maxLength={4096} value={text} disabled={locked} placeholder="Write your message…" onChange={event => { setText(event.target.value); setSendError(''); setNotice(''); }} aria-describedby="message-length" />
            <p id="message-length" className="message-caption">{text.length.toLocaleString()} / 4,096 characters</p>
          </div>
        </Panel>
        <Panel title="Recipients" action={<a className="button button-secondary" href="#/partners">Manage partners</a>}>
          <div className="message-recipient-actions">
            <button type="button" className="button button-secondary" disabled={locked || registry.loading || !!registry.error || !eligible.length} onClick={() => setSelected(eligible.map(partner => partner.id))}>Select all</button>
            <button type="button" className="button button-secondary" disabled={locked || !selected.length} onClick={() => setSelected([])}>Clear</button>
            <span>{recipients.length} selected</span>
          </div>
          {registry.loading ? <p className="message-compose-body">Loading partners…</p> : registry.error ? <div className="message-compose-body"><p role="alert" className="message-error">{registry.error}</p><button type="button" className="button button-secondary" onClick={registry.reload}>Refresh partners</button></div> :
            <div className="message-recipients" role="group" aria-label="Message recipients">
              {!registry.partners.length && <p>No partners yet. Add partners and their Telegram channels in Partner Accounting.</p>}
              {registry.partners.map(partner => {
                const available = !!channelFor(partner);
                return <label key={partner.id} className={`message-recipient${available ? '' : ' message-recipient-unavailable'}`}>
                  <input type="checkbox" checked={available && selected.includes(partner.id)} disabled={locked || !available} onChange={() => setSelected(current => current.includes(partner.id) ? current.filter(id => id !== partner.id) : [...current, partner.id])} />
                  <span><strong>{partner.name}</strong><small>{partner.telegramChannel || 'No Telegram channel'}{!available && ' · Add a numeric chat ID or public @channel'}</small></span>
                </label>;
              })}
            </div>}
        </Panel>
      </div>
      <div className="message-send-actions">
        <p>{recipients.length} partner{recipients.length === 1 ? '' : 's'} · {channelCount} Telegram channel{channelCount === 1 ? '' : 's'}<small>Partners sharing a channel receive one message.</small></p>
        {pending ? <button type="button" className="button button-primary" disabled={saving} onClick={retryQueue ? send : checkPending}>{saving ? 'Checking…' : retryQueue ? 'Retry queueing' : 'Check delivery status'}</button> :
          <button type="submit" className="button button-primary" disabled={saving || registry.loading || !!registry.error || loading || !!loadError || !text.trim() || !recipients.length}><Icon name="mailSend" size={17} />{saving ? 'Queueing…' : `Send to ${recipients.length} partner${recipients.length === 1 ? '' : 's'}`}</button>}
      </div>
    </form>
    <Panel title="Recent messages" description="Delivery status for the last 30 messages." action={<button type="button" className="button button-secondary" onClick={load}>Refresh status</button>}>
      {loadError && <p className="message-error" role="alert">{loadError}</p>}
      {loading ? <p className="message-compose-body">Loading messages…</p> : !messages.length ? <p className="message-compose-body">No messages sent yet.</p> :
        <div className="message-history">{messages.map((message, index) => {
          const sent = message.deliveries.filter(delivery => delivery.status === 'sent').length;
          const failed = message.deliveries.filter(delivery => delivery.status === 'failed').length;
          return <details key={message.id} open={index === 0}>
            <summary><span>{sentTime(message.createdAt)} ET</span><span className="message-summary-text">{message.text}</span><strong>{sent} / {message.deliveries.length} sent</strong></summary>
            <p className="message-sent-text">{message.text}</p>
            <ul className="message-deliveries" aria-label="Channel delivery status">{message.deliveries.map(delivery => <li key={delivery.channel}>
              <div><strong>{delivery.partners.join(', ')}</strong><small>{delivery.channel}</small>{delivery.error && <p>{delivery.error}</p>}</div>
              <Badge tone={statusTones[delivery.status]}>{statusLabels[delivery.status] || delivery.status}</Badge>
            </li>)}</ul>
            {!!failed && <div className="message-retry"><button type="button" className="button button-secondary" disabled={!!retrying} onClick={() => retry(message)}>{retrying === message.id ? 'Queueing…' : `Retry ${failed} failed channel${failed === 1 ? '' : 's'}`}</button></div>}
          </details>;
        })}</div>}
    </Panel>
  </>;
}
