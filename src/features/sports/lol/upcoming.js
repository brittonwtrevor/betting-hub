export function parseDate(value) {
  if (!value) return null;
  // PandaScore times and MySQL date strings are UTC. Never use the viewer's timezone.
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function easternTime(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date) : '—';
}

export function cellText(row, column) {
  const value = row[column.key];
  if (value == null || value === '') return '';
  if (column.type === 'date') return easternTime(value);
  if (column.type === 'percent') return `${Number(value).toFixed(1)}%`;
  if (column.type === 'odds') return Number(value) > 0 ? `+${value}` : String(value);
  return String(value);
}

export function filterGames(games, columns, { league = 'ALL', lastLineup = true, search = '', filters = {} }) {
  const term = search.toLowerCase().trim();
  return games.filter(row => (league === 'ALL' || row.league === league)
    && (!lastLineup || Number(row.islastlineup) === 1)
    && (!term || columns.some(column => cellText(row, column).toLowerCase().includes(term)))
    && columns.every(column => !filters[column.key]
      || cellText(row, column).toLowerCase().includes(filters[column.key].toLowerCase())));
}

export function sortGames(games, column, direction) {
  if (!column) return games;
  return [...games].sort((a, b) => {
    const av = a[column.key];
    const bv = b[column.key];
    // Missing predictions stay at the bottom for either sort direction.
    if (av == null || av === '') return bv == null || bv === '' ? 0 : 1;
    if (bv == null || bv === '') return -1;
    let result;
    if (['number', 'percent', 'odds'].includes(column.type)) result = Number(av) - Number(bv);
    else if (column.type === 'date') result = (parseDate(av)?.getTime() || 0) - (parseDate(bv)?.getTime() || 0);
    else result = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return direction === 'asc' ? result : -result;
  });
}

// Keep the exact five-field order and source start time used by Shiny's Sheets export.
export function rowTsv(row) {
  return ['match_id', 'league', 'begin_at', 'team_a', 'team_b'].map(key =>
    String(row[key] ?? '').replace(/<[^>]+>/g, '').replace(/[\t\r\n]+/g, ' ')
  ).join('\t');
}
