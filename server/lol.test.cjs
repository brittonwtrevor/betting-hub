const { test } = require('node:test');
const assert = require('node:assert/strict');
const { columns, collapseSeries, normalizeGame, mysqlOptions, createUpcomingGamesService } = require('./lol.cjs');

const env = { LOL_DO_DB_HOST: 'db.example.test', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'test-only', LOL_DO_DB_NAME: 'defaultdb' };
const sample = {
  begin_at: '2026-11-05 19:00:00', game_id: 100, match_id: 90, league_name: 'LCK',
  team_a_name: 'Team A', team_b_name: 'Team B', islastlineup: 1,
  pred_xgb: -150.49, MLA: 125.5, ML_PRIORS: -110.23,
  total_kills_prediction: 27.26, game_duration: 31.567, team_a_adc_player_name: 'ADC A',
  image_url_team_a: 'list("https://images.example.test/a.png")',
  lineup_note: '<a href="https://x.com/lineups" target="_blank">Lineup</a>',
  updateddate: '2026-11-04 17:00:00.000000',
};

test('reproduces Shiny prices, series probabilities, rounding, and all 35 columns', () => {
  const result = normalizeGame(sample);
  assert.equal(columns.length, 35);
  assert.equal(columns[0].key, 'series_format');
  assert.deepEqual(columns.slice(-4).map(column => column.key), ['lineup_note', 'islastlineup', 'game_id', 'match_id']);
  assert.deepEqual(Object.keys(result).sort(), columns.map(c => c.key).sort());
  assert.equal(result.xgb_map1, -150);
  assert.equal(result.map1_probability, 60);
  assert.equal(result.bo3_price, -184);
  assert.equal(result.bo3_probability, 64.8);
  assert.equal(result.bo5_price, -215);
  assert.equal(result.bo5_probability, 68.3);
  assert.equal(result.ml_map1, 126);
  assert.equal(result.priors_only, -110);
  assert.equal(result.priors_pred, -110.23);
  assert.equal(result.total, 27.3);
  assert.equal(result.game_duration, 31.57);
  assert.equal(result.a_adc, 'ADC A');
  assert.equal(result.a, 'https://images.example.test/a.png');
  assert.equal(result.lineup_note, 'https://x.com/lineups');
  assert.equal(normalizeGame({ ...sample, pred_xgb: 100.5 }).xgb_map1, 100);
  assert.equal(normalizeGame({ ...sample, pred_xgb: 101.5 }).xgb_map1, 102);
  assert.equal(normalizeGame({ ...sample, total_kills_prediction: 27.85 }).total, 27.9);
});

test('missing predictions stay missing; 50% prices remain +100; unsafe URLs cannot become HTML', () => {
  const missing = normalizeGame({ ...sample, pred_xgb: null, MLA: 'NA', image_url_team_a: 'javascript:alert(1)', lineup_note: '<script>alert(1)</script>' });
  for (const key of ['xgb_map1', 'map1_probability', 'bo3_probability', 'bo5_probability', 'bo3_price', 'bo5_price', 'ml_map1', 'a', 'lineup_note']) {
    assert.equal(missing[key], null, key);
  }
  const even = normalizeGame({ ...sample, pred_xgb: 100 });
  assert.equal(even.map1_probability, 50);
  assert.equal(even.bo3_price, 100);
  assert.equal(even.bo5_price, 100);
  assert.equal(normalizeGame({ ...sample, pred_xgb: 0 }).map1_probability, null);
});

test('requires server credentials and verified TLS, with optional cluster CA', () => {
  assert.throws(() => mysqlOptions({}), { code: 'DB_NOT_CONFIGURED' });
  assert.throws(() => mysqlOptions({ ...env, LOL_DO_DB_PORT: 'invalid' }), { code: 'DB_NOT_CONFIGURED' });
  const options = mysqlOptions({ ...env, LOL_DO_DB_SSL_CA: 'first\\nsecond' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.equal(options.ssl.ca, 'first\nsecond');
  assert.equal(options.multipleStatements, false);
  assert.equal(options.dateStrings, true);
});

test('reads only the published table, shares concurrent requests, and keeps all lineup variants', async () => {
  let queryCount = 0;
  let ended = false;
  const service = createUpcomingGamesService({ env, now: () => new Date('2026-11-04T20:00:00Z'), createPool: () => ({
    async query(options) {
      queryCount++;
      assert.match(options.sql, /^SELECT .* FROM `TREVORFAIRS` ORDER BY/);
      assert.doesNotMatch(options.sql, /INSERT|UPDATE|DELETE|CREATE|DROP|WHERE|\*/);
      return [[sample, { ...sample, islastlineup: 0, updateddate: '2026-11-04 18:00:00.000000' }]];
    },
    async end() { ended = true; },
  }) });
  const [a, b] = await Promise.all([service.getUpcomingGames(), service.getUpcomingGames()]);
  assert.deepEqual(a, b);
  assert.equal(queryCount, 1);
  assert.equal(a.games.length, 2);
  assert.equal(a.source.updatedAt, '2026-11-04 18:00:00.000000');
  assert.equal(a.fetchedAt, '2026-11-04T20:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(a), /test-only|db\.example/);
  await service.getUpcomingGames();
  assert.equal(queryCount, 2);
  await service.close();
  assert.equal(ended, true);
});

test('recovers after a failed read and handles an empty publication', async () => {
  let count = 0;
  const service = createUpcomingGamesService({ env, createPool: () => ({
    async query() { if (++count === 1) throw new Error('Temporary failure'); return [[]]; },
  }) });
  await assert.rejects(service.getUpcomingGames());
  const result = await service.getUpcomingGames();
  assert.deepEqual(result.games, []);
  assert.equal(result.source.updatedAt, null);
});


test('collapses repeated maps and infers BO1, BO3, and BO5 before removing duplicates', () => {
  for (const count of [1, 3, 5]) {
    const maps = Array.from({ length: count }, (_, i) => ({ ...sample, game_id: 100 + i }));
    const result = collapseSeries([...maps, maps[0]]);
    assert.equal(result.length, 1);
    assert.equal(result[0].series_format, `BO${count}`);
    assert.equal(result[0].xgb_map1, -150);
  }
});

test('does not merge distinct matches, lineup variants, or predictions', () => {
  const maps = Array.from({ length: 5 }, (_, i) => ({ ...sample, game_id: 100 + i }));
  const result = collapseSeries([
    ...maps,
    ...maps.map(row => ({ ...row, team_a_adc_player_name: 'Different ADC', islastlineup: 0 })),
    { ...maps[0], pred_xgb: -200 },
    { ...sample, match_id: 91, game_id: 200 },
  ]);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(row => row.series_format), ['BO5', 'BO5', 'BO5', 'BO1']);
  assert.equal(result[1].a_adc, 'Different ADC');
  assert.equal(result[2].xgb_map1, -200);
});

test('unknown or incomplete map counts do not invent a series format', () => {
  const result = collapseSeries([{ ...sample }, { ...sample, game_id: 101 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].series_format, null);
  const missingIds = collapseSeries([{ ...sample, match_id: null }, { ...sample, match_id: null }]);
  assert.equal(missingIds.length, 2);
  assert.ok(missingIds.every(row => row.series_format === null));
});
