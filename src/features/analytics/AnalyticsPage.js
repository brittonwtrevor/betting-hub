import React, { useEffect, useState } from 'react';
import { EmptyState, InfoNote, Panel, Segments, SelectField, StatGrid, sportOptions } from '../../components/ui';
import { usePartners } from '../partners/usePartners';
import { periodBounds, reportBets, summarize } from './partnerResults';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const money = value => value == null ? '—' : currency.format(value);
const percent = value => value == null ? '—' : percentage.format(value);
const all = '*';
const periods = [
  { value: 'all', label: 'All time' },
  { value: 'week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];
const views = [{ value: 'settled', label: 'Settled' }, { value: 'open', label: 'Unsettled' }];
const dateOptions = [{ value: 'settled', label: 'Settlement date' }, { value: 'placed', label: 'Placement date' }];
const groups = [
  { value: 'partnerId', label: 'Partner', name: bet => bet.partnerName },
  { value: 'sport', label: 'Sport', name: bet => sportName(bet.sport) },
  { value: 'league', label: 'League', name: bet => bet.league || 'Unknown league' },
  { value: 'reportDate', label: 'Date (ET)', name: bet => bet.reportDate || 'Unknown date' },
];

function sportName(sport) {
  return sportOptions.find(option => option.value === sport)?.label || sport || 'Unknown sport';
}

function filterOptions(bets, key, name, allLabel) {
  const labels = new Map(bets.map(bet => [bet[key] || '', name(bet)]));
  return [
    { value: all, label: allLabel },
    ...Array.from(labels, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

function Breakdown({ bets, group, open }) {
  const buckets = new Map();
  for (const bet of bets) {
    const key = bet[group.value];
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(bet);
  }
  const rows = Array.from(buckets, ([key, records]) => ({ key, label: group.name(records[0]), ...summarize(records) }));
  rows.sort((a, b) => group.value === 'reportDate'
    ? (b.key || '').localeCompare(a.key || '') : a.label.localeCompare(b.label));
  const columns = open ? ['Bets', 'Open risk', 'Potential profit']
    : ['Bets', 'Graded risk', 'Wins', 'Losses', 'Voids', 'Partial returns', 'Win rate', 'Net P/L', 'ROI'];
  const label = `${open ? 'Unsettled' : 'Settled'} bets by ${group.label.toLowerCase()}`;

  return <div className="table-scroll">
    <table className="data-table analytics-breakdown" aria-label={label}>
      <thead><tr>{[group.label, ...columns].map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.key ?? ''}>
          <th scope="row">{row.label}</th>
          <td>{row.count}</td>
          <td>{money(row.risk)}</td>
          {open ? <td>{money(row.potential)}</td> : <>
            <td>{row.outcomes.WIN}</td><td>{row.outcomes.LOSS}</td>
            <td>{row.outcomes.VOID}</td><td>{row.outcomes.PARTRETURN}</td>
            <td>{percent(row.winRate)}</td><td>{money(row.profit)}</td><td>{percent(row.roi)}</td>
          </>}
        </tr>)}
        {!rows.length && <tr><td colSpan={columns.length + 1}>
          <EmptyState compact icon="database" title={`No ${open ? 'unsettled' : 'settled'} bets match these filters`}
            description="Change the filters to see other confirmed bets." />
        </td></tr>}
      </tbody>
    </table>
  </div>;
}

export default function AnalyticsPage() {
  const registry = usePartners();
  const [report, setReport] = useState({ bets: [], loading: true, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState('settled');
  const [period, setPeriod] = useState('all');
  const [sport, setSport] = useState(all);
  const [partner, setPartner] = useState(all);
  const [basis, setBasis] = useState('settled');
  const [groupKey, setGroupKey] = useState('partnerId');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setReport(current => ({ ...current, loading: true, error: '' }));
    (async () => {
      try {
        const response = await fetch('/api/confirms/bets', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(result?.bets)) throw new Error(result?.message || 'Unable to load confirmed bets.');
        if (active) setReport({ bets: result.bets, loading: false, error: '' });
      } catch (error) {
        if (active) setReport({ bets: [], loading: false, error: error.name === 'AbortError' ? 'Loading confirmed bets timed out.' : error.message });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [refresh]);

  const open = view === 'open';
  const bets = reportBets(report.bets, registry.partners, basis);
  const bounds = periodBounds(period);
  const partnerOptions = filterOptions(bets, 'partnerId', bet => bet.partnerName, 'All partners');
  const sports = filterOptions(bets, 'sport', bet => sportName(bet.sport), 'All sports');
  const partnerId = registry.partners.find(item => item.legacyIds?.includes(partner))?.id || partner;
  const selectedPartner = partnerOptions.some(option => option.value === partnerId) ? partnerId : all;
  const selectedSport = sports.some(option => option.value === sport) ? sport : all;
  const filtered = bets.filter(bet =>
    bet.open === open &&
    (selectedPartner === all || bet.partnerId === selectedPartner) &&
    (selectedSport === all || bet.sport === selectedSport) &&
    (!bounds || (bet.reportDate >= bounds[0] && bet.reportDate <= bounds[1]))
  );
  const totals = summarize(filtered);
  const group = groups.find(item => item.value === groupKey);
  const stats = open ? [
    { label: 'Unsettled bets', value: totals.count, note: 'Awaiting a grade', icon: 'layers' },
    { label: 'Open risk', value: money(totals.risk), note: 'Total stake on unsettled bets', icon: 'wallet' },
    { label: 'Potential profit', value: money(totals.potential), note: 'Combined profit if every open bet wins' },
    { label: 'Average stake', value: money(totals.count ? totals.risk / totals.count : null), note: 'Open risk per bet', icon: 'activity' },
  ] : [
    { label: 'Settled bets', value: totals.count, note: `${totals.outcomes.WIN} wins · ${totals.outcomes.LOSS} losses · ${totals.outcomes.VOID} voids · ${totals.outcomes.PARTRETURN} partial returns`, icon: 'layers' },
    { label: 'Graded risk', value: money(totals.risk), note: 'Total stake on graded bets', icon: 'wallet' },
    { label: 'Net P/L', value: money(totals.profit), note: 'Includes signed partial returns' },
    { label: 'ROI', value: percent(totals.roi), note: 'Net P/L divided by non-void stake', icon: 'activity' },
  ];

  return <>
    <div className="analytics-filters">
      <div className="filter-row">
        <SelectField label="Period (ET)" value={period} onChange={setPeriod} options={periods} />
        <SelectField label="Partner" value={selectedPartner} onChange={setPartner} options={partnerOptions} />
        <SelectField label="Sport" value={selectedSport} onChange={setSport} options={sports} />
        {!open && <SelectField label="Date basis" value={basis} onChange={setBasis} options={dateOptions} />}
      </div>
      <button type="button" className="button button-secondary" disabled={report.loading}
        onClick={() => { void registry.reload(); setRefresh(value => value + 1); }}>Refresh bets</button>
    </div>
    <Segments label="Bet status" items={views} value={view} onChange={setView} />
    {report.loading ? <p role="status">Loading confirmed bets…</p> : report.error
      ? <p role="alert" className="sends-error">{report.error} Use Refresh bets to try again.</p>
      : <>
        {registry.error && <InfoNote>Saved partner names are unavailable. The report uses names from Confirms where needed.</InfoNote>}
        <StatGrid items={stats} />
        <Panel title={open ? 'Open exposure breakdown' : 'Settled performance breakdown'}
          description={open ? 'Based on placement date in Eastern time.' : `Based on ${basis === 'settled' ? 'settlement' : 'placement'} date in Eastern time.`}>
          <div className="panel-filters">
            <Segments label="Break down by" items={groups} value={groupKey} onChange={setGroupKey} />
          </div>
          <Breakdown bets={filtered} group={group} open={open} />
        </Panel>
        <InfoNote>Figures use the full confirmed stakes across partners.{!open && ' Win rate uses wins and losses only.'}</InfoNote>
      </>}
  </>;
}
