export const storageKey = 'betting-hub.partner-names.v1';
export function readPartners() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved.filter(partner => partner && typeof partner.id === 'string' && typeof partner.name === 'string').map(partner => ({ ...partner, telegramChannel: typeof partner.telegramChannel === 'string' ? partner.telegramChannel : '' })) : [];
  } catch { return []; }
}

