import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Panel } from '../../components/ui';
import { easternTime, parseDate } from '../sports/lol/upcoming';
import { usePartners } from '../partners/usePartners';
import { useSends } from './SendsContext';
import { formatOdds, gameDescription } from './markets';
import { BetOrder, sortByBetOrder, sportLabel } from './BetOrder';
import ConfirmsInbox from './ConfirmsInbox';
import RawBetData from './RawBetData';

const tabs = { sends: 'Sends', confirms: 'Confirms', raw: 'Raw Bet Data' };

function SendCard({ draft, registeredPartners, partnersReady, onSave, onSend, onRemove }) {
  const [edited, setEdited] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { setEdited(draft); setDirty(false); }, [draft]);
  const identifies = (partner, id) => partner.id === id || partner.legacyIds?.includes(id);
  const partners = [...registeredPartners, ...edited.recipients.filter(partner => !registeredPartners.some(item => identifies(item, partner.id)))];
  const currentRecipients = () => edited.recipients.map(partner => registeredPartners.find(item => identifies(item, partner.id)) || partner);
  const matchup = `${draft.game.team_a} vs ${draft.game.team_b}`;
  const change = next => { setEdited(next); setDirty(true); setSaved(''); };
  function toggleRecipient(partner, checked) {
    const recipients = checked ? [...edited.recipients, partner] : edited.recipients.filter(item => !identifies(partner, item.id));
    change({ ...edited, recipients });
  }
  function editMarket(id, key, value) { change({ ...edited, markets: edited.markets.map(market => market.id === id ? { ...market, [key]: value } : market) }); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await onSave({ ...edited, recipients: currentRecipients() }); setEdited(result); setDirty(false); setSaved('Saved'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await onRemove(draft); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  async function send() {
    setBusy(true); setSending(true); setError(''); setSaved('');
    try {
      const result = await onSend({ ...edited, recipients: currentRecipients() });
      setEdited(result); setDirty(false);
      const incomplete = result.deliveries?.some(item => item.status !== 'sent');
      setSaved(incomplete ? 'Check delivery status below.' : 'Sent to selected Telegram channels.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setSending(false); }
  }
  return <article className="send-card" aria-label={matchup}>
    <div className="send-card-header"><div><h2>{matchup}{draft.betId && <span className="send-bet-id" aria-label={`Bet ID ${draft.betId}`}>{draft.betId}</span>}</h2><p>{gameDescription(draft.game)} · {easternTime(draft.game.begin_at)}</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={remove}>Remove card</button></div>
    <form onSubmit={save}>
      <div className="table-scroll"><table className="data-table send-markets" aria-label={`${matchup} markets`}><thead><tr><th>Market</th><th>Total / Line</th><th>Model fair</th><th>Play-to price (American)</th><th><span className="sr-only">Remove market</span></th></tr></thead><tbody>
        {edited.markets.map(market => <tr key={market.id}><td>{market.label}</td><td>{market.needsLine ? <input aria-label={`Line for ${market.label}`} inputMode="decimal" maxLength={16} value={market.line} disabled={busy} onChange={event => editMarket(market.id, 'line', event.target.value)} placeholder="Total" /> : market.line || '—'}</td><td>{formatOdds(market.fair)}</td><td><input aria-label={`Play-to price for ${market.label}`} inputMode="text" maxLength={16} value={market.playTo} disabled={busy} onChange={event => editMarket(market.id, 'playTo', event.target.value)} placeholder="+120 or -110" /></td><td><button type="button" className="icon-button" aria-label={`Remove ${market.label}`} disabled={busy || edited.markets.length === 1} onClick={() => change({ ...edited, markets: edited.markets.filter(item => item.id !== market.id) })}>×</button></td></tr>)}
        <tr className="send-card-details">
          <th scope="row">Partners / Telegram groups</th>
          <td colSpan={4}>
            <fieldset disabled={busy || !partnersReady}>
              <legend className="sr-only">Partners / Telegram groups</legend>
              {!partners.length && <p><a href="#/partners">Add partners and groups in Partner Accounting →</a></p>}
              {partners.map(partner => {
                const channel = partner.telegramChannel?.trim().toLowerCase();
                const sent = channel && edited.deliveries?.some(delivery => delivery.status === 'sent' &&
                  (delivery.channel?.toLowerCase() === channel || delivery.chatId === channel));
                return <label key={partner.id} className="send-recipient" data-delivery={sent ? 'sent' : 'unsent'}>
                  <input type="checkbox" checked={edited.recipients.some(item => identifies(partner, item.id))} onChange={event => toggleRecipient(partner, event.target.checked)} />
                  <span>{partner.name}<small>{partner.telegramChannel || 'No group added'}{sent && ' · Sent'}</small></span>
                </label>;
              })}
            </fieldset>
          </td>
        </tr>
        <tr className="send-notes"><th scope="row"><label htmlFor={`notes-${draft.id}`}>Notes</label></th><td colSpan={4}><textarea id={`notes-${draft.id}`} value={edited.notes} maxLength={2000} disabled={busy} onChange={event => change({ ...edited, notes: event.target.value })} /></td></tr>
      </tbody></table></div>
      <div className="send-card-footer"><span>{edited.deliveries?.some(item => item.status === 'sent') ? 'Sent' : 'Draft'} · {edited.markets.length} markets{draft.game.publishedAt ? ` · Model published ${easternTime(draft.game.publishedAt)}` : ''}</span><div>{dirty && <span>Unsaved changes</span>}{saved && <span role="status">{saved}</span>}<button className="button button-secondary" type="submit" disabled={busy || !dirty || !partnersReady}>{busy && !sending ? 'Saving…' : 'Save changes'}</button><button className="button button-primary" type="button" disabled={busy || !edited.recipients.length || !partnersReady} onClick={send}>{sending ? 'Sending…' : 'Send to Telegram'}</button></div></div>
      {!!edited.deliveries?.length && <ul className="send-deliveries" aria-label="Telegram delivery status">{edited.deliveries.map(item => <li key={item.key}>{item.name} ({item.channel}) · {item.status === 'sent' ? `Sent ${easternTime(item.sentAt)}` : item.status === 'sending' ? 'Awaiting delivery confirmation — refresh and check the partner chat.' : item.status === 'uncertain' ? 'Delivery unconfirmed — check the partner chat. This message will not be automatically resent.' : `Failed: ${item.error}`}</li>)}</ul>}
      {error && <p role="alert" className="sends-error">{error}</p>}
    </form>
  </article>;
}
export default function ActiveBetsPage({ tab = 'sends' }) {
  const partnerRegistry = usePartners(tab === 'sends');
  const { drafts, load, save, send, remove } = useSends();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendOrder, setSendOrder] = useState('newest');
  const [confirmOrder, setConfirmOrder] = useState('newest');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { await load(); } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { if (tab === 'sends') refresh(); }, [refresh, tab]);
  const orderedDrafts = tab === 'sends' && !loading ? sortByBetOrder(drafts, sendOrder, draft => ({
    date: parseDate(draft.game.begin_at)?.toISOString() || '',
    sport: sportLabel(draft.game.sport || 'lol'),
  })) : [];
  return <>
    <div className="sends-toolbar"><div className="segments" role="tablist" aria-label="Active Bets">{Object.keys(tabs).map(value => <button key={value} type="button" className={`segment${tab === value ? ' active' : ''}`} role="tab" aria-selected={tab === value} aria-controls={`${value}-panel`} id={`${value}-tab`} onClick={() => { window.location.hash = value === 'sends' ? '/bets' : `/bets?tab=${value}`; }}>{tabs[value]}</button>)}</div>{tab === 'sends' && <div className="sends-toolbar-actions">
      <BetOrder value={sendOrder} onChange={setSendOrder} dateLabel="Game date" />
      <button type="button" className="button button-secondary" onClick={() => { void refresh(); void partnerRegistry.reload(); }} disabled={loading || partnerRegistry.loading}>{loading || partnerRegistry.loading ? 'Loading…' : 'Refresh Sends'}</button>
    </div>}</div>
    {tab === 'raw' && <div id="raw-panel" role="tabpanel" aria-labelledby="raw-tab"><RawBetData /></div>}
    {tab === 'confirms' && <div id="confirms-panel" role="tabpanel" aria-labelledby="confirms-tab"><ConfirmsInbox order={confirmOrder} onOrderChange={setConfirmOrder} /></div>}
    {tab === 'sends' && <div id="sends-panel" role="tabpanel" aria-labelledby="sends-tab" className="sends-list">
      {error && <p role="alert" className="sends-error">{error}</p>}
      {partnerRegistry.error && <p role="alert" className="sends-error">{partnerRegistry.error} Refresh Sends to reload partner destinations.</p>}
      {loading ? <p role="status">Loading Sends…</p> : orderedDrafts.length ? orderedDrafts.map(draft => <SendCard key={draft.id} draft={draft} registeredPartners={partnerRegistry.partners} partnersReady={!partnerRegistry.loading && !partnerRegistry.error} onSave={save} onSend={send} onRemove={remove} />) : !error && <Panel><EmptyState icon="inbox" title="No Sends drafts yet" description="Select a game in Hockey, League of Legends, or Trading Dashboard, check the markets you want, and add them here." /></Panel>}
    </div>}
  </>;
}
