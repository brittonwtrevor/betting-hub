import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, InfoNote, Panel, SearchField, SelectField, StatGrid } from '../../components/ui';
import { downloadCsv } from '../../utils/downloadCsv';
import { splitToBps } from '../partners/split';
import { capToCents } from './lukeAllocation';
import './luke.css';

const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const odds = value => value == null ? '—' : value.toFixed(4);
const statuses = ['All statuses', 'Open', 'Partially settled', 'Settled', 'Needs review'].map((label, index) => ({ value: index ? label : '', label }));
const columns = ['Bet ID', 'Game', 'First fill (ET)', 'Fills', 'Status', 'Original risk after splits', 'Pregame avg. decimal', 'Allocation', 'Risk / to-win cap ($)', 'Luke risk', 'Confirms P/L after splits', 'Avg. settled odds', 'Luke net P/L'];
const sum = (rows, key) => rows.some(row => row[key] == null) ? null : rows.reduce((total, row) => total + row[key], 0);

async function request(options = {}, path = '') {
  const response = await fetch(`/api/luke-originator${path}`, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'luke-originator' },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !(result?.settings || result?.settlement || result?.row)) throw new Error(result?.message || 'Unable to load Luke Originator.');
  return result;
}

export default function LukeOriginatorPage() {
  const [report, setReport] = useState(null);
  const [allocation, setAllocation] = useState('45');
  const [capEdits, setCapEdits] = useState({});
  const [savingCapBetId, setSavingCapBetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settlingBetId, setSettlingBetId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');

  const refresh = useCallback(async signal => {
    setLoading(true); setError('');
    try {
      const result = await request({ signal });
      if (!Array.isArray(result.rows)) throw new Error('Unable to load Luke’s bet report.');
      if (!signal?.aborted) { setReport(result); setAllocation(String(result.settings.allocationPercent)); }
    } catch (error) { if (!signal?.aborted) setError(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { controller.abort(); };
  }, [refresh]);

  async function save(event) {
    event.preventDefault();
    if (splitToBps(allocation) == null) { setError('Enter an allocation from 0% to 100% with up to two decimal places.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await request({ method: 'PATCH', body: JSON.stringify({ allocationPercent: allocation, revision: report.settings.revision }) });
      await refresh();
      setNotice('Settings saved for all NCAA hockey Bet IDs.');
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }

  async function saveCap(event, row) {
    event.preventDefault();
    const riskWinCap = capEdits[row.betId] ?? String(row.riskWinCap);
    if (capToCents(riskWinCap) == null) { setError('Enter a risk / to-win cap greater than $0, up to $10,000,000, with at most two decimal places.'); return; }
    setSavingCapBetId(row.betId); setError(''); setNotice('');
    try {
      const result = await request({ method: 'PATCH', body: JSON.stringify({ riskWinCap, capRevision: row.capRevision ?? 0 }) }, `/caps/${row.betId}`);
      if (result.row?.betId !== row.betId) throw new Error('Unable to load the updated cap. Refresh Confirms.');
      setReport(current => ({ ...current, rows: current.rows.map(item => item.betId === row.betId ? result.row : item) }));
      setCapEdits(current => { const next = { ...current }; delete next[row.betId]; return next; });
      setNotice(`Cap saved for ${row.betId}.`);
    } catch (error) { setError(error.message); }
    finally { setSavingCapBetId(''); }
  }

  async function markSettled(row, checked) {
    setSettlingBetId(row.betId); setError(''); setNotice('');
    try {
      const result = await request({ method: 'PATCH', body: JSON.stringify({ settledWithLuke: checked,
        settlementRevision: row.settlementRevision ?? 0 }) }, `/settlements/${row.betId}`);
      if (result.settlement?.betId !== row.betId || typeof result.settlement.settledWithLuke !== 'boolean') throw new Error('Unable to save the settlement check. Refresh Confirms and try again.');
      setReport(current => ({ ...current, rows: current.rows.map(item => item.betId === row.betId ? { ...item, ...result.settlement } : item) }));
      setNotice(`${row.betId} ${checked ? 'marked settled with Luke' : 'marked not settled with Luke'}.`);
    } catch (error) { setError(error.message); }
    finally { setSettlingBetId(''); }
  }

  const rows = (report?.rows || []).filter(row => (!status || row.status === status) &&
    (!from || row.firstFillDate >= from) && (!through || row.firstFillDate <= through) &&
    `${row.betId} ${row.event} ${row.selections}`.toLowerCase().includes(search.trim().toLowerCase()));
  const missingHistory = rows.some(row => row.missingHistory);
  const stats = [
    { label: 'Bet IDs', value: rows.length, note: 'NCAA hockey · all partners', icon: 'layers' },
    { label: 'Luke allocated risk', value: money(sum(rows, 'lukeRisk')), note: 'Partner splits applied before Luke’s allocation', icon: 'wallet' },
    { label: 'Luke open risk', value: money(sum(rows, 'openRisk')), note: 'Share awaiting settlement', icon: 'activity' },
    { label: 'Luke net P/L', value: money(sum(rows, 'lukeProfit')), note: 'From Confirms after partner splits · excludes stake' },
  ];
  function exportRows() {
    downloadCsv('luke-originator.csv', [...columns, 'Wagers', 'Original history available', 'Settled with Luke'], rows.map(row => [
      row.betId, row.event, row.firstFillDate, row.fills, row.status, row.totalAmount, row.pregameOdds,
      row.allocationPercent, row.riskWinCap, row.lukeRisk, row.confirmsProfit, row.settledOdds, row.lukeProfit, row.selections, !row.missingHistory, row.settledWithLuke ? 'Yes' : 'No',
    ]));
  }

  return <>
    <div className="luke-heading"><div><h1>Luke Originator</h1><p>NCAA hockey · one allocation per Bet ID · after partner splits</p></div>
      <button type="button" className="button button-secondary" disabled={loading || saving || !!settlingBetId || !!savingCapBetId} onClick={() => { void refresh(); }}>Refresh Confirms</button>
    </div>
    <form className="luke-allocation" onSubmit={save}>
      <div className="luke-settings-fields">
        <label htmlFor="luke-allocation">Luke allocation (%)<input id="luke-allocation" type="number" min="0" max="100" step="0.01" required value={allocation}
          disabled={!report || saving || loading} onChange={event => { setAllocation(event.target.value); setNotice(''); }} /></label>
        <button type="submit" className="button button-primary" disabled={!report || saving || loading || !!settlingBetId || !!savingCapBetId || Number(allocation) === report.settings.allocationPercent}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>
      <p>Allocation applies to all NCAA hockey Bet IDs, including history. Set and save the risk / to-win cap separately in each Bet ID’s table row.</p>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="sends-error">{error} Refresh Confirms to try again.</p>}
    {loading && !report && <p role="status">Loading Luke’s NCAA hockey bets…</p>}
    {report && <>
      <StatGrid items={stats} />
      <Panel title="NCAA hockey allocations" description="Each partner’s current split is applied to their original risk and Confirms P/L before combining the Bet ID and calculating Luke’s allocation and cap. Average odds are weighted by risk after splits. Check the box beside a Bet ID once settled with Luke."
        action={<button type="button" className="button button-secondary" disabled={!rows.length || loading || !!settlingBetId || !!savingCapBetId} onClick={exportRows}>Download CSV</button>}>
        <div className="luke-filters">
          <SearchField label="Search Luke bets" placeholder="Bet ID, game, or wager…" value={search} onChange={setSearch} />
          <SelectField label="Status" value={status} onChange={setStatus} options={statuses} />
          <label>From (ET)<input type="date" value={from} max={through || undefined} onChange={event => setFrom(event.target.value)} /></label>
          <label>Through (ET)<input type="date" value={through} min={from || undefined} onChange={event => setThrough(event.target.value)} /></label>
          <button type="button" className="button button-secondary" onClick={() => { setFrom(''); setThrough(''); setStatus(''); setSearch(''); }}>Clear filters</button>
        </div>
        <div className="table-scroll"><table className="data-table luke-table" aria-label="Luke allocations by Bet ID">
          <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.betId}>
            <th scope="row"><div className="luke-bet-id"><input type="checkbox" aria-label={`Settled with Luke for ${row.betId}`}
              title="Settled with Luke" checked={!!row.settledWithLuke} disabled={loading || saving || !!settlingBetId || !!savingCapBetId}
              onChange={event => { void markSettled(row, event.target.checked); }} /><a href="#/bets?tab=confirms">{row.betId}</a></div></th>
            <td className="luke-game" title={row.selections}>{row.event || '—'}{row.missingHistory > 0 && <span className="luke-history">Original history unavailable for {row.missingHistory} fill{row.missingHistory === 1 ? '' : 's'}</span>}</td>
            <td>{row.firstFillDate || '—'}</td><td>{row.fills}</td><td>{row.status}</td>
            <td>{money(row.totalAmount)}</td><td>{odds(row.pregameOdds)}</td><td>{row.allocationPercent}%</td>
            <td><form className="luke-bet-cap" onSubmit={event => { void saveCap(event, row); }}>
              <input type="number" min="0.01" max="10000000" step="0.01" required
                aria-label={`Risk / to-win cap for ${row.betId} ($)`}
                title="Above 2.00 decimal: maximum risk. At or below 2.00: maximum to win."
                value={capEdits[row.betId] ?? String(row.riskWinCap)} disabled={loading || saving || !!settlingBetId || !!savingCapBetId}
                onChange={event => { const value = event.target.value; setCapEdits(current => ({ ...current, [row.betId]: value })); setNotice(''); }} />
              <button type="submit" className="button button-secondary" aria-label={`Save cap for ${row.betId}`}
                disabled={loading || saving || !!settlingBetId || !!savingCapBetId || Number(capEdits[row.betId] ?? row.riskWinCap) === row.riskWinCap}>{savingCapBetId === row.betId ? 'Saving…' : 'Save'}</button>
            </form></td>
            <td>{money(row.lukeRisk)}</td><td>{money(row.confirmsProfit)}</td><td>{odds(row.settledOdds)}</td>
            <td className={row.lukeProfit > 0 ? 'luke-profit' : row.lukeProfit < 0 ? 'luke-loss' : ''}>{money(row.lukeProfit)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={columns.length}><EmptyState compact icon="hockey" title="No NCAA hockey Bet IDs match"
            description="NCAA hockey fills logged in Confirms appear here automatically. Clear filters to see all dates." /></td></tr>}</tbody>
        </table></div>
      </Panel>
      <InfoNote>Each Bet ID has its own risk / to-win cap: above 2.00 decimal it limits risk; at or below 2.00 it limits the amount to win. Luke net P/L = Luke risk × Confirms P/L after partner splits ÷ original risk after partner splits. A 50% partner contributes half their original stake and half their P/L before Luke’s allocation. Voids and resettlements change P/L, while the original fill amounts and pregame odds stay fixed. Open and partially settled rows show P/L to date; average settled odds appears once every fill is graded.</InfoNote>
      {missingHistory && <InfoNote>Some older fills have no complete original audit entry. Their earliest available values are the current Confirms amount and odds; verify those before using these allocations.</InfoNote>}
    </>}
  </>;
}
