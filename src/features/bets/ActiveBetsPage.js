import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Panel } from '../../components/ui';
import { easternTime } from '../sports/lol/upcoming';
import { readPartners } from '../partners/registry';
import { useSends } from './SendsContext';
import { formatOdds } from './markets';

function SendCard({ draft, onSave, onRemove }) {
  const [edited, setEdited] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const registeredPartners = readPartners();
  const partners = [...registeredPartners, ...edited.recipients.filter(partner => !registeredPartners.some(item => item.id === partner.id))];
  const matchup = `${draft.game.team_a} vs ${draft.game.team_b}`;
  const change = next => { setEdited(next); setDirty(true); setSaved(''); };
  function editMarket(id, key, value) { change({ ...edited, markets: edited.markets.map(market => market.id === id ? { ...market, [key]: value } : market) }); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await onSave(edited); setEdited(result); setDirty(false); setSaved('Saved'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await onRemove(draft); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <article className="send-card" aria-label={matchup}>
    <div className="send-card-header"><div><h2>{matchup}</h2><p>League of Legends · {draft.game.league} · {draft.game.series_format || 'Format unknown'} · {easternTime(draft.game.begin_at)}</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={remove}>Remove card</button></div>
    <form onSubmit={save}>
      <div className="table-scroll"><table className="data-table send-markets" aria-label={`${matchup} markets`}><thead><tr><th>Market</th><th>Total / Line</th><th>Model fair</th><th>Play-to price (American)</th><th><span className="sr-only">Remove market</span></th></tr></thead><tbody>
        {edited.markets.map(market => <tr key={market.id}><td>{market.label}</td><td>{market.needsLine ? <input aria-label={`Line for ${market.label}`} inputMode="decimal" maxLength={16} value={market.line} disabled={busy} onChange={event => editMarket(market.id, 'line', event.target.value)} placeholder="Total" /> : market.line || '—'}</td><td>{formatOdds(market.fair)}</td><td><input aria-label={`Play-to price for ${market.label}`} inputMode="text" maxLength={16} value={market.playTo} disabled={busy} onChange={event => editMarket(market.id, 'playTo', event.target.value)} placeholder="+120 or -110" /></td><td><button type="button" className="icon-button" aria-label={`Remove ${market.label}`} disabled={busy || edited.markets.length === 1} onClick={() => change({ ...edited, markets: edited.markets.filter(item => item.id !== market.id) })}>×</button></td></tr>)}
      </tbody></table></div>
      <div className="send-card-details"><fieldset disabled={busy}><legend>Partners / Telegram groups</legend>{!partners.length && <p><a href="#/partners">Add partners and groups in Partner Accounting →</a></p>}{partners.map(partner => <label key={partner.id}><input type="checkbox" checked={edited.recipients.some(item => item.id === partner.id)} onChange={event => change({ ...edited, recipients: event.target.checked ? [...edited.recipients, partner] : edited.recipients.filter(item => item.id !== partner.id) })} /><span>{partner.name}<small>{partner.telegramChannel || 'No group added'}</small></span></label>)}</fieldset><label className="send-notes">Notes<textarea value={edited.notes} maxLength={2000} disabled={busy} onChange={event => change({ ...edited, notes: event.target.value })} /></label></div>
      <div className="send-card-footer"><span>Draft · {edited.markets.length} markets{draft.game.publishedAt ? ` · Model published ${easternTime(draft.game.publishedAt)}` : ''}</span><div>{dirty && <span>Unsaved changes</span>}{saved && <span role="status">{saved}</span>}<button className="button button-primary" type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button></div></div>
      {error && <p role="alert" className="sends-error">{error}</p>}
    </form>
  </article>;
}
export default function ActiveBetsPage() {
  const { drafts, load, save, remove } = useSends();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { await load(); } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);
  return <>
    <div className="sends-toolbar"><div className="segments" role="tablist" aria-label="Active Bets"><button type="button" className="segment active" role="tab" aria-selected="true" aria-controls="sends-panel" id="sends-tab">Sends</button><button type="button" className="segment" role="tab" aria-selected="false" disabled title="Confirmation ingestion will be added later.">Confirms</button></div><button type="button" className="button button-secondary" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh Sends'}</button></div>
    <div id="sends-panel" role="tabpanel" aria-labelledby="sends-tab" className="sends-list">
      {error && <p role="alert" className="sends-error">{error}</p>}
      {loading ? <p role="status">Loading Sends…</p> : drafts?.length ? drafts.map(draft => <SendCard key={draft.id} draft={draft} onSave={save} onRemove={remove} />) : !error && <Panel><EmptyState icon="inbox" title="No Sends drafts yet" description="Select a game in Sports Dashboards or Trading Dashboard, check the markets you want, and add them here." /></Panel>}
    </div>
  </>;
}
