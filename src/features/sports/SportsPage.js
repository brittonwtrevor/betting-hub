import React, { useState } from 'react';
import { sports } from '../../app/navigation';
import Icon from '../../components/Icon';
import { Badge, DetailList, EmptyTable, Panel, Segments, StatGrid } from '../../components/ui';
import { sportDashboards } from './config';
import LolUpcomingGames from './lol/LolUpcomingGames';
export default function SportsPage({ sportId }) {
  const config = sportDashboards[sportId];
  const [viewId, setViewId] = useState(config.views[0].id);
  const view = config.views.find(item => item.id === viewId) || config.views[0];
  return <>
    <nav className="sport-tabs" aria-label="Sports dashboards">{sports.map(sport => <a key={sport.id} href={`#/sports/${sport.id}`} className={sport.id === sportId ? 'sport-tab active' : 'sport-tab'} aria-current={sport.id === sportId ? 'page' : undefined}><Icon name={sport.icon} size={19} />{sport.label}</a>)}</nav>
    {sportId === 'lol' ? <LolUpcomingGames /> : <>
    <div className={`sport-intro sport-intro-${sportId}`}><div className="sport-intro-icon"><Icon name={config.icon} size={30} /></div><div><p className="eyebrow">SPORTS INTELLIGENCE</p><h2>{config.label}</h2><p>{config.description}</p></div><Badge>Awaiting data</Badge></div>
    <StatGrid items={config.metrics.map(label => ({ label }))} />
    <div className="research-grid"><Panel title={view.label} description={view.description}><div className="panel-filters"><Segments label={`${config.label} views`} items={config.views.map(item => ({ value: item.id, label: item.label }))} value={view.id} onChange={setViewId} /></div><EmptyTable columns={view.columns} icon={config.icon} title={`${view.label} is ready for data`} description={`Connect your ${config.label} outputs to populate this workspace.`} /></Panel><Panel title="Data coverage" description="The inputs behind this dashboard."><div className="sport-inputs">{config.inputs.map(input => <div key={input}><span className="status-dot" /><span>{input}</span><span className="muted">Pending</span></div>)}</div><div className="panel-padding"><DetailList items={[{ label: 'Model version', value: '—' }, { label: 'Generated', value: '—' }, { label: 'Last ingestion', value: '—' }]} /><a className="text-link" href="#/">View in Monitoring<Icon name="arrow" size={15} /></a></div></Panel></div>
    </>}
  </>;
}
