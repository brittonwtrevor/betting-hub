import React, { useCallback, useEffect, useRef, useState } from 'react';
import { navigation, sports } from './navigation';
import Icon from '../components/Icon';
import Drawer from '../components/Drawer';
import { Badge, EmptyState } from '../components/ui';
function Navigation({ route, onNavigate, compact = false }) {
  return <nav className="main-navigation" aria-label="Main navigation">
    {!compact && <p className="nav-eyebrow">WORKSPACE</p>}
    {navigation.map(item => <React.Fragment key={item.id}>
      <a href={`#${item.path}`} className={`nav-link ${route.id === item.id ? 'active' : ''}`} title={compact ? item.label : undefined} aria-current={route.id === item.id ? 'page' : undefined} onClick={onNavigate}>
        <Icon name={item.icon} size={19} /><span className={compact ? 'sr-only' : undefined}>{item.label}</span>
        {!compact && route.id === item.id && <span className="nav-active-dot" />}
      </a>
      {item.id === 'sports' && route.id === 'sports' && <div className="sport-navigation">
        {sports.map(sport => <a key={sport.id} href={`#/sports/${sport.id}`} className={route.sportId === sport.id ? 'active' : ''} title={compact ? sport.label : undefined} aria-current={route.sportId === sport.id ? 'page' : undefined} onClick={onNavigate}>
          {compact && <Icon name={sport.icon} size={18} />}<span className={compact ? 'sr-only' : undefined}>{sport.label}</span>
        </a>)}
      </div>}
    </React.Fragment>)}
  </nav>;
}
export default function AppShell({ route, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  const main = useRef(null);
  const previousPath = useRef(route.path);
  useEffect(() => { document.title = `${route.label} · Betting Hub`; if (previousPath.current !== route.path) { main.current.focus(); window.scrollTo(0, 0); previousPath.current = route.path; } }, [route.path, route.label]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current.focus(); }}>Skip to content</a>
    <aside className="sidebar"><Navigation route={route} compact /></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span className="breadcrumb-root">Workspace</span><Icon name="chevron" size={13} /><span>{route.label}</span></div><div className="topbar-actions"><span className="connection-label"><span className="status-dot" />No live connections</span><span className="topbar-divider" /><button type="button" className="icon-button" aria-label="Open alerts" onClick={() => setAlertsOpen(true)}><Icon name="bell" /></button><span className="avatar avatar-small" aria-label="Trevor Britton">TB</span></div></header><main id="main-content" className="main-content" ref={main} tabIndex={-1}>{children}<footer className="page-footer"><span>Betting Hub<span className="footer-dot">·</span>One workspace. The whole picture.</span><span>Times displayed in Eastern Time</span></footer></main></div>
    {menuOpen && <Drawer title="Your workspace" onClose={closeMenu} side="left"><Navigation route={route} onNavigate={closeMenu} /></Drawer>}
    {alertsOpen && <Drawer title="Alerts" onClose={closeAlerts}><Badge>Awaiting connections</Badge><EmptyState icon="bell" title="Your attention, in one place" description="Data freshness warnings and new bet opportunities will appear here once their sources are connected." /><div className="alert-categories"><div><Icon name="activity" /><span>Data health</span><span className="muted">0 alerts</span></div><div><Icon name="spark" /><span>Bet opportunities</span><span className="muted">0 alerts</span></div></div></Drawer>}
  </div>;
}
