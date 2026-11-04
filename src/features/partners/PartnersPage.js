import React, { useState } from 'react';
import { EmptyTable, ExportButton, InfoNote, Panel, SearchField, Segments, StatGrid } from '../../components/ui';
const views = {
  balances: { title: 'Partner balances', columns: ['Partner', 'Open exposure', 'Settled P/L', 'Your share', 'Payments', 'Balance'], empty: 'Your partner ledger starts here', description: 'Partner balances will bring placements, agreed shares, and payments together.' },
  reports: { title: 'Bet reports', columns: ['Partner', 'Event / Selection', 'Stake', 'Odds', 'Agreed share', 'Confirmation'], empty: 'No partner reports yet', description: 'Reported bets will link back to their original suggestion and confirmed placement.' },
  payments: { title: 'Payments', columns: ['Partner', 'Date', 'Direction', 'Amount', 'Reference', 'Status'], empty: 'No payments recorded', description: 'Payments made and received will reconcile each partner’s outstanding balance.' },
};
export default function PartnersPage() {
  const [tab, setTab] = useState('balances');
  const [query, setQuery] = useState('');
  const view = views[tab];
  return <>
    <StatGrid items={[{ label: 'Active partners', value: '0', note: 'No partners connected', icon: 'users' }, { label: 'Partner exposure', icon: 'layers' }, { label: 'Owed to you', icon: 'wallet' }, { label: 'Owed by you', icon: 'wallet' }]} />
    <Panel title={view.title} description="A clear record of who placed what, and how it is shared." action={<ExportButton />}><div className="panel-controls"><Segments label="Partner accounting views" items={[{ value: 'balances', label: 'Balances' }, { value: 'reports', label: 'Bet reports' }, { value: 'payments', label: 'Payments' }]} value={tab} onChange={setTab} /><SearchField label="Search partner records" placeholder="Search partners or reports…" value={query} onChange={setQuery} /></div><EmptyTable columns={view.columns} icon="users" title={view.empty} description={view.description} /></Panel>
    <InfoNote>Betting results, your agreed share, and payments will be recorded separately so balances and performance stay consistent.</InfoNote>
  </>;
}
