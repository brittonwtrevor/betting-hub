import { parseDate } from '../sports/lol/upcoming';

const isOdds = value => Number.isFinite(value) && Math.abs(value) >= 100;
const hasName = value => typeof value === 'string' && value.trim() !== '' && !/^(na|n\/a|unknown|tbd|—)$/i.test(value.trim());
export const staleHours = 36;

export const models = {
  hockey: {
    label: 'Hockey', endpoint: '/api/hockey/future-games', unit: 'games',
    inputs: [
      ['Elite Prospects', 'Core model', 'Schedules, results, player and goalie game logs, recent actives, rosters, and NHL draft player games. Roster refresh is separate from the main runner.'],
      ['Flashscore', 'Lineups', 'Separate lineup collector for game-day skaters and goalies.'],
      ['DraftKings', 'Odds', 'Sportsbook prices joined to upcoming games.'],
      ['Owls Insight', 'Odds fallback', 'Additional prices used where DraftKings coverage is missing.'],
      ['Caddyshack', 'Odds fallback', 'Additional hockey odds, including VHL.'],
      ['HockeyTech', 'Lineup alerts', 'Separate official OHL, WHL, and QMJHL lineup watcher.'],
    ],
    metrics: ['Fair ML', 'Sportsbook ML', 'Named goalie pair'],
    dateKey: 'dateTime', leagueKey: 'leagueName', id: row => row.id,
    covered: [
      row => isOdds(row.winoddsfulltime) && isOdds(row.away_winoddsfulltime),
      row => isOdds(row.HomeML) && isOdds(row.AwayML),
      row => hasName(row.goalie_team) && hasName(row.goalie_opp),
    ],
  },
  lol: {
    label: 'League of Legends', endpoint: '/api/lol/upcoming-games', unit: 'matches',
    inputs: [
      ['PandaScore', 'Pro model', 'Professional schedules, results, maps, team and player stats, minute frames, and reference data.'],
      ['Riot patch notes', 'Pro model', 'Official patch changes and dates.'],
      ['Riot API + Data Dragon', 'Public draft model', 'High-elo ranked drafts and champion metadata from the standalone Riot collector.'],
      ['Google Sheets rankings', 'Reference', 'Competition ratings in the local LeagueRankingGsheet table, refreshed separately.'],
      ['Local age curves', 'Reference', 'Role-specific age coefficients from the AGE_CURVES table.'],
      ['Polymarket', 'Live draft', 'Discovers live LoL markets and game links.'],
      ['GRID', 'Live draft', 'Live scoreboard and completed champion drafts.'],
    ],
    metrics: ['XGB Map 1 price', 'Full player lineup', 'Series format'],
    dateKey: 'begin_at', leagueKey: 'league', id: row => row.match_id || row.game_id,
    covered: [
      row => isOdds(row.xgb_map1),
      row => ['a', 'b'].every(team => ['top', 'jun', 'mid', 'adc', 'sup'].every(role => hasName(row[`${team}_${role}`]))),
      row => ['BO1', 'BO3', 'BO5'].includes(row.series_format),
    ],
  },
};

export function summarizeModel(model, payload, now = Date.now()) {
  const leagues = new Map();
  for (const row of payload.games) {
    const start = parseDate(row[model.dateKey]);
    const id = model.id(row);
    if (!start || +start < now || id == null || id === '') continue;
    const league = row[model.leagueKey] || 'Unknown league';
    if (!leagues.has(league)) leagues.set(league, new Map());
    const games = leagues.get(league);
    const coverage = games.get(id) || model.metrics.map(() => false);
    model.covered.forEach((check, index) => { coverage[index] ||= check(row); });
    games.set(id, coverage);
  }
  const coverage = [...leagues].sort(([a], [b]) => a.localeCompare(b)).map(([league, games]) => ({
    league, count: games.size, counts: model.metrics.map((_, index) => [...games.values()].filter(flags => flags[index]).length),
  }));
  const updatedAt = payload.source?.updatedAt;
  const updated = parseDate(updatedAt);
  const age = updated ? now - +updated : null;
  const status = age === null ? 'No timestamp' : age > staleHours * 3600000 ? 'Stale output' : 'Published';
  return { status, updatedAt, coverage, count: coverage.reduce((sum, row) => sum + row.count, 0) };
}
