import { useCallback, useEffect, useRef, useState } from 'react';
import { readPartners, storageKey } from './registry';

async function request(path = '', method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/partners${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-Betting-Hub': 'partners' }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load or save partners.');
    return result;
  } catch (error) { if (error.name === 'AbortError') throw new Error('The partner request timed out. Refresh partners to check the saved record.'); throw error; }
  finally { clearTimeout(timeout); }
}

export function usePartners(enabled = true) {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(null);
  const reload = useCallback(async () => {
    if (pending.current) return pending.current;
    setLoading(true); setError('');
    pending.current = (async () => {
      // Keep original IDs, so existing Sends/Confirms still identify the partner.
      const legacy = readPartners();
      let backup;
      try { backup = window.localStorage.getItem(storageKey); } catch { /* Database access still works with browser storage disabled. */ }
      for (let start = 0; start < legacy.length; start += 100) await request('/import', 'POST', { partners: legacy.slice(start, start + 100) });
      const result = await request();
      if (!Array.isArray(result.partners)) throw new Error('The partner database returned an unreadable response.');
      // Remove a browser backup only after every import and database read succeeds.
      try { if (legacy.length && window.localStorage.getItem(storageKey) === backup) window.localStorage.removeItem(storageKey); } catch { /* Retrying the import is safe. */ }
      if (mounted.current) setPartners(current => result.partners.map(partner => {
        const previous = current.find(item => item.id === partner.id);
        return previous?.revision > partner.revision ? previous : partner;
      }));
    })().catch(failure => { if (mounted.current) setError(failure.message); }).finally(() => {
      pending.current = null; if (mounted.current) setLoading(false);
    });
    return pending.current;
  }, []);
  useEffect(() => { mounted.current = true; if (enabled) void reload(); return () => { mounted.current = false; }; }, [enabled, reload]);
  const save = async (input, existing) => {
    const { partner } = await request(existing?.revision ? `/${encodeURIComponent(existing.id)}` : '', existing?.revision ? 'PATCH' : 'POST', input);
    if (mounted.current) setPartners(current => [...current.filter(item => item.id !== partner.id), { ...partner, legacyIds: current.find(item => item.id === partner.id)?.legacyIds }].sort((a, b) => a.name.localeCompare(b.name)));
    return partner;
  };
  return { partners, loading, error, reload, save };
}
