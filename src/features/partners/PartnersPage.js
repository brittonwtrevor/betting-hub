import React, { useEffect, useState } from 'react';
import { normalizeTelegramChannel } from './telegram';
import { listPartnerPayments, savePartnerPayment, usePartners } from './usePartners';
import PartnerPaymentForm from './PartnerPaymentForm';
import { EmptyState, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';

const views = {
  balances: { title: 'Partner balances', columns: ['Partner', 'Open exposure', 'Settled P/L', 'Your share', 'Net payments received', 'Owed to you', 'Owed to partner'], empty: 'No partner balances yet' },
  reports: { title: 'Bet reports', columns: ['Partner', 'Bet ID', 'Bet date (ET)', 'Event / Selection', 'Sport', 'Risk', 'Odds', 'Grade', 'Net P/L', 'Your share'], empty: 'No partner bets yet' },
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
  const reportBets = (bets ?? report.bets).map(bet => ({ ...bet, partnerId: findPartner(bet.partnerId)?.id ?? bet.partnerId }));
  const scopedBets = reportBets.filter(matchesPartner);
  const savedPartners = new Set(localPartners.map(partner => partner.id));
  const recordedNet = paymentNet(ledger.payments);
  const connectedNet = paymentNet(payments);
  const scopedPayments = [...ledger.payments, ...payments].filter(matchesPartner);
  const partnerName = (id, fallback) => findPartner(id)?.name || fallback || 'Unknown partner';
  const reportTotals = new Map();
  for (const bet of reportBets) {
    if (!bet.betId) continue;
    const totals = reportTotals.get(bet.partnerId) ?? { openCents: 0, settledCents: 0 };
    if (bet.status === 'UNGRADED' && Number.isFinite(bet.stake)) totals.openCents += cents(bet.stake);
    if (bet.status !== 'UNGRADED' && Number.isFinite(bet.settledProfit)) totals.settledCents += cents(bet.settledProfit);
    reportTotals.set(bet.partnerId, totals);
  }
  const balance = (partner, key) => {
    const totals = reportTotals.get(partner.id);
    if (partner[key] != null || !totals) return partner[key];
    if (key === 'openExposure') return totals.openCents / 100;
    if (key === 'settledProfit') return totals.settledCents / 100;
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
        net = cents(settledProfit ?? 0) - (totalPayments ?? 0) - recorded;
      }
    }
    return [partner.id, { paymentTotal, owedToYou: net === undefined ? undefined : Math.max(net, 0) / 100,
      owedToPartner: net === undefined ? undefined : Math.max(-net, 0) / 100 }];
  }));
  const choosePartner = id => {
    setPartnerId(id); setEditingChannel(false); setChannelError(''); setAddingPayment(false);
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
    let channel;
    try { channel = normalizeTelegramChannel(telegramChannel); }
    catch (validationError) { setError(validationError.message); return; }
    setSaving(true); setError('');
    try {
      const partner = await registry.save({ id: window.crypto.randomUUID(), name: trimmed, telegramChannel: channel });
      choosePartner(partner.id); setName(''); setTelegramChannel(''); setAdding(false);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
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
    cells: [partner.name, currency(balance(partner, 'openExposure')), currency(balance(partner, 'settledProfit')), currency(partner.yourShare),
      ...['paymentTotal', 'owedToYou', 'owedToPartner'].map(key => currency(amounts.get(partner.id)[key]))],
  })) : tab === 'reports' ? scopedBets.map(bet => ({
    id: bet.id, partnerId: bet.partnerId,
    cells: [partnerName(bet.partnerId, bet.partnerName), bet.betId || '—', bet.betDate || date(bet.placedAt),
      [bet.event, bet.team && bet.team !== 'Match' ? bet.team : '', bet.selection].filter(Boolean).join(' / ') || '—',
      bet.sport === 'lol' ? 'LoL' : bet.sport === 'hockey' ? 'Hockey' : bet.sport || '—',
      currency(bet.stake), Number.isFinite(bet.odds) && bet.odds > 0 ? `+${bet.odds}` : bet.odds ?? '—',
      bet.status === 'UNGRADED' ? 'Pending' : bet.status || '—', currency(bet.settledProfit), currency(bet.yourShare)],
  })) : scopedPayments.map(payment => ({
    id: payment.id, partnerId: payment.partnerId,
    cells: [partnerName(payment.partnerId), date(payment.date), payment.direction || '—', currency(payment.amount), payment.reference || '—', payment.status || '—'],
  }));
  const filtered = rows.filter(row => row.cells.join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="partner-toolbar">
      <Segments label="Partners" items={[{ value: 'all', label: 'All Partners' }, ...partners.map(partner => ({ value: partner.id, label: partner.name }))]} value={partnerId} onChange={choosePartner} />
      <div><button type="button" className="button button-secondary" disabled={registry.loading || saving} onClick={() => { void registry.reload(); setRefresh(value => value + 1); }}>Refresh partners</button><button type="button" className="button button-secondary" disabled={registry.loading || saving} onClick={() => { setAdding(!adding); setEditingChannel(false); setError(''); }} aria-expanded={adding} aria-controls="add-partner">{adding ? 'Cancel' : 'Add partner'}</button></div>
    </div>
    {bets === undefined && report.loading && <p role="status">Loading partner bets…</p>}
    {bets === undefined && report.error && <p role="alert" className="sends-error">{report.error} Use Refresh partners to try again.</p>}
    {registry.loading && <p role="status">Loading saved partners…</p>}
    {registry.error && <p role="alert" className="sends-error">{registry.error} Previously loaded partners remain available.</p>}
    {ledger.error && <p role="alert" className="sends-error">{ledger.error} Use Refresh partners to reload payments.</p>}
    {adding && <form id="add-partner" className="partner-form" onSubmit={addPartner}>
      <label htmlFor="partner-name">Partner name</label>
      <div><input autoFocus id="partner-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /></div>
      <label htmlFor="partner-telegram">Telegram group (optional)</label>
      <div><input id="partner-telegram" value={telegramChannel} maxLength={200} placeholder="@channel, t.me/channel, or -100…" onChange={event => setTelegramChannel(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Create tab'}</button></div>
      <p id="partner-storage-note">Partner names and channels are saved to the shared database and available across devices.</p>
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
      {addingPayment && <div hidden={tab !== 'payments'}><PartnerPaymentForm partner={selected} partners={localPartners} saving={saving || ledger.loading}
        onSave={addPayment} onCancel={() => setAddingPayment(false)} /></div>}
      {tab === 'payments' && ledger.loading && <p className="panel-controls" role="status">Loading payment history…</p>}
      <div className="table-scroll"><table className="data-table" aria-label={view.title}><thead><tr>{view.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
        {filtered.map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={view.columns[index]}>{index === 0 && findPartner(row.partnerId) ? <button type="button" className="partner-link" onClick={() => choosePartner(row.partnerId)}>{cell}</button> : cell}</td>)}</tr>)}
        {!filtered.length && (tab !== 'payments' || (!ledger.loading && !ledger.error)) && <tr><td colSpan={view.columns.length}><EmptyState icon="users" title={query ? 'No matching records' : view.empty} description={query ? 'Try another search.' : selected ? `Saved records for ${selected.name} will appear here.` : 'Saved partner records will appear here.'} /></td></tr>}
      </tbody></table></div>
    </Panel>
    <InfoNote>Balances use settled bet P/L and recorded payments. Payments you send reduce what you owe, and payments you receive reduce what partners owe you.</InfoNote>
  </>;
}
