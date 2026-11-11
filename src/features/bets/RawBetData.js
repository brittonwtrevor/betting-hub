import React, { useEffect, useState } from 'react';
import { EmptyState, Panel, SelectField } from '../../components/ui';
import { usePartners } from '../partners/usePartners';
import { downloadCsv } from '../../utils/downloadCsv';

const pageSize = 50;
const initialFilters = { from: '', through: '', partner: '', sport: '', league: '' };
const columns = [
  ['betId', 'Bet ID'], ['betDate', 'Bet date (ET)'], ['partnerName', 'Partner'],
  ['sport', 'Sport'], ['league', 'League'], ['event', 'Game'], ['team', 'Team'], ['selection', 'Bet'],
  ['stake', 'Risk'], ['odds', 'Odds'], ['status', 'Grade'], ['partialReturn', 'Partial return'], ['settledProfit', 'Net P/L'],
  ['rawResponse', 'Raw response'],
];
const exportColumns = [...columns, ['splitPercent', 'Split (%)'], ['yourRisk', 'Your risk'], ['yourShare', 'Your P/L'],
  ['id', 'Bet row ID'], ['partnerId', 'Partner ID'], ['placedAt', 'Placed at (UTC)'], ['gradedAt', 'Graded at (UTC)']];
const sportNames = { lol: 'League of Legends', hockey: 'Hockey', nascar: 'NASCAR' };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function downloadBets(bets) {
  downloadCsv('raw-bet-data.csv', exportColumns.map(([, label]) => label), bets.map(bet => exportColumns.map(([key]) => bet[key])));
}

function display(key, value) {
  if (value == null || value === '') return '—';
  if (key === 'sport') return sportNames[value] || value;
  if (['stake', 'partialReturn', 'settledProfit'].includes(key)) return money.format(value);
  if (key === 'odds' && value > 0) return `+${value}`;
  if (key === 'status' && value === 'UNGRADED') return 'Pending';
  return value;
}

export default function RawBetData() {
  const { partners } = usePartners();
  const [data, setData] = useState({ bets: [], loading: true, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setData(current => ({ ...current, loading: true, error: '' }));
    (async () => {
      try {
        const response = await fetch('/api/confirms/bets?includeIncomplete=true', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.bets)) throw new Error(result.message || 'Unable to load raw bet data.');
        if (active) setData({ bets: result.bets, loading: false, error: '' });
      } catch (error) {
        if (active) setData(current => ({ ...current, loading: false, error: error.name === 'AbortError' ? 'Loading bets timed out. Try refreshing.' : error.message }));
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [refresh]);

  const partnerLookup = new Map(partners.flatMap(partner => [partner.id, ...(partner.legacyIds || [])].map(id => [id, partner])));
  const bets = data.bets.map(bet => {
    const partner = partnerLookup.get(bet.partnerId);
    return partner ? { ...bet, partnerId: partner.id, partnerName: partner.name } : bet;
  });
  const options = (key, all, label = value => value) => [
    { value: '', label: all },
    ...Array.from(new Map(bets.filter(bet => bet[key]).map(bet => [bet[key], label(bet[key], bet)])), ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const selectedPartner = partnerLookup.get(filters.partner)?.id || filters.partner;
  const invalidDates = filters.from && filters.through && filters.from > filters.through;
  const filtered = invalidDates ? [] : bets.filter(bet => (
    (!filters.from || (bet.betDate && bet.betDate >= filters.from)) &&
    (!filters.through || (bet.betDate && bet.betDate <= filters.through)) &&
    (!selectedPartner || bet.partnerId === selectedPartner) &&
    (!filters.sport || bet.sport === filters.sport) &&
    (!filters.league || bet.league === filters.league)
  ));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const update = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setPage(0); };
  return <Panel>
    <div className="panel-controls raw-bet-controls">
      <div className="filter-row">
        <label className="raw-bet-date">From (ET)<input type="date" value={filters.from} onChange={event => update('from', event.target.value)} /></label>
        <label className="raw-bet-date">Through (ET)<input type="date" value={filters.through} onChange={event => update('through', event.target.value)} /></label>
        <SelectField label="Partner" options={options('partnerId', 'All partners', (id, bet) => bet.partnerName || id)} value={selectedPartner} onChange={value => update('partner', value)} />
        <SelectField label="Sport" options={options('sport', 'All sports', value => sportNames[value] || value)} value={filters.sport} onChange={value => update('sport', value)} />
        <SelectField label="League" options={options('league', 'All leagues')} value={filters.league} onChange={value => update('league', value)} />
        <button type="button" className="button button-secondary" onClick={() => { setFilters(initialFilters); setPage(0); }}>Clear filters</button>
        <button type="button" className="button button-secondary" disabled={data.loading} onClick={() => setRefresh(value => value + 1)}>Refresh data</button>
        <button type="button" className="button button-primary" disabled={!filtered.length || data.loading || !!data.error} onClick={() => downloadBets(filtered)}>Download CSV ({filtered.length.toLocaleString()})</button>
      </div>
      {data.loading && <p role="status">Loading confirmed bets…</p>}
      {data.error && <p role="alert" className="sends-error">{data.error}</p>}
      {invalidDates && <p role="alert" className="sends-error">From must be on or before Through.</p>}
    </div>
    <div className="table-scroll"><table className="data-table" aria-label="Raw bet data">
      <thead><tr>{columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
      <tbody>{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(bet => <tr key={bet.id}>
        {columns.map(([key]) => <td key={key} className={key === 'rawResponse' ? 'bet-raw-response' : undefined}>{display(key, bet[key])}</td>)}
      </tr>)}
        {!filtered.length && !data.loading && !data.error && !invalidDates && <tr><td colSpan={columns.length}><EmptyState icon="inbox" title={bets.length ? 'No bets match these filters' : 'No confirmed bets yet'} /></td></tr>}
      </tbody>
    </table></div>
    <div className="raw-bet-pagination">
      <span>{filtered.length.toLocaleString()} of {bets.length.toLocaleString()} bets</span>
      {pages > 1 && <div><button type="button" className="button button-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage + 1} of {pages}</span>
        <button type="button" className="button button-secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
    </div>
  </Panel>;
}
