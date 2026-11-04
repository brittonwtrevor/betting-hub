const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSendsService, normalizeGame, chooseMarkets, editDraft, gameKey } = require('./sends.cjs');
const { marketGroups, allMarkets } = require('../src/features/bets/markets');
const env = { LOL_DO_DB_HOST: 'db.example', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'test-only', LOL_DO_DB_NAME: 'defaultdb' };
const game = { sport: 'lol', match_id: '11', game_id: '101', team_a: 'Alpha', team_b: 'Bravo', league: 'LCK', begin_at: '2026-11-05 19:00:00', series_format: 'BO3', xgb_map1: -150, bo3_price: -184, bo5_price: -215, a_adc: 'ADC', publishedAt: '2026-11-04 12:00:00' };

function database() {
  const rows = new Map();
  let schemaCount = 0;
  const pool = {
    async query(sql) {
      if (sql.startsWith('CREATE')) { schemaCount++; return []; }
      return [[...rows.values()].map(row => ({ ...row }))];
    },
    async execute(sql, params) {
      if (sql.startsWith('INSERT')) {
        const [id, key, payload] = params;
        if (!rows.has(key)) rows.set(key, { id, key, payload, revision: 1 });
        return [{}];
      }
      if (sql.startsWith('SELECT')) {
        const row = sql.includes('game_key') ? rows.get(params[0]) : [...rows.values()].find(item => item.id === params[0]);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.startsWith('UPDATE')) {
        const [payload, id] = params;
        const row = sql.includes('WHERE game_key') ? rows.get(id) : [...rows.values()].find(item => item.id === id);
        row.payload = payload; row.revision++; return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        const row = [...rows.values()].find(item => item.id === params[0] && item.revision === params[1]);
        if (row) rows.delete(row.key);
        return [{ affectedRows: row ? 1 : 0 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() { return { execute: pool.execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; },
  };
  return { pool, get schemaCount() { return schemaCount; } };
}

test('markets cover both teams and match totals while respecting format and missing model fairs', () => {
  const groups = marketGroups(game);
  assert.equal(groups.length, 3);
  assert.equal(allMarkets(game).length, 52);
  const get = id => allMarkets(game).find(market => market.id === id);
  assert.equal(get('b:ml').fair, 184);
  assert.equal(get('a:handicap:-1.5').available, true);
  assert.equal(get('a:handicap:-2.5').available, false);
  assert.equal(get('a:map:4').available, false);
  assert.equal(get('a:kills:over:3').needsLine, true);
  assert.equal(get('a:kills:over:3').fair, undefined);
  assert.equal(allMarkets({ ...game, series_format: 'BO1' }).find(market => market.id === 'match:maps:over').available, false);
  assert.equal(allMarkets({ ...game, series_format: 'BO5' }).find(market => market.id === 'a:handicap:-2.5').available, true);
});

test('validates market choices, American odds, and independently editable total lines', () => {
  const normalized = normalizeGame(game);
  assert.throws(() => chooseMarkets(normalized, []), /Select at least/);
  assert.throws(() => chooseMarkets(normalized, ['a:map:5']), /unavailable/);
  assert.throws(() => chooseMarkets(normalized, ['arbitrary']), /unavailable/);
  assert.equal(chooseMarkets(normalized, ['a:ml', 'a:ml']).length, 1);
  const draft = { game: normalized, markets: chooseMarkets(normalized, ['a:ml', 'match:kills:over:1']) };
  const input = { markets: draft.markets.map(market => ({ ...market, playTo: '-110', line: market.needsLine ? '25.5' : '' })), notes: '', recipients: [] };
  assert.equal(editDraft(draft, input).markets[1].line, '25.5');
  for (const price of ['-50', '0', '3.5', '+99', 'abc', '1e3']) assert.throws(() => editDraft(draft, { ...input, markets: [{ ...input.markets[0], playTo: price }] }), /American odds/);
  assert.throws(() => editDraft(draft, { ...input, markets: [{ ...input.markets[1], line: '-1' }] }), /positive total/);
  assert.throws(() => editDraft(draft, { ...input, markets: [] }), /at least one/);
  assert.throws(() => editDraft(draft, { ...input, markets: [input.markets[0], input.markets[0]] }), /duplicate/);
  assert.throws(() => normalizeGame({ ...game, sport: 'hockey' }), /League of Legends/);
});

test('persistent queue merges market selections without replacing saved prices or game snapshots', async () => {
  const db = database(); let id = 0;
  const options = { env, createPool: () => db.pool, makeId: () => String(++id) };
  const service = createSendsService(options);
  const first = await service.add({ game, marketIds: ['a:ml'] });
  assert.equal(first.revision, 1);
  const saved = await service.update(first.id, { ...first, markets: [{ ...first.markets[0], playTo: '-160' }], notes: 'Send when ready', recipients: [{ id: 'sam', name: 'Sam', telegramChannel: '-100123' }] });
  assert.equal(saved.revision, 2);
  const merged = await service.add({ game: { ...game, xgb_map1: -200, bo3_price: -250, publishedAt: 'new publication' }, marketIds: ['a:ml', 'b:map:1'] });
  assert.equal(merged.id, first.id);
  assert.equal(merged.markets.length, 2);
  assert.equal(merged.markets[0].playTo, '-160');
  assert.equal(merged.game.publishedAt, game.publishedAt);
  assert.equal(merged.markets[1].fair, 150);
  assert.equal(merged.recipients[0].name, 'Sam');
  const again = await service.add({ game, marketIds: ['a:ml'] });
  assert.equal(again.revision, merged.revision);
  assert.equal(db.schemaCount, 1);
  const restarted = createSendsService(options);
  assert.equal((await restarted.list())[0].id, first.id);
  await service.add({ game: { ...game, a_adc: 'Different ADC' }, marketIds: ['a:ml'] });
  assert.equal((await service.list()).length, 2);
  assert.notEqual(gameKey(normalizeGame(game)), gameKey(normalizeGame({ ...game, a_adc: 'Different ADC' })));
});

test('stale edits and removals are rejected and missing storage never pretends to save', async () => {
  const db = database();
  const service = createSendsService({ env, createPool: () => db.pool });
  const first = await service.add({ game, marketIds: ['a:ml'] });
  const saved = await service.update(first.id, first);
  await assert.rejects(service.update(first.id, first), { status: 409 });
  await assert.rejects(service.remove(first.id, first.revision), { status: 409 });
  assert.equal((await service.list()).length, 1);
  await service.remove(first.id, saved.revision);
  assert.equal((await service.list()).length, 0);
  await assert.rejects(createSendsService({ env: {} }).list(), { code: 'DB_NOT_CONFIGURED' });
});
