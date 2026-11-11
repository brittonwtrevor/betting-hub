import React, { useEffect, useState } from 'react';
import { normalizeTelegramChannel } from './telegram';
import { listPartnerPayments, savePartnerPayment, usePartners } from './usePartners';
import PartnerPaymentForm from './PartnerPaymentForm';
import { fullSplitBps, splitAmount, splitError, splitToBps } from './split';
import { downloadCsv } from '../../utils/downloadCsv';
import { EmptyState, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';

const views = {
  balances: { title: 'Partner balances', columns: ['Partner', 'Split (%)', 'Open exposure', 'Settled P/L', 'Your share', 'Net payments received', 'Owed to you', 'Owed to partner'], empty: 'No partner balances yet' },
  reports: { title: 'Bet reports', columns: ['Partner', 'Bet ID', 'Bet date (ET)', 'Event / Selection', 'Sport', 'Reported risk', 'Odds', 'Grade', 'Reported P/L', 'Split (%)', 'Your risk', 'Your P/L'], empty: 'No partner bets yet' },
  payments: { title: 'Payments', columns: ['Partner', 'Date (ET)', 'Direction', 'Amount', 'Reference', 'Status'], empty: 'No payments recorded' },
};
const currency = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : '—';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const cents = value => Math.round(value * 100);
const paymentNet = payments => {
  const totals = new Map();
  for (const payment of payments) {
    if (payment.status !== 'Complete' || !Number.isFinite(payment.amount)) continue;
    const sign = payment.direction === 'Received' ? 1 : payment.direction === 'Sent' ? -1 : 0;
    totals.set(payment.partnerId, (totals.get(payment.partnerId) ?? 0) + sign * cents(payment.amount));
  }
  return totals;
};

export default function PartnersPage({ partners: connectedPartners = [], bets, payments = [] }) {
  const registry = usePartners();
  const localPartners = registry.partners;
  const [report, setReport] = useState({ bets: [], loading: bets === undefined, loaded: false, error: '' });
  const [ledger, setLedger] = useState({ payments: [], loading: true, loaded: false, error: '' });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (bets !== undefined) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setReport(current => ({ ...current, loading: true, error: '' }));
    (async () => {
      try {
        const response = await fetch('/api/confirms/bets', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.bets)) throw new Error(result.message || 'Unable to load partner bet reports.');
        if (active) setReport({ bets: result.bets, loading: false, loaded: true, error: '' });
      } catch (error) {
        if (active) setReport(current => ({ ...current, loading: false, error: error.name === 'AbortError' ? 'Loading partner bet reports timed out.' : error.message }));
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [bets, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLedger(current => ({ ...current, loading: true, error: '' }));
    listPartnerPayments(controller.signal).then(payments => {
      if (!controller.signal.aborted) setLedger({ payments, loading: false, loaded: true, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setLedger(current => ({ ...current, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, [refresh]);
  const [partnerId, setPartnerId] = useState('all');
  const [tab, setTab] = useState('balances');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [telegramChannel, setTelegramChannel] = useState('');
  const [editingChannel, setEditingChannel] = useState(false);
  const [channelDraft, setChannelDraft] = useState('');
  const [channelError, setChannelError] = useState('');
  const [newSplit, setNewSplit] = useState('100');
  const [partnerSplit, setPartnerSplit] = useState(null);
  const [betSplit, setBetSplit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const partners = [...connectedPartners.map(partner => {
    const local = localPartners.find(item => item.id === partner.id || item.name.toLowerCase() === partner.name.toLowerCase());
    return local ? { ...partner, ...local } : partner;
  }), ...localPartners.filter(local => !connectedPartners.some(partner => partner.id === local.id || partner.name.toLowerCase() === local.name.toLowerCase()))];
  const selected = partners.find(partner => partner.id === partnerId);
  const scopedPartners = selected ? [selected] : partners;
  const matchesPartner = record => !selected || record.partnerId === selected.id;
  const findPartner = id => partners.find(partner => partner.id === id || partner.legacyIds?.includes(id));
  const reportBets = (bets ?? report.bets).map(bet => {
    const bps = splitToBps(bet.splitPercent) ?? fullSplitBps;
    return { ...bet, partnerId: findPartner(bet.partnerId)?.id ?? bet.partnerId, splitPercent: bps / 100,
      yourRisk: bet.yourRisk ?? splitAmount(bet.stake, bps), yourShare: bet.yourShare ?? splitAmount(bet.settledProfit, bps) };
  });
  const scopedBets = reportBets.filter(matchesPartner);
  const savedPartners = new Set(localPartners.map(partner => partner.id));
  const recordedNet = paymentNet(ledger.payments);
  const connectedNet = paymentNet(payments);
  const scopedPayments = [...ledger.payments, ...payments].filter(matchesPartner);
  const partnerName = (id, fallback) => findPartner(id)?.name || fallback || 'Unknown partner';
  const reportTotals = new Map();
  for (const bet of reportBets) {
    if (!bet.betId) continue;
    const totals = reportTotals.get(bet.partnerId) ?? { openCents: 0, settledCents: 0, shareCents: 0 };
    if (bet.status === 'UNGRADED' && Number.isFinite(bet.yourRisk)) totals.openCents += cents(bet.yourRisk);
    if (bet.status !== 'UNGRADED' && Number.isFinite(bet.settledProfit)) {
      totals.settledCents += cents(bet.settledProfit);
      totals.shareCents += cents(bet.yourShare);
    }
    reportTotals.set(bet.partnerId, totals);
  }
  const balance = (partner, key) => {
    const totals = reportTotals.get(partner.id);
    if (partner[key] != null) return partner[key];
    if (!totals) return savedPartners.has(partner.id) && (bets !== undefined || report.loaded) ? 0 : undefined;
    if (key === 'openExposure') return totals.openCents / 100;
    if (key === 'settledProfit') return totals.settledCents / 100;
    if (key === 'yourShare') return totals.shareCents / 100;
    return undefined;
  };
  const amounts = new Map(partners.map(partner => {
    const saved = savedPartners.has(partner.id);
    const recorded = recordedNet.get(partner.id) ?? 0;
    const connected = connectedNet.get(partner.id);
    const totalPayments = Number.isFinite(partner.paymentsTotal) ? cents(partner.paymentsTotal) : connected;
    const paymentTotal = saved && !ledger.loaded ? undefined :
      totalPayments !== undefined || saved ? ((totalPayments ?? 0) + recorded) / 100 : undefined;
    const published = Number.isFinite(partner.owedToYou) || Number.isFinite(partner.owedToPartner);
    const settledProfit = balance(partner, 'settledProfit');
    let net;
    if (!saved || ledger.loaded) {
      if (published) {
        net = cents(partner.owedToYou ?? 0) - cents(partner.owedToPartner ?? 0) - recorded;
      } else if (Number.isFinite(settledProfit) || (saved && (bets !== undefined || report.loaded))) {
        net = cents(balance(partner, 'yourShare') ?? settledProfit ?? 0) - (totalPayments ?? 0) - recorded;
      }
    }
    return [partner.id, { paymentTotal, owedToYou: net === undefined ? undefined : Math.max(net, 0) / 100,
      owedToPartner: net === undefined ? undefined : Math.max(-net, 0) / 100 }];
  }));
  const choosePartner = id => {
    setPartnerId(id); setEditingChannel(false); setChannelError(''); setAddingPayment(false);
    setPartnerSplit(null); setBetSplit(null);
    setQuery(''); setTab(id === 'all' ? 'balances' : 'reports');
  };
  async function addPayment(input) {
    setSaving(true);
    try {
      const payment = await savePartnerPayment(input);
      setLedger(current => ({ ...current, payments: [payment, ...current.payments.filter(item => item.id !== payment.id)] }));
      setAddingPayment(false);
    } finally { setSaving(false); }
  }
  async function addPartner(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a partner name.'); return; }
    if (partners.some(partner => partner.name.toLowerCase() === trimmed.toLowerCase())) { setError('That partner already has a tab.'); return; }
    const bps = splitToBps(newSplit);
    if (bps === null) { setError(splitError); return; }
    let channel;
    try { channel = normalizeTelegramChannel(telegramChannel); }
    catch (validationError) { setError(validationError.message); return; }
    setSaving(true); setError('');
    try {
      const partner = await registry.save({ id: window.crypto.randomUUID(), name: trimmed, telegramChannel: channel, splitPercent: bps / 100 });
      choosePartner(partner.id); setName(''); setTelegramChannel(''); setNewSplit('100'); setAdding(false);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  async function savePartnerSplit(event) {
    event.preventDefault();
    const bps = splitToBps(partnerSplit.value);
    if (bps === null) { setPartnerSplit({ ...partnerSplit, error: splitError }); return; }
    setSaving(true);
    try {
      await registry.save({ id: selected.id, name: selected.name, telegramChannel: selected.telegramChannel,
        revision: partnerSplit.revision, splitPercent: bps / 100 }, selected);
      setPartnerSplit(null);
    } catch (failure) {
      setPartnerSplit(current => current === partnerSplit ? { ...current, error: failure.message } : current);
    }
    finally { setSaving(false); }
  }
  async function saveBetSplit(event) {
    event.preventDefault();
    const bps = splitToBps(betSplit.value);
    if (bps === null) { setBetSplit({ ...betSplit, error: splitError }); return; }
    setSaving(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/confirms/bets/${encodeURIComponent(betSplit.id)}/split`, {
        method: 'PATCH', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'confirms' },
        body: JSON.stringify({ splitPercent: bps / 100, revision: betSplit.revision }),
      });
      const result = await response.json();
      if (!response.ok || result.bet?.id !== betSplit.id) throw new Error(result.message || 'Unable to save the bet split.');
      setReport(current => ({ ...current, bets: current.bets.map(bet => bet.id === result.bet.id ? { ...bet, ...result.bet } : bet) }));
      setBetSplit(null);
    } catch (failure) {
      const error = failure.name === 'AbortError' ? 'The request timed out. Refresh the bet report to check the saved split.' : failure.message;
      setBetSplit(current => current === betSplit ? { ...current, error } : current);
    } finally { clearTimeout(timeout); setSaving(false); }
  }
  async function saveChannel(event) {
    event.preventDefault();
    if (!selected) return;
    let channel;
    try { channel = normalizeTelegramChannel(channelDraft); }
    catch (validationError) { setChannelError(validationError.message); return; }
    setSaving(true); setChannelError('');
    try { await registry.save({ id: selected.id, name: selected.name, telegramChannel: channel, revision: selected.revision }, selected); setEditingChannel(false); }
    catch (failure) { setChannelError(failure.message); }
    finally { setSaving(false); }
  }
  const sum = key => {
    const values = scopedPartners.map(partner => key === 'openExposure' ? balance(partner, key) : amounts.get(partner.id)[key]);
    return values.length && values.every(Number.isFinite) ? values.reduce((total, value) => total + cents(value), 0) / 100 : undefined;
  };
  const view = views[tab];
  const rows = tab === 'balances' ? scopedPartners.map(partner => ({
    id: partner.id, partnerId: partner.id,
    cells: [partner.name, `${partner.splitPercent ?? 100}%`, currency(balance(partner, 'openExposure')), currency(balance(partner, 'settledProfit')), currency(balance(partner, 'yourShare')),
      ...['paymentTotal', 'owedToYou', 'owedToPartner'].map(key => currency(amounts.get(partner.id)[key]))],
  })) : tab === 'reports' ? scopedBets.map(bet => {
    const details = [partnerName(bet.partnerId, bet.partnerName), bet.betId || '—', bet.betDate || date(bet.placedAt),
      [bet.event, bet.team && bet.team !== 'Match' ? bet.team : '', bet.selection].filter(Boolean).join(' / ') || '—',
      bet.sport === 'lol' ? 'LoL' : bet.sport === 'hockey' ? 'Hockey' : bet.sport || '—'];
    const grade = bet.status === 'UNGRADED' ? 'Pending' : bet.status || '—';
    const odds = Number.isFinite(bet.odds) && bet.odds > 0 ? `+${bet.odds}` : bet.odds ?? '—';
    return { id: bet.id, partnerId: bet.partnerId, bet,
      cells: [...details, currency(bet.stake), odds, grade, currency(bet.settledProfit), `${bet.splitPercent}%`, currency(bet.yourRisk), currency(bet.yourShare)],
      csv: [...details, bet.stake, bet.odds, grade, bet.settledProfit, bet.splitPercent, bet.yourRisk, bet.yourShare] };
  }) : scopedPayments.map(payment => ({
    id: payment.id, partnerId: payment.partnerId,
    cells: [partnerName(payment.partnerId), date(payment.date), payment.direction || '—', currency(payment.amount), payment.reference || '—', payment.status || '—'],
  }));
  const filtered = rows.filter(row => row.cells.join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const downloadHistory = () => {
    const scope = selected ? selected.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : 'all-partners';
    downloadCsv(`${scope || 'partner'}-bet-history.csv`, view.columns, filtered.map(row => row.csv));
  };
  return <>
    <div className="partner-toolbar">
      <Segments label="Partners" items={[{ value: 'all', label: 'All Partners' }, ...partners.map(partner => ({ value: partner.id, label: partner.name }))]} value={partnerId} onChange={choosePartner} />
      <div><button type="button" className="button button-secondary" disabled={registry.loading || saving} onClick={() => { void registry.reload(); setRefresh(value => value + 1); setPartnerSplit(null); setBetSplit(null); }}>Refresh partners</button><button type="button" className="button button-secondary" disabled={registry.loading || saving} onClick={() => { setAdding(!adding); setEditingChannel(false); setPartnerSplit(null); setError(''); }} aria-expanded={adding} aria-controls="add-partner">{adding ? 'Cancel' : 'Add partner'}</button></div>
    </div>
    {bets === undefined && report.loading && <p role="status">Loading partner bets…</p>}
    {bets === undefined && report.error && <p role="alert" className="sends-error">{report.error} Use Refresh partners to try again.</p>}
    {registry.loading && <p role="status">Loading saved partners…</p>}
    {registry.error && <p role="alert" className="sends-error">{registry.error} Previously loaded partners remain available.</p>}
    {ledger.error && <p role="alert" className="sends-error">{ledger.error} Use Refresh partners to reload payments.</p>}
    {adding && <form id="add-partner" className="partner-form" onSubmit={addPartner}>
      <label htmlFor="partner-name">Partner name</label>
      <div><input autoFocus id="partner-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /></div>
      <label htmlFor="new-partner-split">Split (%)</label>
      <div><input id="new-partner-split" inputMode="decimal" value={newSplit} onChange={event => setNewSplit(event.target.value)} /></div>
      <label htmlFor="partner-telegram">Telegram group (optional)</label>
      <div><input id="partner-telegram" value={telegramChannel} maxLength={200} placeholder="@channel, t.me/channel, or -100…" onChange={event => setTelegramChannel(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Create tab'}</button></div>
      <p id="partner-storage-note">The split is your percentage of the partner’s bets.</p>
      {error && <p id="partner-error" role="alert">{error}</p>}
    </form>}
    {selected && <section className="partner-channel" aria-label={`${selected.name} Telegram channel`}>
      <div className="partner-channel-summary"><div><strong>Telegram channel</strong><p>{selected.telegramChannel || 'No channel added'}</p></div><button type="button" className="button button-secondary" disabled={saving || registry.loading} aria-expanded={editingChannel} aria-controls="edit-partner-channel" onClick={() => { setEditingChannel(!editingChannel); setChannelDraft(selected.telegramChannel || ''); setChannelError(''); setAdding(false); }}>{editingChannel ? 'Cancel' : selected.telegramChannel ? 'Edit channel' : 'Add Telegram channel'}</button></div>
      {editingChannel && <form id="edit-partner-channel" className="partner-form" onSubmit={saveChannel}>
        <label htmlFor="edit-telegram-channel">Telegram channel</label>
        <div><input autoFocus id="edit-telegram-channel" value={channelDraft} maxLength={200} placeholder="@channel, t.me/channel, or -100…" onChange={event => setChannelDraft(event.target.value)} aria-describedby={channelError ? 'channel-error' : 'channel-help'} aria-invalid={!!channelError} /><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save channel'}</button></div>
        <p id="channel-help">Leave blank to remove the channel. Saving does not send messages or import bets.</p>
        {channelError && <p id="channel-error" role="alert">{channelError}</p>}
      </form>}
      <p className="partner-channel-note">{selected.telegramChannel ? 'Channel saved · Available when selecting this partner in Sends' : 'Add a channel username, link, or chat ID for this partner.'}</p>
    </section>}
    {selected && <section className="partner-channel" aria-label={`${selected.name} split settings`}>
      <div className="partner-channel-summary">
        <div><strong>Split (%)</strong><p>{selected.splitPercent ?? 100}%</p></div>
        {savedPartners.has(selected.id) && <button type="button" className="button button-secondary" disabled={saving || registry.loading}
          aria-expanded={!!partnerSplit} aria-controls="edit-partner-split"
          onClick={() => { setPartnerSplit(partnerSplit ? null : { value: String(selected.splitPercent ?? 100), revision: selected.revision }); setAdding(false); }}>
          {partnerSplit ? 'Cancel' : 'Edit partner split'}
        </button>}
      </div>
      {partnerSplit && <form id="edit-partner-split" className="partner-form" onSubmit={savePartnerSplit}>
        <label htmlFor="partner-split-percent">Split (%)</label>
        <div><input autoFocus id="partner-split-percent" inputMode="decimal" value={partnerSplit.value} disabled={saving}
          onChange={event => setPartnerSplit({ ...partnerSplit, value: event.target.value, error: '' })} />
          <button type="submit" className="button button-primary" disabled={saving}>Save partner split</button></div>
        <p>This rate applies when new bets are logged. Edit an individual bet’s split in Bet Reports.</p>
        {partnerSplit.error && <p role="alert">{partnerSplit.error}</p>}
      </form>}
    </section>}
    <StatGrid items={[
      selected ? { label: 'Bet records', value: String(scopedBets.length), note: `${selected.name} · ${scopedPayments.length} payment records`, icon: 'users' } : { label: 'Partners', value: String(partners.length), note: 'Select a partner to see their ledger', icon: 'users' },
      { label: 'Open exposure', value: currency(sum('openExposure')), icon: 'layers' },
      { label: 'Owed to you', value: currency(sum('owedToYou')), note: selected ? `From ${selected.name}` : 'Across all partners', icon: 'wallet' },
      { label: 'Owed to partner', value: currency(sum('owedToPartner')), note: selected ? `To ${selected.name}` : 'Across all partners', icon: 'wallet' },
    ]} />
    <Panel title={`${selected ? `${selected.name} · ` : ''}${view.title}`} description={selected ? 'Bets, agreed shares, and payments for this partner.' : 'Select a partner name to open their detailed ledger.'}
      action={!addingPayment && (selected ? savedPartners.has(selected.id) : savedPartners.size > 0) &&
        <button type="button" className="button button-primary" disabled={saving || ledger.loading || !ledger.loaded} onClick={() => { setAddingPayment(true); setTab('payments'); setQuery(''); }}>Add payment</button>}>
      <div className="panel-controls"><Segments label="Partner accounting views" items={[{ value: 'balances', label: 'Balances' }, { value: 'reports', label: 'Bet reports' }, { value: 'payments', label: 'Payments' }]} value={tab} onChange={setTab} /><SearchField label="Search partner records" placeholder="Search partners or records…" value={query} onChange={setQuery} /></div>
      {tab === 'reports' && <div className="panel-controls">
        <button type="button" className="button button-secondary" disabled={!filtered.length || report.loading || !!report.error || saving}
          onClick={downloadHistory}>Download bet history ({filtered.length})</button>
      </div>}
      {addingPayment && <div hidden={tab !== 'payments'}><PartnerPaymentForm partner={selected} partners={localPartners} saving={saving || ledger.loading}
        onSave={addPayment} onCancel={() => setAddingPayment(false)} /></div>}
      {tab === 'payments' && ledger.loading && <p className="panel-controls" role="status">Loading payment history…</p>}
      <div className="table-scroll"><table className="data-table" aria-label={view.title}><thead><tr>{view.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
        {filtered.map(row => <tr key={row.id}>{row.cells.map((cell, index) => {
          const column = view.columns[index];
          return <td key={column}>
            {index === 0 && findPartner(row.partnerId) ? <button type="button" className="partner-link" onClick={() => choosePartner(row.partnerId)}>{cell}</button> : cell}
            {column === 'Split (%)' && bets === undefined && Number.isInteger(row.bet?.revision) &&
              (betSplit?.id === row.id ? <form className="bet-split-editor" onSubmit={saveBetSplit}>
                <input autoFocus aria-label={`Split for ${row.bet.betId}`} inputMode="decimal" value={betSplit.value} disabled={saving}
                  onChange={event => setBetSplit({ ...betSplit, value: event.target.value, error: '' })} />
                <button type="submit" className="button button-primary" disabled={saving || report.loading}>Save</button>
                <button type="button" className="button button-secondary" disabled={saving} onClick={() => setBetSplit(null)}>Cancel</button>
                {betSplit.error && <p className="sends-error" role="alert">{betSplit.error}</p>}
              </form> : <button type="button" className="partner-link bet-split-edit" disabled={saving || report.loading || !!report.error}
                aria-label={`Edit split for ${row.bet.betId}`}
                onClick={() => setBetSplit({ id: row.id, revision: row.bet.revision, value: String(row.bet.splitPercent) })}>Edit</button>)}
          </td>;
        })}</tr>)}
        {!filtered.length && (tab !== 'payments' || (!ledger.loading && !ledger.error)) && <tr><td colSpan={view.columns.length}><EmptyState icon="users" title={query ? 'No matching records' : view.empty} description={query ? 'Try another search.' : selected ? `Saved records for ${selected.name} will appear here.` : 'Saved partner records will appear here.'} /></td></tr>}
      </tbody></table></div>
    </Panel>
    <InfoNote>Open exposure and balances use your share of each bet. Payments apply at the amount recorded.</InfoNote>
  </>;
}
