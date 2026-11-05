// Time limits are minutes since the last successful check.
const feeds = [
  { id: 'hockey-odds', sport: 'Hockey', name: 'Odds scraper', cadence: '10 min', green: 15, yellow: 30 },
  { id: 'hockey-dk', sport: 'Hockey', name: 'DraftKings odds', cadence: '10 min', green: 15, yellow: 30 },
  { id: 'hockey-owl', sport: 'Hockey', name: 'Owls Insight odds', cadence: '10 min', green: 15, yellow: 30 },
  { id: 'hockey-caddy', sport: 'Hockey', name: 'Caddyshack odds', cadence: '10 min', green: 15, yellow: 30 },
  { id: 'hockey-odds-join', sport: 'Hockey', name: 'Odds joined to model', cadence: '12 hr', green: 840, yellow: 1440 },
  { id: 'ep-games', sport: 'Hockey', name: 'Elite Prospects games and results', cadence: '12 hr', green: 840, yellow: 1440 },
  { id: 'ep-game-logs', sport: 'Hockey', name: 'Elite Prospects game logs', cadence: '12 hr', green: 840, yellow: 1440 },
  { id: 'ep-rosters', sport: 'Hockey', name: 'Elite Prospects current rosters', cadence: 'Weekly', green: 11520, yellow: 14400 },
  ...[
    ['upcoming', 'Upcoming matches'], ['history', 'Match history and results'], ['map-stats', 'Per-map team and player stats'],
    ['frames', 'Minute frames'], ['leagues', 'Leagues'], ['tournaments', 'Tournaments'],
    ['teams', 'Teams'], ['players', 'Players'], ['rosters', 'Team rosters'],
  ].map(([id, name]) => ({ id: `panda-${id}`, sport: 'LoL', name: `PandaScore ${name}`, cadence: '12 hr', green: 960, yellow: 1680 })),
];

function feedLight(feed, run, now) {
  if (!run?.lastRunAt) return { tone: 'neutral', label: 'No telemetry' };
  const lastSuccess = Date.parse(run.lastSuccessAt);
  const age = Number.isFinite(lastSuccess) ? Math.max(0, (now - lastSuccess) / 60000) : null;
  if (age === null && run.status === 'failed') return { tone: 'red', label: 'Failed', age };
  if (age !== null && age > feed.yellow) return { tone: 'red', label: 'Stale', age };
  if (run.status === 'failed' || run.status === 'warning') return { tone: 'yellow', label: 'Check run', age };
  if (age === null) return { tone: 'neutral', label: 'No successful check', age };
  if (age > feed.green) return { tone: 'yellow', label: 'Due', age };
  return { tone: 'green', label: 'Current', age };
}

module.exports = { feeds, feedLight };
