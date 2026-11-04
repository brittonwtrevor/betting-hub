import { easternTime, parseDate, sortGames } from '../lol/upcoming';

const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function gameDate(row) {
  const date = parseDate(row.dateTime);
  if (!date) return row.date || '';
  const parts = dateFormatter.formatToParts(date);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function cellText(row, column) {
  const value = row[column.key];
  if (value == null || value === '') return '';
  if (column.type === 'date') return easternTime(value);
  if (column.type === 'odds') return Number(value) > 0 ? `+${value}` : String(value);
  if (['edge', 'probability'].includes(column.type)) return `${(Number(value) * 100).toFixed(1)}${column.type === 'edge' ? ' pp' : '%'}`;
  if (column.type === 'percent') return `${Number(value).toFixed(1)}%`;
  return String(value);
}

export function filterGames(games, columns, { league = 'ALL', search = '', from = '', to = '', homeB2b = 'ALL', awayB2b = 'ALL', goalieFilters = false, minGames = 1, maxLastGame = 40, filters = {} } = {}) {
  const term = search.trim().toLowerCase();
  return games.filter(row => {
    if (league !== 'ALL' && row.leagueName !== league) return false;
    if (homeB2b !== 'ALL' && row.team_b2b_type !== homeB2b) return false;
    if (awayB2b !== 'ALL' && row.opp_b2b_type !== awayB2b) return false;
    if ((from || to)) {
      const day = gameDate(row);
      if (!day || (from && day < from) || (to && day > to)) return false;
    }
    if (goalieFilters && ['team', 'opp'].some(side => {
      const n = row[`goalie_${side}_n`], last = row[`goalie_${side}_last_game`];
      return n == null || last == null || Number(n) < Number(minGames) || Number(last) > Number(maxLastGame);
    })) return false;
    return (!term || columns.some(column => cellText(row, column).toLowerCase().includes(term)))
      && columns.every(column => !filters[column.key] || cellText(row, column).toLowerCase().includes(filters[column.key].toLowerCase()));
  });
}

export function sortFutureGames(games, column, direction) {
  return sortGames(games, column && ['edge', 'probability'].includes(column.type) ? { ...column, type: 'number' } : column, direction);
}
