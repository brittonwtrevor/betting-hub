import React, { createContext, useCallback, useContext, useState } from 'react';
import MarketPicker from './MarketPicker';

const SendsContext = createContext({ openGame: () => {} });
export const useSends = () => useContext(SendsContext);
async function request(path = '', method = 'GET', body) {
  const response = await fetch(`/api/send-drafts${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'sends' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (response.status === 401 ? 'Reload the page to sign in again.' : 'Unable to load or save Sends. Please try again.'));
  return data;
}
export function SendsProvider({ children }) {
  const [drafts, setDrafts] = useState([]);
  const [game, setGame] = useState(null);
  const [notice, setNotice] = useState('');
  const closeGame = useCallback(() => setGame(null), []);
  const openGame = useCallback(value => { setGame({ ...value, sport: 'lol' }); setNotice(''); }, []);
  const load = useCallback(async () => {
    const data = await request();
    if (!Array.isArray(data.drafts)) throw new Error('Sends returned an unreadable response.');
    setDrafts(data.drafts);
  }, []);
  const replace = useCallback(draft => {
    if (!draft?.id || !Array.isArray(draft.markets)) throw new Error('The draft could not be read. Refresh Sends.');
    setDrafts(current => [draft, ...current.filter(item => item.id !== draft.id)]);
    return draft;
  }, []);
  const add = useCallback(async marketIds => {
    const data = await request('', 'POST', { game, marketIds });
    replace(data.draft); setGame(null); setNotice('Markets saved to Sends.');
  }, [game, replace]);
  const save = useCallback(async draft => {
    const data = await request(`/${encodeURIComponent(draft.id)}`, 'PATCH', draft);
    return replace(data.draft);
  }, [replace]);
  const send = useCallback(async draft => {
    const data = await request(`/${encodeURIComponent(draft.id)}/send`, 'POST', draft);
    return replace(data.draft);
  }, [replace]);
  const remove = useCallback(async draft => {
    await request(`/${encodeURIComponent(draft.id)}`, 'DELETE', { revision: draft.revision });
    setDrafts(current => current.filter(item => item.id !== draft.id));
  }, []);
  return <SendsContext.Provider value={{ drafts, openGame, load, save, send, remove }}>
    {notice && <div className="sends-notice" role="status">{notice}<a href="#/bets">View Sends →</a><button type="button" aria-label="Dismiss Sends notice" onClick={() => setNotice('')}>×</button></div>}
    {children}
    {game && <MarketPicker game={game} onClose={closeGame} onAdd={add} />}
  </SendsContext.Provider>;
}
