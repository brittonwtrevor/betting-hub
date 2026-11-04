import React from 'react';
import AppShell from './app/AppShell';
import useRoute from './app/useRoute';
import MonitoringPage from './features/monitoring/MonitoringPage';
import ActiveBetsPage from './features/bets/ActiveBetsPage';
import SuggestionsPage from './features/suggestions/SuggestionsPage';
import SportsPage from './features/sports/SportsPage';
import PartnersPage from './features/partners/PartnersPage';
import AnalyticsPage from './features/analytics/AnalyticsPage';
import { EmptyState } from './components/ui';
import { SendsProvider } from './features/bets/SendsContext';
import './features/bets/sends.css';
import './App.css';

export default function App() {
  const route = useRoute();
  const pages = {
    monitoring: <MonitoringPage />,
    bets: <ActiveBetsPage tab={route.tab} />,
    suggestions: <SuggestionsPage />,
    sports: <SportsPage sportId={route.sportId} />,
    partners: <PartnersPage />,
    analytics: <AnalyticsPage />,
  };
  return <SendsProvider><AppShell route={route}><div key={route.path} className="page-content">{pages[route.id] || <EmptyState icon="search" title="Page not found" description="Choose a workspace from the sidebar to get back on track."><a className="button button-primary" href="#/">Back to Monitoring</a></EmptyState>}</div></AppShell></SendsProvider>;
}
