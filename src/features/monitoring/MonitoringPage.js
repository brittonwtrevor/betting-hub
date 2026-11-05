import React, { useCallback, useState } from 'react';
import Icon from '../../components/Icon';
import Drawer from '../../components/Drawer';
import { Badge, DetailList, EmptyState, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';
import { sources } from './sources';
import { sportDashboards } from '../sports/config';
import { easternTime, parseDate } from '../sports/lol/upcoming';
import { models, staleHours } from './modelCoverage';
import { ModelCoverage, useModelCoverage } from './ModelCoveragePanel';
import FeedFreshness from './FeedFreshness';

const categories = [{ value: 'all', label: 'All sources' }, { value: 'models', label: 'Models' }, { value: 'markets', label: 'Accounts' }, { value: 'messaging', label: 'Messaging' }, { value: 'partners', label: 'Partners' }];

export default function MonitoringPage() {
  const { results, reload } = useModelCoverage();
  const [feedRefresh, setFeedRefresh] = useState(0);
  const outputs = Object.values(results);
  const published = outputs.filter(result => result.coverage);
  const issues = Object.entries(results).filter(([, result]) => result.status !== 'Published');
  const latest = published.map(result => parseDate(result.updatedAt)).filter(Boolean).sort((a, b) => b - a)[0];
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const closeDetails = useCallback(() => setSelected(null), []);
  const filtered = sources.filter(source => (category === 'all' || source.category === category) && `${source.name} ${source.type} ${source.scope}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Panel title="Needs attention" description="Hockey and LoL output freshness and availability."
      action={<button className="button button-secondary" type="button" disabled={outputs.length < Object.keys(models).length} onClick={() => { reload(); setFeedRefresh(value => value + 1); }}>Refresh monitoring</button>}>
      {issues.length ? <ul className="panel-padding monitoring-issues">{issues.map(([id, result]) => <li key={id}><strong>{models[id].label}</strong> · {result.status}{result.error ? ` · ${result.error}` : result.status === 'Stale output' ? ` · Last published ${easternTime(result.updatedAt)}` : ' · The output has no publication timestamp.'}</li>)}</ul>
        : <div className="table-footnote" role="status">{outputs.length < Object.keys(models).length ? 'Checking published model outputs…' : 'Both published model outputs are current.'}</div>}
    </Panel>
    <FeedFreshness refresh={feedRefresh} />
    <StatGrid items={[
      { label: 'Model outputs available', value: String(published.length), suffix: '/ 2', icon: 'activity' },
      { label: 'Hockey games', value: results.hockey?.count?.toLocaleString(), note: 'Upcoming in the published slate', icon: 'hockey' },
      { label: 'LoL matches', value: results.lol?.count?.toLocaleString(), note: 'Upcoming in the published slate', icon: 'game' },
      { label: 'Latest publication', value: latest ? easternTime(latest.toISOString()) : '—', icon: 'database' },
    ]} />
    <Panel title="Source health" description="Publication status and run history by source." action={<Badge dot={false}>{sources.length} sources</Badge>}>
      <div className="source-toolbar"><Segments label="Source category" items={categories} value={category} onChange={setCategory} /><SearchField label="Search sources" placeholder="Find a source…" value={query} onChange={setQuery} /></div>
      <div className="table-scroll">
        <table className="data-table source-table" aria-label="Source health">
          <thead><tr>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Last run</th>
            <th scope="col">Duration</th>
            <th scope="col">Run outcome</th>
            <th scope="col">Last success</th>
            <th scope="col">Published</th>
            <th scope="col"><span className="sr-only">Details</span></th>
          </tr></thead>
          <tbody>
            {filtered.map(source => {
              const output = results[source.id];
              return <tr key={source.id}>
              <td><button type="button" className="source-name" onClick={() => setSelected(source)}><span className={`source-icon source-icon-${source.category}`}><Icon name={source.icon} size={19} /></span><span><strong>{source.name}</strong><span>{source.type}</span></span></button></td>
              <td><Badge tone={output?.status === 'Published' ? 'green' : 'neutral'}>{output?.status || (models[source.id] ? 'Checking output…' : 'Not connected')}</Badge></td>
              <td className="muted">—</td>
              <td className="muted">—</td>
              <td className="muted">—</td>
              <td className="muted">—</td>
              <td className="muted">{output?.updatedAt ? easternTime(output.updatedAt) : '—'}</td>
              <td><button type="button" className="icon-button row-detail" aria-label={`View ${source.name} details`} onClick={() => setSelected(source)}><Icon name="chevron" size={16} /></button></td>
            </tr>; })}
            {filtered.length === 0 && <tr><td colSpan={8}><EmptyState compact icon="search" title="No matching sources" description="Try a different search or source category." /></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footnote"><span className="status-dot" />Run history requires collector telemetry.</div>
    </Panel>
    <div className="monitoring-models">{Object.entries(models).map(([id, model]) => <ModelCoverage key={id} model={model} result={results[id]} />)}</div>
    <Panel title="NASCAR data coverage" description="Inputs planned for the NASCAR dashboard.">
      <div className="sport-inputs">{sportDashboards.nascar.inputs.map(input => <div key={input}><span className="status-dot" /><span>{input}</span><span className="muted">Pending</span></div>)}</div>
    </Panel>
    {selected && <Drawer title={selected.name} onClose={closeDetails}><Badge>{results[selected.id]?.status || (models[selected.id] ? 'Checking output…' : 'Not connected')}</Badge><p className="drawer-description">{selected.detail}</p><DetailList items={[{ label: 'Coverage', value: selected.scope }, { label: 'Connection type', value: selected.type }, { label: 'Source data updated', value: 'Awaiting connection' }, { label: 'Last successful run', value: 'Awaiting connection' }, { label: 'Outputs published', value: results[selected.id]?.updatedAt ? easternTime(results[selected.id].updatedAt) : 'Awaiting connection' }, { label: 'Hub ingestion', value: 'Awaiting connection' }, { label: 'Expected schedule', value: 'Not configured' }]} /><h3 className="drawer-section-title">Monitoring coverage</h3><ul className="coverage-list">{selected.checks.map(check => <li key={check}><span className="status-dot" />{check}</li>)}</ul><InfoNote>{models[selected.id] ? `Output becomes stale after ${staleHours} hours. Collector freshness and run durations require separate telemetry.` : 'Connection details and freshness thresholds will be configured when this source is integrated.'}</InfoNote></Drawer>}
  </>;
}
