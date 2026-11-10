import React, { useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, Panel, SearchField } from '../../components/ui';
import { parseDate } from '../sports/lol/upcoming';
import BetFilters, { defaultBetDates, easternBetDay, matchesBetDates, newestDateFirst, sportLabel } from './BetFilters';
import { calculatePL, grades } from './confirmationFields';

const eastern = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const money = value => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' }).format(value);
const receiptStatuses = { pending: 'Queued', sending: 'Sending', sent: 'Sent', error: 'Delivery failed', uncertain: 'Delivery unconfirmed', cancelled: 'Cancelled' };
function betDateKey(bet, message) {
  const time = parseDate(bet?.betAt) || parseDate(message.date) || parseDate(message.receivedAt);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(bet?.betDate) ? bet.betDate : easternBetDay(time);
  return day ? `${day} ${time?.toISOString() || ''}` : '';
}

function filterReplies(sources, sport, dates) {
  const days = new Set();
  const filtered = sources.flatMap(source => {
    if (!source.bets.length) {
      const date = betDateKey(null, source.message);
      days.add(date.slice(0, 10));
      return (sport === 'all' || source.sports?.includes(sport)) && matchesBetDates(date.slice(0, 10), dates)
        ? [{ ...source, orderDate: date }] : [];
    }
    const matching = source.bets.map(bet => ({ bet, date: betDateKey(bet, source.message) }))
      .filter(({ bet, date }) => {
        const day = date.slice(0, 10);
        days.add(day);
        return (sport === 'all' || bet.sport === sport) && matchesBetDates(day, dates);
      }).sort((a, b) => newestDateFirst(a.date, b.date));
    return matching.length ? [{ ...source, bets: matching.map(({ bet }) => bet), orderDate: matching[0].date }] : [];
  });
  return { days: [...days], sources: filtered.sort((a, b) => newestDateFirst(a.orderDate, b.orderDate)) };
}

function groupByBetId(sources) {
  const groups = new Map();
  function groupFor(betId) {
    if (!groups.has(betId)) groups.set(betId, { betId, bets: [], sources: new Map(), orderDate: '' });
    return groups.get(betId);
  }
  function addSource(group, source, date) {
    group.sources.set(source.id, source);
    if (date > group.orderDate) group.orderDate = date;
  }
  for (const source of sources) {
    for (const bet of source.bets) {
      const group = groupFor(bet.betId || '');
      const date = betDateKey(bet, source.message);
      group.bets.push({ bet, date });
      addSource(group, source, date);
    }
    if (!source.bets.length) {
      const betIds = new Set([
        ...(source.eligibleBetIds ?? source.message.betIds ?? []),
        ...(source.deletionNotifications || []).map(receipt => receipt.betId).filter(Boolean),
      ]);
      if (!betIds.size) betIds.add('');
      for (const betId of betIds) addSource(groupFor(betId), source, source.orderDate);
    }
  }
  for (const group of groups.values()) group.bets.sort((a, b) => newestDateFirst(a.date, b.date));
  return [...groups.values()].sort((a, b) => newestDateFirst(a.orderDate, b.orderDate));
}

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
  const sportAndLeague = [sportLabel(bet.sport), bet.league].filter(Boolean).join(' · ');
  const receipts = Object.values((bet.notifications || []).reduce((latest, receipt) => ({ ...latest, [receipt.kind]: receipt }), {}));
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
    <tr className="confirmation-row" data-grade={edited.grade}>
      <td><span aria-label={`Bet ID for ${bet.id}`}>{edited.betId || '—'}</span></td>
      <td title={bet.partnerId ? `Partner ID: ${bet.partnerId}` : undefined}>{bet.partnerName || '—'}<small>{bet.telegramChatName}</small></td>
      <td><span aria-label={`Bet date (ET) for ${bet.id}`}>{edited.betDate || '—'}</span><small>Reply: {eastern(bet.betAt)} ET</small></td>
      <td className="confirmation-game"><span aria-label={`Game for ${bet.id}`}>{edited.game || '—'}</span>{sportAndLeague && <small>{sportAndLeague}</small>}{bet.gameAt && <small>Game: {eastern(bet.gameAt)} ET</small>}</td><td>{input('team', 'Team', 200, 'text')}</td><td>{input('bet', 'Bet', 300, 'text')}</td>
      <td>{input('risk', 'Risk', 16, 'decimal')}</td><td>{input('odds', 'Odds', 16, 'text')}</td>
      <td><select aria-label={`Grade for ${bet.id}`} value={edited.grade} disabled={busy} onChange={event => change('grade', event.target.value)}>{grades.map(grade => <option key={grade} value={grade}>{grade === 'UNGRADED' ? 'Ungraded' : grade}</option>)}</select></td>
      <td>{edited.grade === 'PARTRETURN' ? input('partialReturn', 'PARTRETURN net P/L', 16, 'text') : '—'}</td>
      <td><output aria-label={`P/L for ${bet.id}`} className={pl > 0 ? 'confirm-profit' : pl < 0 ? 'confirm-loss' : ''}>{money(pl)}</output>{dirty && <small>Unsaved</small>}</td>
      <td className="confirmation-actions"><button type="button" className="button button-primary" disabled={!dirty || busy} onClick={save}>{busy && !deleting ? 'Saving…' : 'Save'}</button>{dirty && <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEdited(bet); setDirty(false); setError(''); }}>Reset edits</button>}
        {deleting ? <div role="group" aria-label={`Delete confirmation for ${bet.id}`}><p>Delete {bet.betId}? The raw reply and history will be kept.</p><button type="button" className="button button-secondary" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Confirm delete'}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel delete</button></div> : <button type="button" className="button button-secondary" disabled={busy || dirty} title={dirty ? 'Save or reset edits before deleting.' : undefined} onClick={() => setDeleting(true)}>Delete bet</button>}
        {!bet.complete && !dirty && <small>Needs review</small>}<small>Saved: {eastern(edited.updatedAt || edited.createdAt)} ET{edited.gradedAt ? ` · Graded: ${eastern(edited.gradedAt)} ET` : ''}</small>
        {receipts.map(receipt => <small key={receipt.id} title={receipt.error || undefined}>Telegram {receipt.kind === 'logged' ? 'log' : 'grade'}: {receiptStatuses[receipt.status] || receipt.status}{receipt.error ? ` · ${receipt.error}` : ''}</small>)}</td>
    </tr>
    {error && <tr><td colSpan={12}><p className="sends-error" role="alert">{error}</p></td></tr>}
    {dirty && bet.revision > edited.revision && <tr><td colSpan={12}><p className="sends-error">This bet changed on another screen. Your edits are preserved; refresh Confirms before saving.</p></td></tr>}
  </>;
}
const statusLabels = { pending: 'Waiting for AI', processing: 'Parsing…', parsed: 'AI parsed', review: 'Needs review', error: 'Parsing failed', manual: 'Manual entry' };

function ConfirmationReply({ source, betId, busySource, canRetry, onAction }) {
  const canAdd = !betId || (source.eligibleBetIds ?? source.message.betIds ?? []).includes(betId);
  return <div className="confirmation-reply">
    <div className="confirmation-header"><div><strong>{source.partner?.name || source.message.chat}</strong><small>{source.message.chat} · {source.message.from} · {eastern(source.message.date)} ET</small></div><div><Badge>{statusLabels[source.status] || source.status}</Badge>
      {!source.bets.length && !source.deletedBetCount && source.status !== 'processing' && <button type="button" className="button button-secondary" disabled={!!busySource || !canRetry} onClick={() => onAction(source, 'retry')}>Retry AI</button>}
      {canAdd && <button type="button" className="button button-secondary" disabled={!!busySource} onClick={() => onAction(source, 'manual', betId)}>Add bet manually</button>}</div></div>
    <details className="confirmation-raw"><summary>Raw reply · {(source.message.betIds || []).join(', ')}</summary><p>{source.message.text || '[Message without text]'}</p></details>
    {source.error && <p className="sends-error" role="alert">{source.error}</p>}{source.issues?.map((issue, index) => <p className="confirms-note" key={index}>{issue}</p>)}
    {source.deletedBetCount > 0 && <p className="confirms-note">{source.deletedBetCount} deleted bet{source.deletedBetCount === 1 ? '' : 's'}. Raw reply and history preserved.</p>}
    {(source.deletionNotifications || []).map(receipt => <p key={receipt.id} className="confirms-note">Telegram deletion for {receipt.betId}: {receiptStatuses[receipt.status] || receipt.status}{receipt.error ? ` · ${receipt.error}` : ''}</p>)}
  </div>;
}

export default function ConfirmsInbox({ filters, onFiltersChange }) {
  const [query, setQuery] = useState('');
  const [localFilters, setLocalFilters] = useState({ sport: 'all', dates: null });
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
          setInbox(current => {
            const previousSources = new Map(current?.sources.map(source => [source.id, source]));
            return { ...result, sources: result.sources.map(source => {
              const previous = previousSources.get(source.id);
              if (previous?.revision > source.revision) return previous;
              return { ...source, deletedBetCount: Math.max(source.deletedBetCount || 0, previous?.deletedBetCount || 0),
                deletionNotifications: Object.values([...(previous?.deletionNotifications || []), ...(source.deletionNotifications || [])].reduce((all, receipt) => ({ ...all, [receipt.id]: receipt }), {})),
                bets: source.bets.filter(bet => !deletedRows.current.has(bet.id)).map(bet => {
                  const old = previous?.bets.find(item => item.id === bet.id);
                  return old?.revision > bet.revision ? old : bet;
                }) };
            }) };
          });
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
    const { bet: removed } = await api(`/bets/${encodeURIComponent(bet.id)}`, 'DELETE', { revision: bet.revision });
    deletedRows.current.add(bet.id);
    setInbox(current => ({ ...current, sources: current.sources.map(source => source.id === bet.sourceId ? {
      ...source, deletedBetCount: (source.deletedBetCount || 0) + 1, bets: source.bets.filter(item => item.id !== bet.id),
      deletionNotifications: [...(source.deletionNotifications || []), ...(removed?.notification ? [{ ...removed.notification, betId: bet.betId }] : [])],
    } : source) }));
  }
  async function sourceAction(source, action, betId) {
    setBusySource(source.id); setError('');
    try {
      const result = await api(`/sources/${source.id}/${action}`, 'POST', { revision: source.revision, ...(betId ? { betId } : {}) });
      setInbox(current => ({ ...current, sources: current.sources.map(item => item.id === source.id ? { ...item, revision: item.revision + 1,
        status: action === 'manual' ? 'manual' : 'pending', error: null, bets: result.bet ? [...item.bets, result.bet] : item.bets } : item) }));
    } catch (failure) { setError(failure.message); }
    finally { setBusySource(''); }
  }
  const receiver = inbox?.receiver;
  const pollFresh = receiver?.lastPolledAt && Date.now() - Date.parse(receiver.lastPolledAt) < 45000;
  const status = error || receiver?.error ? 'Receiving error' : receiver?.enabled === false ? 'Receiving paused' : pollFresh ? 'Receiving every 10s' : receiver?.lastPolledAt ? 'Receiving delayed' : 'Waiting for receiver';
  const search = query.trim().toLowerCase();
  const selection = filters ?? localFilters;
  const setFilters = onFiltersChange || setLocalFilters;
  const defaults = defaultBetDates(true);
  const { days, sources: datedSources } = filterReplies(inbox?.sources || [], selection.sport, selection.dates ?? defaults);
  const sources = datedSources.filter(source => [source.message.text, source.message.chat, source.message.from, source.partner?.name,
    ...source.bets.flatMap(bet => [bet.betId, bet.game, bet.team, bet.bet, bet.grade, bet.partnerName, bet.bettorName, bet.betDate, bet.telegramSenderUsername]), ...(source.message.betIds || [])].join(' ').toLowerCase().includes(search));
  const groups = groupByBetId(sources);
  return <Panel title="Partner confirms" description="Review extracted bets, adjust wager details, and save a grade to record P/L."
    action={<button type="button" className="button button-secondary" disabled={refreshing} onClick={() => refresh.current()}>{refreshing ? 'Refreshing…' : 'Refresh replies'}</button>}>
    <div className="confirms-controls"><div className="confirms-receiver"><Badge tone={pollFresh && !error && !receiver?.error && receiver?.enabled !== false ? 'success' : 'neutral'}>{status}</Badge><span>Last Telegram check: {eastern(receiver?.lastPolledAt)} ET</span></div>
      <div className="confirms-filters"><SearchField label="Search saved replies" value={query} onChange={setQuery} placeholder="Bet ID, partner, game, or message…" />
        <BetFilters sport={selection.sport} onSportChange={sport => setFilters({ ...selection, sport })}
          dates={selection.dates} onDatesChange={dates => setFilters({ ...selection, dates })}
          defaults={defaults} defaultLabel="Last 7 days" dateLabel="Bet dates" days={days} />
      </div>
    </div>
    {error && <p className="sends-error" role="alert">{error}{inbox ? ' Previously loaded replies remain below.' : ''}</p>}{receiver?.error && <p className="sends-error" role="alert">{receiver.error}</p>}
    {inbox?.parser && (!inbox.parser.configured || !inbox.parser.enabled) && <p className="confirms-note">{!inbox.parser.configured ? 'AI parsing needs a DigitalOcean model access key in server settings.' : 'Automatic AI parsing is paused.'} You can add and edit bets manually.</p>}
    {inbox?.parser?.error && <p className="sends-error" role="alert">{inbox.parser.error}</p>}
    {loading ? <p className="confirms-loading" role="status">Loading saved replies…</p> : groups.map(({ betId, bets, sources: replies }) => {
      const label = betId ? `Bet ID ${betId}` : 'Replies without a Bet ID';
      return <article className="confirmation-source" key={betId} aria-label={label}>
        <div className="confirmation-header"><h2 className="confirmation-group-title">{betId || label}</h2><Badge>{bets.length} {bets.length === 1 ? 'bet' : 'bets'}</Badge></div>
        {bets.length > 0 && <div className="table-scroll"><table className="data-table confirmation-fields" aria-label={`Bets for ${betId || 'unassigned replies'}`}>
          <colgroup>{[6, 9, 8, 14, 10, 10, 6, 6, 10, 7, 6, 8].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
          <thead><tr>{['BETID', 'PARTNER', 'BET DATE (ET)', 'GAME', 'TEAM', 'BET', 'RISK ($)', 'ODDS', 'GRADE', 'PARTRETURN P/L ($)', 'P/L', 'Actions'].map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{bets.map(({ bet }) => <ConfirmationRow key={bet.id} bet={bet} onSave={saveBet} onDelete={deleteBet} />)}</tbody>
        </table></div>}
        <details className="confirmation-replies" open={bets.length === 0}>
          <summary>Telegram replies ({replies.size})</summary>
          {[...replies.values()].map(source => <ConfirmationReply key={source.id} source={source} betId={betId}
            busySource={busySource} canRetry={inbox.parser?.configured && inbox.parser?.enabled} onAction={sourceAction} />)}
        </details>
      </article>;
    })}
    {!loading && !sources.length && !error && <EmptyState compact title={search || inbox?.sources.length ? 'No matching replies' : 'No bet replies received yet'} description={search || inbox?.sources.length ? 'Change the search, sport, or date range to see more replies.' : 'Partner messages containing a recognized six-character Bet ID will appear here.'} />}
    <p className="confirms-note">Refreshes every 10 seconds. WIN records profit excluding stake; LOSS subtracts risk; VOID is $0. PARTRETURN uses your signed net P/L (+50 profit, -25 loss). Changes apply when you save. Raw replies and edit history are preserved.</p>
  </Panel>;
}
