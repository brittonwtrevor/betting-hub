const assert = require('node:assert/strict');
const { test } = require('node:test');
const { stageEvents, oddsEvents } = require('../scripts/feed-events.cjs');
const { feeds, feedLight } = require('../src/features/monitoring/feedSchedule');
const { createFeedHealthService } = require('./feed-health.cjs');

const at = '2026-11-05T12:00:00.000Z';
const stage = { at, durationMs: 1000, code: 0 };

test('one PandaScore run retains distinct coverage, failure, and cached-reference results', () => {
  const report = '• PandaScore returned 15 matches and 31 map/game records\n• Finished maps inspected for detailed stats: 30\n• GameSummary coverage written: 28 completed maps and 3 upcoming maps\n⚠️ Detailed stats were unavailable for 2 maps:';
  const [upcoming, history, maps] = stageEvents('LOL_DATA_UPDATE.R', { ...stage, report });
  assert.deepEqual([upcoming.id, upcoming.records, history.records, maps.records, maps.gaps, maps.status], ['panda-upcoming', 3, 15, 28, 2, 'warning']);
  assert.equal(stageEvents('LOL_DATA_MINUTE_BY_MINUTE_UPDATE.R', { ...stage, code: 1 })[0].status, 'failed');
  const frames = stageEvents('LOL_DATA_MINUTE_BY_MINUTE_UPDATE.R', { ...stage, report: '• Frame rows appended: 0\n⚠️ PandaScore had no usable frames for 2 maps (HTTP errors)' })[0];
  assert.equal(frames.status, 'failed');
  assert.equal(frames.gaps, 2);
  const refs = stageEvents('refresh_reference_data.R', { ...stage, report: '• Last successful refresh: 2026-11-04 12:00:00 UTC' });
  assert.equal(refs.length, 5);
  assert.ok(refs.every(feed => feed.status === 'no_change' && feed.dataAt === '2026-11-04T12:00:00.000Z'));
  const rosters = stageEvents('CURRENT_ROSTERS.R', { ...stage, output: 'Roster refresh complete: 25 teams refreshed, 3 teams preserved after failed/empty responses, 700 total roster rows' });
  assert.deepEqual([rosters[0].id, rosters[0].records, rosters[0].gaps, rosters[0].status], ['ep-rosters', 25, 3, 'warning']);
});

test('10-minute odds telemetry separates provider failures and excludes dry runs and absent joins', () => {
  const run = { dry_run: false, started_at: '2026-11-05T11:59:50+00:00', completed_at: at,
    scripts: { 'DKSCRAPER.R': 0, 'OWL_ODDS_FALLBACK.R': 1, 'CADDYSHACK_HOCKEY_ODDS.R': 0 } };
  const events = oddsEvents(run, { DraftKings: { records: 32, dataAt: at }, Caddyshack: { records: 0 } });
  assert.deepEqual(events.map(({ id, status }) => [id, status]), [
    ['hockey-dk', 'success'], ['hockey-owl', 'failed'], ['hockey-caddy', 'no_change'], ['hockey-odds', 'failed'],
  ]);
  assert.equal(events[3].durationMs, 10000);
  assert.deepEqual(oddsEvents({ ...run, dry_run: true }), []);
  assert.equal(oddsEvents({ ...run, scripts: { ...run.scripts, 'ADDING_ODDS.R': 0 } }).at(-1).id, 'hockey-odds-join');
});

test('stoplights use common PandaScore limits and the separate weekly roster threshold', () => {
  const odds = feeds.find(feed => feed.id === 'hockey-odds');
  const roster = feeds.find(feed => feed.id === 'ep-rosters');
  const run = { lastRunAt: at, lastSuccessAt: at, status: 'no_change' };
  const after = minutes => Date.parse(at) + minutes * 60000;
  assert.equal(feedLight(odds, run, after(15)).tone, 'green');
  assert.equal(feedLight(odds, run, after(30)).tone, 'yellow');
  assert.equal(feedLight(odds, run, after(31)).tone, 'red');
  assert.equal(feedLight(roster, run, after(8 * 1440)).tone, 'green');
  assert.equal(feedLight(roster, run, after(10 * 1440)).tone, 'yellow');
  assert.equal(feedLight(roster, run, after(11 * 1440)).tone, 'red');
  assert.equal(feedLight(odds, { lastRunAt: at, status: 'failed' }, after(1)).tone, 'red');
  assert.equal(feedLight(odds, null, after(1)).tone, 'neutral');
  assert.ok(feeds.filter(feed => feed.sport === 'LoL').every(feed => feed.green === 960 && feed.yellow === 1680 && feed.cadence === '12 hr'));
});

test('MySQL preserves the last success when a newer attempt fails and older results are replayed', {
  skip: !process.env.CONFIRMS_TEST_MYSQL_SOCKET,
}, async () => {
  const mysql = require('mysql2/promise');
  const options = { socketPath: process.env.CONFIRMS_TEST_MYSQL_SOCKET, user: 'root' };
  const admin = await mysql.createConnection(options);
  const database = `betting_hub_feed_test_${process.pid}`;
  const service = createFeedHealthService({ options: { ...options, database } });
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    await service.record([{ id: 'hockey-odds', at, status: 'failed', durationMs: 2500 }]);
    const prior = '2026-11-05T11:50:00.000Z';
    await service.record([{ id: 'hockey-odds', at: prior, status: 'success', dataAt: prior, records: 32 }]);
    const [failed] = await service.list();
    assert.deepEqual(failed, { id: 'hockey-odds', lastRunAt: at, lastSuccessAt: prior, lastDataAt: prior,
      status: 'failed', durationMs: 2500, records: null, gaps: null, unit: null });
    const next = '2026-11-05T12:10:00.000Z';
    await service.record([{ id: 'hockey-odds', at: next, status: 'no_change', records: 0, unit: 'quotes' }]);
    const [recovered] = await service.list();
    assert.equal(recovered.lastSuccessAt, next);
    assert.equal(recovered.lastDataAt, prior);
    assert.equal(recovered.records, 0);
  } finally {
    await service.close();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
});
