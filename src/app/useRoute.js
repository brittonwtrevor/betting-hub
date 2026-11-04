import { useEffect, useState } from 'react';
import { navigation, sports } from './navigation';

const sportsPage = navigation.find(page => page.id === 'sports');
const betsPage = navigation.find(page => page.id === 'bets');

// Hash URLs survive refreshes with the existing DigitalOcean static server.
export function resolveRoute(hash) {
  const rawPath = hash.replace(/^#/, '').split('?')[0] || '/';
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  // Keep old inbox bookmarks useful after removing the Telegram workspace.
  if (path === '/telegram' || path === '/bets') return { ...betsPage, tab: path === '/telegram' || new URLSearchParams(hash.split('?')[1] || '').get('tab') === 'confirms' ? 'confirms' : 'sends' };
  if (path === '/sports') return { ...sportsPage, path, sportId: 'hockey' };
  const sport = sports.find(item => path === `/sports/${item.id}`);
  if (sport) return { ...sportsPage, path, sportId: sport.id };
  const page = navigation.find(item => item.id !== 'sports' && item.path === path);
  return page || { id: 'not-found', path, label: 'Page not found', description: '' };
}
export default function useRoute() {
  const [route, setRoute] = useState(() => resolveRoute(window.location.hash));
  useEffect(() => {
    const handleChange = () => setRoute(resolveRoute(window.location.hash));
    window.addEventListener('hashchange', handleChange);
    return () => window.removeEventListener('hashchange', handleChange);
  }, []);
  return route;
}
