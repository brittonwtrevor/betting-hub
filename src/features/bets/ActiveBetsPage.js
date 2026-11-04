import React, { useState } from 'react';
import { Badge, EmptyTable, ExportButton, InfoNote, Panel, SearchField, Segments, SelectField, StatGrid, sportOptions } from '../../components/ui';
export default function ActiveBetsPage() {
  const [status, setStatus] = useState('open');
  const [sport, setSport] = useState('all');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const statuses = [{ value: 'open', label: 'Open bets', count: 0 }, { value: 'pending', label: 'Awaiting confirmation', count: 0 }, { value: 'settled', label: 'Settled', count: 0 }];
  return <>
    <StatGrid items={[{ label: 'Open bets', value: '0', note: 'No placements imported', icon: 'layers' }, { label: 'Open exposure', icon: 'wallet' }, { label: 'Awaiting confirmation', value: '0', note: 'No reports received', icon: 'clock' }, { label: 'Potential return', icon: 'chart' }]} />
    <Panel title="Bet ledger" description="Every placement, with its account, partner, and original recommendation." action={<ExportButton />}>
      <div className="panel-controls"><Segments label="Bet status" value={status} onChange={setStatus} items={statuses} /><div className="filter-row"><SearchField label="Search bets" value={query} onChange={setQuery} placeholder="Search event or selection…" /><SelectField label="Sport" value={sport} onChange={setSport} options={sportOptions} /><SelectField label="Source" value={source} onChange={setSource} options={[{ value: 'all', label: 'All sources' }, { value: 'telegram', label: 'Telegram' }, { value: 'kalshi', label: 'Kalshi' }, { value: 'polymarket', label: 'Polymarket' }, { value: 'partners', label: 'Partners' }]} /></div></div>
      <EmptyTable columns={['Event / Selection', 'Source / Partner', 'Odds', 'Stake', 'Your exposure', 'Status']} icon="layers" title={status === 'pending' ? 'No placements awaiting confirmation' : status === 'settled' ? 'No settled bets yet' : 'Your open bets will live here'} description={status === 'pending' ? 'Sent recommendations will stay here until a placement is confirmed.' : status === 'settled' ? 'Settled placements will include returns, fees, and your final share.' : 'Connect account activity or partner reports to see all outstanding bets in one place.'} />
    </Panel>
    <InfoNote>Telegram recommendations and confirmed placements stay linked. Only confirmed placements contribute to your exposure.</InfoNote>
    <div className="three-column">{['Telegram & partners', 'Kalshi', 'Polymarket'].map(name => <Panel key={name} className="connection-card"><div><h3>{name}</h3><p>Placements and settlements</p></div><Badge>Not connected</Badge></Panel>)}</div>
  </>;
}
