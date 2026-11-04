import React, { useState } from 'react';
import { normalizeTelegramChannel } from './telegram';
import { storageKey, readPartners } from './registry';
import { EmptyState, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';

const views = {
  balances: { title: 'Partner balances', columns: ['Partner', 'Open exposure', 'Settled P/L', 'Your share', 'Payments', 'Owed to you', 'Owed to partner'], empty: 'No partner balances yet' },
  reports: { title: 'Bet reports', columns: ['Partner', 'Placed (ET)', 'Event / Selection', 'Sport', 'Stake', 'Odds', 'Status', 'Settled P/L', 'Your share'], empty: 'No partner bets yet' },
  payments: { title: 'Payments', columns: ['Partner', 'Date (ET)', 'Direction', 'Amount', 'Reference', 'Status'], empty: 'No payments recorded' },
};
const currency = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : '—';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
// Connected records can supply published balances without assuming how partners fund bets.
export default function PartnersPage({ partners: connectedPartners = [], bets = [], payments = [] }) {
  const [localPartners, setLocalPartners] = useState(readPartners);
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
  const partners = [...connectedPartners.map(partner => {
    const local = localPartners.find(item => item.id === partner.id || item.name.toLowerCase() === partner.name.toLowerCase());
    return local ? { ...partner, telegramChannel: local.telegramChannel } : partner;
  }), ...localPartners.filter(local => !connectedPartners.some(partner => partner.id === local.id || partner.name.toLowerCase() === local.name.toLowerCase()))];
  const selected = partners.find(partner => partner.id === partnerId);
  const scopedPartners = selected ? [selected] : partners;
  const matchesPartner = record => !selected || record.partnerId === selected.id;
  const scopedBets = bets.filter(matchesPartner);
  const scopedPayments = payments.filter(matchesPartner);
  const partnerName = id => partners.find(partner => partner.id === id)?.name || 'Unknown partner';
  const choosePartner = id => { setPartnerId(id); setEditingChannel(false); setChannelError(''); setQuery(''); setTab(id === 'all' ? 'balances' : 'reports'); };
  function addPartner(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a partner name.'); return; }
    if (partners.some(partner => partner.name.toLowerCase() === trimmed.toLowerCase())) { setError('That partner already has a tab.'); return; }
    let channel;
    try { channel = normalizeTelegramChannel(telegramChannel); }
    catch (validationError) { setError(validationError.message); return; }
    const partner = { id: `local-${window.crypto.randomUUID()}`, name: trimmed, telegramChannel: channel };
    const next = [...localPartners, partner];
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setError('Unable to save this partner in your browser. Please try again.'); return; }
    setLocalPartners(next); choosePartner(partner.id); setName(''); setTelegramChannel(''); setError(''); setAdding(false);
  }
  function saveChannel(event) {
    event.preventDefault();
    if (!selected) return;
    let channel;
    try { channel = normalizeTelegramChannel(channelDraft); }
    catch (validationError) { setChannelError(validationError.message); return; }
    const existing = localPartners.find(partner => partner.id === selected.id || partner.name.toLowerCase() === selected.name.toLowerCase());
    const updated = { id: selected.id, name: selected.name, telegramChannel: channel };
    const next = existing ? localPartners.map(partner => partner === existing ? updated : partner) : [...localPartners, updated];
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setChannelError('Unable to save this channel in your browser. Please try again.'); return; }
    setLocalPartners(next); setEditingChannel(false); setChannelError('');
  }
  const sum = key => scopedPartners.length && scopedPartners.every(partner => Number.isFinite(partner[key])) ? scopedPartners.reduce((total, partner) => total + partner[key], 0) : undefined;
  const view = views[tab];
  const rows = tab === 'balances' ? scopedPartners.map(partner => ({
    id: partner.id, partnerId: partner.id,
    cells: [partner.name, currency(partner.openExposure), currency(partner.settledProfit), currency(partner.yourShare), currency(partner.paymentsTotal), currency(partner.owedToYou), currency(partner.owedToPartner)],
  })) : tab === 'reports' ? scopedBets.map(bet => ({
    id: bet.id, partnerId: bet.partnerId,
    cells: [partnerName(bet.partnerId), date(bet.placedAt), [bet.event, bet.selection].filter(Boolean).join(' / ') || '—', bet.sport || '—', currency(bet.stake), bet.odds ?? '—', bet.status || '—', currency(bet.settledProfit), currency(bet.yourShare)],
  })) : scopedPayments.map(payment => ({
    id: payment.id, partnerId: payment.partnerId,
    cells: [partnerName(payment.partnerId), date(payment.date), payment.direction || '—', currency(payment.amount), payment.reference || '—', payment.status || '—'],
  }));
  const filtered = rows.filter(row => row.cells.join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="partner-toolbar">
      <Segments label="Partners" items={[{ value: 'all', label: 'All Partners' }, ...partners.map(partner => ({ value: partner.id, label: partner.name }))]} value={partnerId} onChange={choosePartner} />
      <button type="button" className="button button-secondary" onClick={() => { setAdding(!adding); setEditingChannel(false); setError(''); }} aria-expanded={adding} aria-controls="add-partner">{adding ? 'Cancel' : 'Add partner'}</button>
    </div>
    {adding && <form id="add-partner" className="partner-form" onSubmit={addPartner}>
      <label htmlFor="partner-name">Partner name</label>
      <div><input autoFocus id="partner-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /></div>
      <label htmlFor="partner-telegram">Telegram group (optional)</label>
      <div><input id="partner-telegram" value={telegramChannel} maxLength={200} placeholder="@channel, t.me/channel, or -100…" onChange={event => setTelegramChannel(event.target.value)} aria-describedby={error ? 'partner-error' : 'partner-storage-note'} /><button type="submit" className="button button-primary">Create tab</button></div>
      <p id="partner-storage-note">Partner names and channels are saved in this browser. Telegram syncing is awaiting connection.</p>
      {error && <p id="partner-error" role="alert">{error}</p>}
    </form>}
    {selected && <section className="partner-channel" aria-label={`${selected.name} Telegram channel`}>
      <div className="partner-channel-summary"><div><strong>Telegram channel</strong><p>{selected.telegramChannel || 'No channel added'}</p></div><button type="button" className="button button-secondary" aria-expanded={editingChannel} aria-controls="edit-partner-channel" onClick={() => { setEditingChannel(!editingChannel); setChannelDraft(selected.telegramChannel || ''); setChannelError(''); setAdding(false); }}>{editingChannel ? 'Cancel' : selected.telegramChannel ? 'Edit channel' : 'Add Telegram channel'}</button></div>
      {editingChannel && <form id="edit-partner-channel" className="partner-form" onSubmit={saveChannel}>
        <label htmlFor="edit-telegram-channel">Telegram channel</label>
        <div><input autoFocus id="edit-telegram-channel" value={channelDraft} maxLength={200} placeholder="@channel, t.me/channel, or -100…" onChange={event => setChannelDraft(event.target.value)} aria-describedby={channelError ? 'channel-error' : 'channel-help'} aria-invalid={!!channelError} /><button type="submit" className="button button-primary">Save channel</button></div>
        <p id="channel-help">Leave blank to remove the channel. Saving does not send messages or import bets.</p>
        {channelError && <p id="channel-error" role="alert">{channelError}</p>}
      </form>}
      <p className="partner-channel-note">{selected.telegramChannel ? 'Channel saved · Telegram syncing is not connected' : 'Add a channel username, link, or chat ID for this partner.'}</p>
    </section>}
    <StatGrid items={[
      selected ? { label: 'Bet records', value: String(scopedBets.length), note: `${selected.name} · ${scopedPayments.length} payment records`, icon: 'users' } : { label: 'Partners', value: String(partners.length), note: 'Select a partner to see their ledger', icon: 'users' },
      { label: 'Open exposure', value: currency(sum('openExposure')), icon: 'layers' },
      { label: 'Owed to you', value: currency(sum('owedToYou')), note: selected ? `From ${selected.name}` : 'Across all partners', icon: 'wallet' },
      { label: 'Owed to partner', value: currency(sum('owedToPartner')), note: selected ? `To ${selected.name}` : 'Across all partners', icon: 'wallet' },
    ]} />
    <Panel title={`${selected ? `${selected.name} · ` : ''}${view.title}`} description={selected ? 'Bets, agreed shares, and payments for this partner.' : 'Select a partner name to open their detailed ledger.'}>
      <div className="panel-controls"><Segments label="Partner accounting views" items={[{ value: 'balances', label: 'Balances' }, { value: 'reports', label: 'Bet reports' }, { value: 'payments', label: 'Payments' }]} value={tab} onChange={setTab} /><SearchField label="Search partner records" placeholder="Search partners or records…" value={query} onChange={setQuery} /></div>
      <div className="table-scroll"><table className="data-table" aria-label={view.title}><thead><tr>{view.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
        {filtered.map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={view.columns[index]}>{index === 0 ? <button type="button" className="partner-link" onClick={() => choosePartner(row.partnerId)}>{cell}</button> : cell}</td>)}</tr>)}
        {!filtered.length && <tr><td colSpan={view.columns.length}><EmptyState icon="users" title={query ? 'No matching records' : view.empty} description={query ? 'Try another search.' : selected ? `Connected records for ${selected.name} will appear here.` : 'Add your partners to create their tabs, then connect their bets and payments.'} /></td></tr>}
      </tbody></table></div>
    </Panel>
    <InfoNote>Balances will show agreed shares and recorded payments once connected. Missing amounts are shown as —.</InfoNote>
  </>;
}
