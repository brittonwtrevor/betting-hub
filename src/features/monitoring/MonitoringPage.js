import React, { useCallback, useState } from 'react';
import Icon from '../../components/Icon';
import Drawer from '../../components/Drawer';
import { Badge, DetailList, EmptyState, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';
import { sources } from './sources';

const categories = [{ value: 'all', label: 'All sources' }, { value: 'models', label: 'Models' }, { value: 'markets', label: 'Accounts' }, { value: 'messaging', label: 'Messaging' }, { value: 'partners', label: 'Partners' }];

export default function MonitoringPage() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const closeDetails = useCallback(() => setSelected(null), []);
  const filtered = sources.filter(source => (category === 'all' || source.category === category) && `${source.name} ${source.type} ${source.scope}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="setup-banner"><div className="banner-icon"><Icon name="link" size={21} /></div><div><strong>Your monitoring workspace is ready.</strong><p>Connect your sources to start tracking freshness, model runs, and delivery to the hub.</p></div><span className="banner-count">{sources.length} planned sources</span></div>
    <StatGrid items={[
      { label: 'Connected sources', value: '0', suffix: `/ ${sources.length}`, note: 'All connections awaiting setup', icon: 'link' },
      { label: 'Models reporting', value: '0', suffix: `/ ${sources.filter(source => source.category === 'models').length}`, note: 'Hockey, LoL, and NASCAR', icon: 'activity' },
      { label: 'Stale or failed', note: 'Evaluated after sources connect', icon: 'clock' },
      { label: 'Latest hub ingestion', note: 'No outputs received yet', icon: 'database' },
    ]} />
    <div className="monitor-grid">
      <Panel title="Source health" description="Follow every source from its last update to the hub." action={<Badge dot={false}>{sources.length} sources</Badge>}>
        <div className="source-toolbar"><Segments label="Source category" items={categories} value={category} onChange={setCategory} /><SearchField label="Search sources" placeholder="Find a source…" value={query} onChange={setQuery} /></div>
        <div className="table-scroll"><table className="data-table source-table" aria-label="Source health"><thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Last success</th><th scope="col">Ingested</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>{filtered.map(source => <tr key={source.id}><td><button type="button" className="source-name" onClick={() => setSelected(source)}><span className={`source-icon source-icon-${source.category}`}><Icon name={source.icon} size={19} /></span><span><strong>{source.name}</strong><span>{source.type}</span></span></button></td><td><Badge>Not connected</Badge></td><td className="muted">—</td><td className="muted">—</td><td><button type="button" className="icon-button row-detail" aria-label={`View ${source.name} details`} onClick={() => setSelected(source)}><Icon name="chevron" size={16} /></button></td></tr>)}{filtered.length === 0 && <tr><td colSpan={5}><EmptyState compact icon="search" title="No matching sources" description="Try a different search or source category." /></td></tr>}</tbody></table></div>
        <div className="table-footnote"><span className="status-dot" />Planned connections · No freshness checks have run</div>
      </Panel>
      <Panel title="Model → Hub" description="A completed run is only part of the picture.">
        <div className="pipeline-steps">{[{ title: 'Source data updated', detail: 'Inputs are complete and current', icon: 'database' }, { title: 'Model run completed', detail: 'Predictions generated successfully', icon: 'activity' }, { title: 'Outputs published', detail: 'Completed results sent to the hub', icon: 'layers' }, { title: 'Hub ingestion confirmed', detail: 'The latest version is available here', icon: 'grid' }].map((step, index) => <div className="pipeline-step" key={step.title}><span className="step-icon"><Icon name={step.icon} size={17} /></span><div><span className="step-number">STEP {index + 1}</span><strong>{step.title}</strong><p>{step.detail}</p><span className="step-waiting">Awaiting connection</span></div></div>)}</div>
        <div className="panel-bottom-note"><Icon name="clock" size={16} /><span>Each stage will have its own timestamp.</span></div>
      </Panel>
    </div>
    <div className="two-column"><Panel title="Run history" description="Recent runs, their duration, and their outcome."><EmptyState compact icon="activity" title="No runs received yet" description="Model and ingestion activity will appear here when your pipelines report back." /></Panel><Panel title="Needs attention" description="Freshness, coverage gaps, and failed updates."><EmptyState compact icon="bell" title="Waiting for the first health check" description="Late feeds and missing outputs will rise to the top once monitoring is connected." /></Panel></div>
    {selected && <Drawer title={selected.name} onClose={closeDetails}><Badge>Not connected</Badge><p className="drawer-description">{selected.detail}</p><DetailList items={[{ label: 'Coverage', value: selected.scope }, { label: 'Connection type', value: selected.type }, { label: 'Source data updated', value: 'Awaiting connection' }, { label: 'Last successful run', value: 'Awaiting connection' }, { label: 'Outputs published', value: 'Awaiting connection' }, { label: 'Hub ingestion', value: 'Awaiting connection' }, { label: 'Expected schedule', value: 'Not configured' }]} /><h3 className="drawer-section-title">Monitoring coverage</h3><ul className="coverage-list">{selected.checks.map(check => <li key={check}><span className="status-dot" />{check}</li>)}</ul><InfoNote>Connection details and freshness thresholds will be configured when this source is integrated.</InfoNote></Drawer>}
  </>;
}
