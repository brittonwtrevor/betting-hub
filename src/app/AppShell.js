import React, { useCallback, useEffect, useRef, useState } from 'react';
import { navigation } from './navigation';
import Icon from '../components/Icon';
import Drawer from '../components/Drawer';
function Navigation({ route, onNavigate, compact = false }) {
  return <nav className="main-navigation" aria-label="Main navigation">
    {!compact && <p className="nav-eyebrow">WORKSPACE</p>}
    {navigation.map(item => {
      const active = route.path === item.path;
      return <a key={item.path} href={`#${item.path}`} className={`nav-link ${active ? 'active' : ''}`} title={compact ? item.label : undefined} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
        <Icon name={item.icon} size={19} /><span className={compact ? 'sr-only' : undefined}>{item.label}</span>
        {!compact && active && <span className="nav-active-dot" />}
      </a>;
    })}
  </nav>;
}
export default function AppShell({ route, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const main = useRef(null);
  const previousPath = useRef(route.path);
  useEffect(() => { document.title = `${route.label} · Betting Hub`; if (previousPath.current !== route.path) { main.current.focus(); window.scrollTo(0, 0); previousPath.current = route.path; } }, [route.path, route.label]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current.focus(); }}>Skip to content</a>
    <aside className="sidebar"><Navigation route={route} compact /></aside>
    <div className="workspace">
      <main id="main-content" className={`main-content${route.id === 'suggestions' ? ' trading-layout' : ''}`} ref={main} tabIndex={-1}>
        <button type="button" className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        {children}
        <footer className="page-footer"><span>Betting Hub<span className="footer-dot">·</span>One workspace. The whole picture.</span><span>Times displayed in Eastern Time</span></footer>
      </main>
    </div>
    {menuOpen && <Drawer title="Your workspace" onClose={closeMenu} side="left"><Navigation route={route} onNavigate={closeMenu} /></Drawer>}
  </div>;
}
