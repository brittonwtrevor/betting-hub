const path = require('node:path');

const references = [
  ['leagues', 'Leagues'], ['tournaments', 'Tournaments'], ['teams', 'Teams'],
  ['players', 'Players'], ['rosters', 'Team lineup combinations'],
];
const pandaMatches = ['panda-upcoming', 'panda-history', 'panda-map-stats'];
const pandaReports = {
  'reference_data.txt': 'refresh_reference_data.R',
  'match_game_data.txt': 'LOL_DATA_UPDATE.R',
  'minute_frames.txt': 'LOL_DATA_MINUTE_BY_MINUTE_UPDATE.R',
};
const stageFeeds = {
  'GAME_QUERY_DB_UPDATE.R': ['ep-games'], 'UPDATE_GAME_LOGS.R': ['ep-game-logs'], 'CURRENT_ROSTERS.R': ['ep-rosters'],
  'refresh_reference_data.R': references.map(([id]) => `panda-${id}`),
  'LOL_DATA_UPDATE.R': pandaMatches, 'LOL_DATA_MINUTE_BY_MINUTE_UPDATE.R': ['panda-frames'],
};
const count = (text, pattern) => {
  const value = text.match(pattern)?.[1];
  return value == null ? null : Number(value.replace(/,/g, ''));
};
function iso(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function stageEvents(script, { at, durationMs, code, output = '', report = '' }) {
  const name = path.basename(script);
  const ids = stageFeeds[name] || [];
  const event = (id, records = null, gaps = null, unit = null, lastData = null) => ({
    id, at, durationMs, records, gaps, unit,
    status: code !== 0 ? 'failed' : gaps > 0 ? (records === 0 ? 'failed' : 'warning') : records === 0 ? 'no_change' : 'success',
    dataAt: lastData || (code === 0 && records > 0 ? at : null),
  });
  if (code !== 0) return ids.map(id => event(id));
  if (name === 'GAME_QUERY_DB_UPDATE.R') {
    const pages = [...output.matchAll(/Fetched rows: ([\d,]+)/g)];
    const records = pages.length ? pages.reduce((sum, match) => sum + Number(match[1].replace(/,/g, '')), 0) : null;
    const volume = output.includes('No games returned from API for the selected window') ? 0 : records;
    return [event(ids[0], volume, null, 'games')];
  }
  if (name === 'UPDATE_GAME_LOGS.R') return [event(ids[0], count(output, /: (\d+) refreshed; \d+ still pending/), count(output, /(\d+) still pending/), 'games')];
  if (name === 'CURRENT_ROSTERS.R') {
    const records = /leaving ROSTERS unchanged/.test(output) ? 0 : count(output, /Roster refresh complete: (\d+) teams refreshed/);
    return [event(ids[0], records, count(output, /(\d+) teams preserved after failed\/empty responses/), 'teams')];
  }
  if (name === 'refresh_reference_data.R') {
    const cached = report.match(/Last successful refresh: ([\d-]+) ([\d:]+) UTC/);
    const lastData = cached ? iso(`${cached[1]}T${cached[2]}Z`) : null;
    return references.map(([id, label]) => {
      const records = cached ? 0 : count(report, new RegExp(`${label}: ([\\d,]+)`));
      const gaps = id === 'rosters' ? count(report, /([\d,]+) teams? had no usable roster/) : null;
      return event(`panda-${id}`, records, gaps, 'rows', lastData);
    });
  }
  if (name === 'LOL_DATA_UPDATE.R') {
    const finished = count(report, /Finished maps inspected for detailed stats: ([\d,]+)/);
    const gaps = count(report, /Detailed stats were unavailable for ([\d,]+) maps?/);
    return [
      event(ids[0], count(report, /and ([\d,]+) upcoming maps?/), null, 'maps'),
      event(ids[1], count(report, /PandaScore returned ([\d,]+) match/), null, 'matches'),
      event(ids[2], finished == null ? null : Math.max(0, finished - (gaps || 0)), gaps, 'maps'),
    ];
  }
  if (name === 'LOL_DATA_MINUTE_BY_MINUTE_UPDATE.R') {
    const failures = count(report, /no usable frames for ([\d,]+) maps?/);
    const empty = count(report, /Empty frame responses for ([\d,]+) maps?/);
    const gaps = failures == null && empty == null ? null : (failures || 0) + (empty || 0);
    return [event(ids[0], count(report, /Frame rows appended: ([\d,]+)/), gaps, 'frames')];
  }
  return [];
}

const providers = {
  'DKSCRAPER.R': ['hockey-dk', 'DraftKings'], 'OWL_ODDS_FALLBACK.R': ['hockey-owl', 'OwlsInsight'],
  'CADDYSHACK_HOCKEY_ODDS.R': ['hockey-caddy', 'Caddyshack'],
};
function oddsEvents(run, snapshots = {}) {
  const at = iso(run.completed_at);
  if (!at || run.dry_run !== false) return [];
  const events = [];
  for (const [script, [id, feed]] of Object.entries(providers)) {
    if (!Object.hasOwn(run.scripts || {}, script)) continue;
    const saved = snapshots[feed];
    const code = run.scripts[script];
    events.push({ id, at, status: code !== 0 ? 'failed' : saved?.records === 0 ? 'no_change' : 'success',
      dataAt: iso(saved?.dataAt), records: saved?.records ?? null, unit: 'quotes' });
  }
  const isSuccess = events.length === Object.keys(providers).length && events.every(event => event.status !== 'failed');
  const start = iso(run.started_at);
  const dataTimes = events.map(event => event.dataAt).filter(Boolean).sort();
  const records = events.length && events.every(event => event.records != null) ? events.reduce((sum, event) => sum + event.records, 0) : null;
  events.push({ id: 'hockey-odds', at, status: isSuccess ? (records === 0 ? 'no_change' : 'success') : 'failed',
    durationMs: start ? Math.max(0, Date.parse(at) - Date.parse(start)) : null, dataAt: dataTimes.at(-1), records, unit: 'quotes' });
  if (Object.hasOwn(run.scripts || {}, 'ADDING_ODDS.R')) {
    const success = run.scripts['ADDING_ODDS.R'] === 0;
    events.push({ id: 'hockey-odds-join', at, status: success ? 'success' : 'failed', dataAt: success ? at : null });
  }
  return events;
}
module.exports = { stageFeeds, pandaReports, stageEvents, oddsEvents };
