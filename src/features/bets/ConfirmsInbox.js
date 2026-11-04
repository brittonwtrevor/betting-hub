import React, { useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, Panel, SearchField } from '../../components/ui';
import { calculatePL, grades } from './confirmationFields';

const eastern = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const money = value => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' }).format(value);
async function api(path = '', method = 'GET', body, signal) {
  const response = await fetch(`/api/confirms${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'confirms' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Unable to load or save Confirms.');
  return result;
}
function ConfirmationRow({ bet, onSave, onDelete }) {
  const [edited, setEdited] = useState(bet);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (!dirty && !busy && bet.revision > edited.revision) setEdited(bet); }, [bet, dirty, busy, edited.revision]);
  const change = (key, value) => { setEdited(current => ({ ...current, [key]: value })); setDirty(true); setError(''); };
  const input = (key, label, maxLength, inputMode, type = 'text') => <input type={type} aria-label={`${label} for ${bet.id}`} value={edited[key] ?? ''} maxLength={maxLength} inputMode={inputMode} disabled={busy} onChange={event => change(key, event.target.value)} />;
  const pl = calculatePL(edited);
  async function save() {
    setBusy(true); setError('');
    try { const next = await onSave(edited); setEdited(next); setDirty(false); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await onDelete(bet); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <>
    <tr className="confirmation-row">
      <td>{input('betId', 'Bet ID', 6, 'text')}</td>
      <td title={bet.partnerId ? `Partner ID: ${bet.partnerId}` : undefined}>{bet.partnerName || '—'}<small>{bet.telegramChatName}</small></td>
      <td>{input('bettorName', 'Bettor', 200, 'text')}<small>Sender: {bet.telegramSenderUsername ? `@${bet.telegramSenderUsername}` : bet.telegramSenderName || 'Unknown'}{bet.telegramSenderId ? ` · ${bet.telegramSenderId}` : ''}</small></td>
      <td>{input('betDate', 'Bet date (ET)', 10, 'text', 'date')}<small>Reply: {eastern(bet.betAt)} ET</small></td>
      <td className="confirmation-game">{input('game', 'Game', 400, 'text')}{bet.gameAt && <small>Game: {eastern(bet.gameAt)} ET</small>}</td><td>{input('team', 'Team', 200, 'text')}</td><td>{input('bet', 'Bet', 300, 'text')}</td>
      <td>{input('risk', 'Risk', 16, 'decimal')}</td><td>{input('odds', 'Odds', 16, 'text')}</td>
      <td><select aria-label={`Grade for ${bet.id}`} value={edited.grade} disabled={busy} onChange={event => change('grade', event.target.value)}>{grades.map(grade => <option key={grade} value={grade}>{grade === 'UNGRADED' ? 'Ungraded' : grade}</option>)}</select></td>
      <td>{edited.grade === 'PARTRETURN' ? input('partialReturn', 'PARTRETURN net P/L', 16, 'text') : '—'}</td>
      <td><output aria-label={`P/L for ${bet.id}`} className={pl > 0 ? 'confirm-profit' : pl < 0 ? 'confirm-loss' : ''}>{money(pl)}</output>{dirty && <small>Unsaved</small>}</td>
      <td className="confirmation-actions"><button type="button" className="button button-primary" disabled={!dirty || busy} onClick={save}>{busy && !deleting ? 'Saving…' : 'Save'}</button>{dirty && <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEdited(bet); setDirty(false); setError(''); }}>Reset edits</button>}
        {deleting ? <div role="group" aria-label={`Delete confirmation for ${bet.id}`}><p>Delete {bet.betId}? The raw reply and history will be kept.</p><button type="button" className="button button-secondary" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Confirm delete'}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel delete</button></div> : <button type="button" className="button button-secondary" disabled={busy || dirty} title={dirty ? 'Save or reset edits before deleting.' : undefined} onClick={() => setDeleting(true)}>Delete bet</button>}
        {!bet.complete && !dirty && <small>Needs review</small>}<small>Saved: {eastern(edited.updatedAt || edited.createdAt)} ET{edited.gradedAt ? ` · Graded: ${eastern(edited.gradedAt)} ET` : ''}</small></td>
    </tr>
    {error && <tr><td colSpan={13}><p className="sends-error" role="alert">{error}</p></td></tr>}
    {dirty && bet.revision > edited.revision && <tr><td colSpan={13}><p className="sends-error">This bet changed on another screen. Your edits are preserved; refresh Confirms before saving.</p></td></tr>}
  </>;
}
const statusLabels = { pending: 'Waiting for AI', processing: 'Parsing…', parsed: 'AI parsed', review: 'Needs review', error: 'Parsing failed', manual: 'Manual entry' };
export default function ConfirmsInbox() {
  const [query, setQuery] = useState('');
  const [inbox, setInbox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busySource, setBusySource] = useState('');
  const refresh = useRef(() => {});
  const deletedRows = useRef(new Set());
  useEffect(() => {
    let active = true;
    let pending;
    async function load() {
      if (pending) return;
      const controller = new AbortController(); pending = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      setRefreshing(true);
      try {
        const result = await api('', 'GET', undefined, controller.signal);
        if (!Array.isArray(result.sources)) throw new Error('Confirms returned an unreadable response.');
        if (active) {
          setInbox(current => ({ ...result, sources: result.sources.map(source => {
            const previous = current?.sources.find(item => item.id === source.id);
            if (previous?.revision > source.revision) return previous;
            return { ...source, deletedBetCount: Math.max(source.deletedBetCount || 0, previous?.deletedBetCount || 0),
              bets: source.bets.filter(bet => !deletedRows.current.has(bet.id)).map(bet => {
              const old = previous?.bets.find(item => item.id === bet.id);
              return old?.revision > bet.revision ? old : bet;
            }) };
          }) }));
          setError('');
        }
      } catch (failure) { if (active) setError(failure.name === 'AbortError' ? 'Loading Confirms timed out. Try refreshing.' : failure.message); }
      finally { clearTimeout(timeout); pending = null; if (active) { setLoading(false); setRefreshing(false); } }
    }
    refresh.current = load; load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); pending?.abort(); };
  }, []);
  async function saveBet(edited) {
    const { bet } = await api(`/bets/${encodeURIComponent(edited.id)}`, 'PATCH', edited);
    setInbox(current => ({ ...current, sources: current.sources.map(source => ({ ...source, bets: source.bets.map(item => item.id === bet.id ? bet : item) })) }));
    return bet;
  }
  async function deleteBet(bet) {
    await api(`/bets/${encodeURIComponent(bet.id)}`, 'DELETE', { revision: bet.revision });
    deletedRows.current.add(bet.id);
    setInbox(current => ({ ...current, sources: current.sources.map(source => source.id === bet.sourceId ? {
      ...source, deletedBetCount: (source.deletedBetCount || 0) + 1, bets: source.bets.filter(item => item.id !== bet.id),
    } : source) }));
  }
  async function sourceAction(source, action) {
    setBusySource(source.id); setError('');
    try {
      const result = await api(`/sources/${source.id}/${action}`, 'POST', { revision: source.revision });
      setInbox(current => ({ ...current, sources: current.sources.map(item => item.id === source.id ? { ...item, revision: item.revision + 1,
        status: action === 'manual' ? 'manual' : 'pending', error: null, bets: result.bet ? [...item.bets, result.bet] : item.bets } : item) }));
    } catch (failure) { setError(failure.message); }
    finally { setBusySource(''); }
  }
  const receiver = inbox?.receiver;
  const pollFresh = receiver?.lastPolledAt && Date.now() - Date.parse(receiver.lastPolledAt) < 45000;
  const status = error || receiver?.error ? 'Receiving error' : receiver?.enabled === false ? 'Receiving paused' : pollFresh ? 'Receiving every 10s' : receiver?.lastPolledAt ? 'Receiving delayed' : 'Waiting for receiver';
  const search = query.trim().toLowerCase();
  const sources = (inbox?.sources || []).filter(source => [source.message.text, source.message.chat, source.message.from, source.partner?.name,
    ...source.bets.flatMap(bet => [bet.betId, bet.game, bet.team, bet.bet, bet.grade, bet.partnerName, bet.bettorName, bet.betDate, bet.telegramSenderUsername]), ...(source.message.betIds || [])].join(' ').toLowerCase().includes(search));
  return <Panel title="Partner confirms" description="Review extracted bets, edit any field, and save a grade to record P/L."
    action={<button type="button" className="button button-secondary" disabled={refreshing} onClick={() => refresh.current()}>{refreshing ? 'Refreshing…' : 'Refresh replies'}</button>}>
    <div className="confirms-controls"><div className="confirms-receiver"><Badge tone={pollFresh && !error && !receiver?.error && receiver?.enabled !== false ? 'success' : 'neutral'}>{status}</Badge><span>Last Telegram check: {eastern(receiver?.lastPolledAt)} ET</span></div><SearchField label="Search saved replies" value={query} onChange={setQuery} placeholder="Bet ID, partner, game, or message…" /></div>
    {error && <p className="sends-error" role="alert">{error}{inbox ? ' Previously loaded replies remain below.' : ''}</p>}{receiver?.error && <p className="sends-error" role="alert">{receiver.error}</p>}
    {inbox?.parser && (!inbox.parser.configured || !inbox.parser.enabled) && <p className="confirms-note">{!inbox.parser.configured ? 'AI parsing needs a DigitalOcean model access key in server settings.' : 'Automatic AI parsing is paused.'} You can add and edit bets manually.</p>}
    {inbox?.parser?.error && <p className="sends-error" role="alert">{inbox.parser.error}</p>}
    {loading ? <p className="confirms-loading" role="status">Loading saved replies…</p> : sources.map(source => <article className="confirmation-source" key={source.id} aria-label={`Reply ${source.message.messageId} from ${source.message.chat}`}>
      <div className="confirmation-header"><div><strong>{source.partner?.name || source.message.chat}</strong><small>{source.message.chat} · {source.message.from} · {eastern(source.message.date)} ET</small></div><div><Badge>{statusLabels[source.status] || source.status}</Badge>
        {!source.bets.length && !source.deletedBetCount && source.status !== 'processing' && <button type="button" className="button button-secondary" disabled={!!busySource || !inbox.parser?.configured || !inbox.parser?.enabled} onClick={() => sourceAction(source, 'retry')}>Retry AI</button>}<button type="button" className="button button-secondary" disabled={!!busySource} onClick={() => sourceAction(source, 'manual')}>Add bet manually</button></div></div>
      <details className="confirmation-raw"><summary>Raw reply · {(source.message.betIds || []).join(', ')}</summary><p>{source.message.text || '[Message without text]'}</p></details>
      {source.error && <p className="sends-error" role="alert">{source.error}</p>}{source.issues?.map((issue, index) => <p className="confirms-note" key={index}>{issue}</p>)}
      {source.deletedBetCount > 0 && <p className="confirms-note">{source.deletedBetCount} deleted bet{source.deletedBetCount === 1 ? '' : 's'}. Raw reply and history preserved.</p>}
      {source.bets.length > 0 && <div className="table-scroll"><table className="data-table confirmation-fields" aria-label={`Bets for reply ${source.message.messageId}`}><thead><tr>{['BETID', 'PARTNER', 'BETTOR', 'BET DATE (ET)', 'GAME', 'TEAM', 'BET', 'RISK ($)', 'ODDS', 'GRADE', 'PARTRETURN P/L ($)', 'P/L', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{source.bets.map(bet => <ConfirmationRow key={bet.id} bet={bet} onSave={saveBet} onDelete={deleteBet} />)}</tbody></table></div>}
    </article>)}
    {!loading && !sources.length && !error && <EmptyState compact title={search ? 'No matching replies' : 'No bet replies received yet'} description={search ? 'Try another bet ID, partner, or message.' : 'Partner messages containing a recognized six-character Bet ID will appear here.'} />}
    <p className="confirms-note">Refreshes every 10 seconds. WIN records profit excluding stake; LOSS subtracts risk; VOID is $0. PARTRETURN uses your signed net P/L (+50 profit, -25 loss). Changes apply when you save. Raw replies and edit history are preserved.</p>
  </Panel>;
}
