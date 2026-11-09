import { useEffect, useState } from 'react';
import { navigation } from './navigation';

const betsPage = navigation.find(page => page.id === 'bets');

// Hash URLs survive refreshes with the existing DigitalOcean static server.
export function resolveRoute(hash) {
  const rawPath = hash.replace(/^#/, '').split('?')[0] || '/';
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  // Keep old inbox bookmarks useful after removing the Telegram workspace.
  if (path === '/telegram') return { ...betsPage, tab: 'confirms' };
  if (path === '/bets') {
    const tab = new URLSearchParams(hash.split('?')[1] || '').get('tab');
    return { ...betsPage, tab: ['confirms', 'raw'].includes(tab) ? tab : 'sends' };
  }
  const page = navigation.find(item => item.path === (path === '/sports' ? '/sports/hockey' : path));
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
