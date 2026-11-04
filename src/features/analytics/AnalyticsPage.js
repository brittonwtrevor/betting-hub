import React, { useState } from 'react';
import { EmptyState, EmptyTable, ExportButton, InfoNote, Panel, Segments, SelectField, StatGrid, sportOptions } from '../../components/ui';
export default function AnalyticsPage() {
  const [period, setPeriod] = useState('week');
  const [sport, setSport] = useState('all');
  const [scope, setScope] = useState('your-share');
  const [basis, setBasis] = useState('settled');
  const [breakdown, setBreakdown] = useState('Sport');
  const [chart, setChart] = useState('profit');
  return <>
    <div className="analytics-filters"><div className="filter-row"><SelectField label="Period" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'This week' }, { value: 'last-week', label: 'Last week' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'all', label: 'All time' }]} /><SelectField label="Sport" value={sport} onChange={setSport} options={sportOptions} /><SelectField label="Scope" value={scope} onChange={setScope} options={[{ value: 'your-share', label: 'Your share' }, { value: 'group', label: 'Full group' }]} /><SelectField label="Date basis" value={basis} onChange={setBasis} options={[{ value: 'settled', label: 'Settlement date' }, { value: 'placed', label: 'Placement date' }]} /></div><ExportButton /></div>
    <StatGrid items={[{ label: 'Amount bet', icon: 'wallet' }, { label: 'Net profit / loss', icon: 'chart' }, { label: 'ROI', icon: 'activity' }, { label: 'Fees', icon: 'layers' }]} />
    <Panel title="Performance over time" description={`${scope === 'your-share' ? 'Your financial share' : 'Full group activity'} · By ${basis === 'settled' ? 'settlement' : 'placement'} date`} action={<Segments label="Performance measure" items={[{ value: 'profit', label: 'Profit / loss' }, { value: 'handle', label: 'Amount bet' }]} value={chart} onChange={setChart} />}><div className="chart-placeholder"><div className="chart-grid" aria-hidden="true" /><EmptyState icon="chart" title={chart === 'profit' ? 'Your performance, over time' : 'Your betting activity, over time'} description="Connect your betting records to see trends for the selected period and scope." /></div></Panel>
    <Panel title="Performance breakdown" description="Explore the detail behind your results."><div className="panel-filters"><Segments label="Break down performance by" value={breakdown} onChange={setBreakdown} items={['Sport', 'League', 'Account', 'Partner', 'Strategy'].map(value => ({ value, label: value }))} /></div><EmptyTable columns={[breakdown, 'Bets', 'Amount bet', 'Won', 'Lost', 'Fees', 'Net P/L', 'ROI']} icon="database" title={`No ${breakdown.toLowerCase()} results yet`} description="Results and downloadable ledgers will become available after placements and settlements are connected." /></Panel>
    <InfoNote>Exports will include the full placement ledger and filtered results, with separate statements for each partner.</InfoNote>
  </>;
}
