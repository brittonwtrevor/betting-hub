const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createSendsService, normalizeGame, chooseMarkets, editDraft, gameKey, teamPrefix, telegramText } = require('./sends.cjs');
const { marketGroups, allMarkets } = require('../src/features/bets/markets');
const env = { LOL_DO_DB_HOST: 'db.example', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'test-only', LOL_DO_DB_NAME: 'defaultdb' };
const game = { sport: 'lol', match_id: '11', game_id: '101', team_a: 'Alpha', team_b: 'Bravo', league: 'LCK', begin_at: '2026-11-05 19:00:00', series_format: 'BO3', xgb_map1: -150, bo3_price: -184, bo5_price: -215, a_adc: 'ADC', publishedAt: '2026-11-04 12:00:00' };

function database() {
  const rows = new Map();
  const reservations = new Map();
  let schemaCount = 0;
  const pool = {
    async query(sql) {
      if (sql.startsWith('CREATE')) { schemaCount++; return []; }
      return [[...rows.values()].map(row => ({ ...row }))];
    },
    async execute(sql, params) {
      if (sql.includes('hub_send_ids')) {
        if (sql.includes('LEFT JOIN hub_send_drafts')) return [[...reservations].filter(([betId]) => params.includes(betId)).map(([bet_id, draft_id]) => ({
          bet_id, draft_id, payload: [...rows.values()].find(row => row.id === draft_id)?.payload ?? null,
        }))];
        if (sql.startsWith('SELECT')) return [[...reservations].filter(([, id]) => id === params[0]).map(([bet_id]) => ({ bet_id }))];
        if (reservations.has(params[0]) || [...reservations.values()].includes(params[1])) throw Object.assign(new Error('Duplicate ID'), { code: 'ER_DUP_ENTRY' });
        reservations.set(params[0], params[1]);
        return [{}];
      }
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
        row.payload = payload;
        if (sql.includes('revision = revision + 1')) row.revision++;
        return [{ affectedRows: 1 }];
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
  return { pool, rows, reservations, get schemaCount() { return schemaCount; } };
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

test('incoming messages can resolve reserved IDs and retain their send context independently of draft deletion', async () => {
  const db = database();
  const service = createSendsService({ env, createPool: () => db.pool, makeId: () => 'draft', numberStart: () => 145 });
  const draft = await service.add({ game, marketIds: ['a:ml'] });
  const results = await service.findByBetIds(['ALP145', 'BAD999']);
  assert.equal(results.length, 1);
  assert.equal(results[0].betId, draft.betId);
  assert.equal(results[0].draftId, draft.id);
  assert.equal(results[0].context.game.team_a, 'Alpha');
  await service.remove(draft.id, draft.revision);
  assert.deepEqual(await service.findByBetIds(['ALP145']), [{ betId: 'ALP145', draftId: 'draft', context: null }]);
  assert.deepEqual(await service.findByBetIds([]), []);
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
  assert.throws(() => normalizeGame({ ...game, sport: 'football' }), /supported game/);
});

test('persistent queue merges market selections without replacing saved prices or game snapshots', async () => {
  const db = database(); let id = 0;
  const options = { env, createPool: () => db.pool, makeId: () => String(++id) };
  const service = createSendsService(options);
  const first = await service.add({ game, marketIds: ['a:ml'] });
  assert.equal(first.revision, 1);
  assert.match(first.betId, /^ALP\d{3}$/);
  const saved = await service.update(first.id, { ...first, markets: [{ ...first.markets[0], playTo: '-160' }], notes: 'Send when ready', recipients: [{ id: 'sam', name: 'Sam', telegramChannel: '-100123' }] });
  assert.equal(saved.revision, 2);
  const merged = await service.add({ game: { ...game, xgb_map1: -200, bo3_price: -250, publishedAt: 'new publication' }, marketIds: ['a:ml', 'b:map:1'] });
  assert.equal(merged.id, first.id);
  assert.equal(merged.betId, first.betId);
  assert.equal(merged.markets.length, 2);
  assert.equal(merged.markets[0].playTo, '-160');
  assert.equal(merged.game.publishedAt, game.publishedAt);
  assert.equal(merged.markets[1].fair, 150);
  assert.equal(merged.recipients[0].name, 'Sam');
  const again = await service.add({ game, marketIds: ['a:ml'] });
  assert.equal(again.revision, merged.revision);
  assert.equal(db.schemaCount, 2);
  const restarted = createSendsService(options);
  assert.equal((await restarted.list())[0].id, first.id);
  assert.equal((await restarted.list())[0].betId, first.betId);
  await service.add({ game: { ...game, a_adc: 'Different ADC' }, marketIds: ['a:ml'] });
  assert.equal((await service.list()).length, 2);
  assert.notEqual(gameKey(normalizeGame(game)), gameKey(normalizeGame({ ...game, a_adc: 'Different ADC' })));
});

test('send IDs use the selected team, handle short names, and remain reserved after deletion', async () => {
  const db = database(); let id = 0;
  const service = createSendsService({ env, createPool: () => db.pool, makeId: () => String(++id), numberStart: () => 999 });
  assert.equal(teamPrefix({ game: { team_a: 'Karmine Corp' }, markets: [{ id: 'match:maps:over' }] }), 'KAR');
  assert.equal(teamPrefix({ game: { team_b: 'T1' }, markets: [{ id: 'b:ml' }] }), 'TXX');
  assert.equal(teamPrefix({ game: { team_a: 'Équipe' }, markets: [] }), 'EQU');
  const first = await service.add({ game, marketIds: ['b:ml'] });
  assert.equal(first.betId, 'BRA999');
  const second = await service.add({ game: { ...game, match_id: '12' }, marketIds: ['b:ml'] });
  assert.equal(second.betId, 'BRA000');
  const edited = await service.update(first.id, { ...first, betId: 'BAD123' });
  assert.equal(edited.betId, 'BRA999');
  await service.remove(first.id, edited.revision);
  const third = await service.add({ game, marketIds: ['b:ml'] });
  assert.equal(third.betId, 'BRA001');
});

test('existing cards receive a persisted ID on load without changing prices or revision', async () => {
  const db = database();
  const legacy = { id: 'legacy', game: normalizeGame(game), markets: chooseMarkets(game, ['a:ml']), notes: 'Keep me', recipients: [] };
  legacy.markets[0].playTo = '-110';
  db.rows.set('old-key', { id: legacy.id, key: 'old-key', payload: JSON.stringify(legacy), revision: 7 });
  const service = createSendsService({ env, createPool: () => db.pool, numberStart: () => 7 });
  const [draft] = await service.list();
  assert.equal(draft.betId, 'ALP007');
  assert.equal(draft.revision, 7);
  assert.equal(draft.markets[0].playTo, '-110');
  assert.equal(draft.notes, 'Keep me');
  assert.equal(JSON.parse(db.rows.get('old-key').payload).betId, 'ALP007');
  assert.equal((await service.list())[0].betId, 'ALP007');
});

test('exhausted prefixes return a clear error instead of reusing IDs', async () => {
  const db = database();
  for (let number = 0; number < 1000; number++) db.reservations.set(`ALP${String(number).padStart(3, '0')}`, `old-${number}`);
  const service = createSendsService({ env, createPool: () => db.pool });
  await assert.rejects(service.add({ game, marketIds: ['a:ml'] }), { status: 409, message: 'All 1,000 send IDs for ALP have been used.' });
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

async function readySend(marketIds = ['a:ml', 'match:kills:over:1']) {
  const db = database();
  const service = createSendsService({ env, createPool: () => db.pool, numberStart: () => 145 });
  const draft = await service.add({ game, marketIds });
  return { service, draft: { ...draft, markets: draft.markets.map(market => ({ ...market, playTo: '+150', line: market.needsLine ? '25.5' : market.line })), notes: 'Line might move', recipients: [{ id: 'sam', name: 'Sam', telegramChannel: '-100123' }] } };
}

test('sending saves edits, formats the bet ID/markets/notes, deduplicates destinations and reloads persisted delivery', async () => {
  const { service, draft } = await readySend();
  const calls = [];
  const telegram = { async sendMessage(input) { calls.push(input); return { message: { messageId: 42, chatId: '-100123' } }; } };
  draft.recipients.push({ id: 'same-channel', name: 'Same group', telegramChannel: '-100123' });
  const sent = await service.send(draft.id, draft, telegram);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, '-100123');
  assert.match(calls[0].text, /Bet ID: ALP145/);
  assert.match(calls[0].text, /Alpha vs Bravo/);
  assert.match(calls[0].text, /2:00 PM EST/);
  assert.match(calls[0].text, /Alpha ML · Play to \+150/);
  assert.match(calls[0].text, /Kill total over · Map 1 25.5 · Play to \+150/);
  assert.match(calls[0].text, /Notes: Line might move/);
  assert.equal(sent.deliveries[0].status, 'sent');
  assert.equal(sent.deliveries[0].messageId, 42);
  assert.equal(sent.deliveries[0].chatId, '-100123');
  assert.equal((await service.list())[0].notes, draft.notes);
  const again = await service.send(sent.id, (await service.list())[0], telegram);
  assert.equal(calls.length, 1);
  await service.send(again.id, { ...again, notes: 'Updated price guidance' }, telegram);
  assert.equal(calls.length, 2);
});

test('send validation rejects incomplete fields and invalid destinations before any Telegram delivery', async () => {
  const { service, draft } = await readySend();
  let calls = 0;
  const telegram = { async sendMessage() { calls++; } };
  await assert.rejects(service.send(draft.id, { ...draft, recipients: [] }, telegram), /Select at least/);
  await assert.rejects(service.send(draft.id, { ...draft, recipients: [...draft.recipients, { id: 'bad', name: 'Bad group', telegramChannel: 'https:\/\/t.me\/+invite' }] }, telegram), /Bad group/);
  await assert.rejects(service.send(draft.id, { ...draft, markets: draft.markets.map(market => ({ ...market, playTo: '' })) }, telegram), /play-to price/);
  await assert.rejects(service.send(draft.id, { ...draft, markets: draft.markets.map(market => ({ ...market, line: '' })) }, telegram), /Enter a total/);
  await assert.rejects(service.send(draft.id, { ...draft, markets: draft.markets.map(market => ({ ...market, playTo: '-50' })) }, telegram), /American odds/);
  await assert.rejects(service.send(draft.id, { ...draft, revision: 0 }, telegram), { status: 409 });
  assert.equal(calls, 0);
});

test('partial failures retry only rejected channels and keep confirmed channels delivered', async () => {
  const { service, draft } = await readySend();
  draft.recipients.push({ id: 'second', name: 'Second', telegramChannel: '@second' });
  const calls = [];
  let fail = true;
  const telegram = { async sendMessage(input) {
    calls.push(input.chatId);
    if (input.chatId === '@second' && fail) throw Object.assign(new Error('Bot cannot post.'), { telegramSafe: true });
    return { message: { messageId: 42 } };
  } };
  const partial = await service.send(draft.id, draft, telegram);
  assert.deepEqual(partial.deliveries.map(item => item.status), ['sent', 'failed']);
  fail = false;
  const sent = await service.send(partial.id, partial, telegram);
  assert.deepEqual(calls, ['-100123', '@second', '@second']);
  assert.deepEqual(sent.deliveries.map(item => item.status), ['sent', 'sent']);
});

test('unconfirmed deliveries are persisted and skipped on retries without leaking raw errors', async () => {
  const { service, draft } = await readySend();
  let calls = 0;
  const telegram = { async sendMessage() { calls++; throw new Error('private-host password=secret'); } };
  const uncertain = await service.send(draft.id, draft, telegram);
  assert.equal(uncertain.deliveries[0].status, 'uncertain');
  assert.doesNotMatch(uncertain.deliveries[0].error, /secret|private-host/);
  await service.send(uncertain.id, uncertain, telegram);
  assert.equal(calls, 1);
});

test('a committed in-flight send blocks concurrent sending, editing, merging and deletion', async () => {
  const { service, draft } = await readySend();
  let finish;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const telegram = { async sendMessage() { started(); return new Promise(resolve => { finish = () => resolve({ message: { messageId: 1 } }); }); } };
  const sending = service.send(draft.id, draft, telegram);
  await entered;
  const current = (await service.list())[0];
  await assert.rejects(service.send(current.id, current, telegram), /in progress/);
  await assert.rejects(service.update(current.id, current), /in progress/);
  await assert.rejects(service.remove(current.id, current.revision), /in progress/);
  await assert.rejects(service.add({ game, marketIds: ['b:ml'] }), /in progress/);
  finish();
  assert.equal((await sending).deliveries[0].status, 'sent');
});


test('hockey markets preserve period rules, goalie scenarios, fair prices, and persisted selections', async () => {
  const hockey = { sport: 'hockey', game_id: 'h1', team_a: 'Boston Bruins', team_b: 'Toronto', league: 'NHL', begin_at: '2026-11-05T01:00:00+0300', goalie_team: 'Home goalie', goalie_opp: 'Away goalie', winoddsfulltime: -150, away_winoddsfulltime: 150, 'full_game_o5.5': -110, reg_time_home_win_prob: 0.45, reg_time_draw_prob: 0.25, reg_time_away_win_prob: 0.30 };
  const normalized = normalizeGame(hockey);
  const markets = allMarkets(normalized);
  assert.equal(markets.length, 59);
  assert.equal(new Set(markets.map(market => market.id)).size, 59);
  for (const side of ['a', 'b']) for (const line of [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]) assert.ok(markets.some(market => market.id === `${side}:handicap:${line}`));
  assert.equal(markets.find(market => market.id === 'match:goals:full:over:5.5').fair, -110);
  assert.equal(markets.find(market => market.id === 'match:goals:reg:over:5.5').fair, null);
  assert.equal(markets.find(market => market.id === 'match:1x2:draw').fair, 300);
  assert.equal(markets.find(market => market.id === 'a:ml:reg').fair, -150);
  assert.equal(markets.find(market => market.id === 'a:1x2').fair, 122);
  assert.equal(chooseMarkets(normalized, markets.map(market => market.id)).length, 59);
  assert.throws(() => chooseMarkets(normalized, ['a:map:1']), /unavailable/);
  assert.notEqual(gameKey(normalized), gameKey(normalizeGame({ ...hockey, goalie_team: 'Another goalie' })));
  const db = database(); let id = 0;
  const service = createSendsService({ env, createPool: () => db.pool, makeId: () => `hockey-${++id}`, numberStart: () => 145 });
  const first = await service.add({ game: hockey, marketIds: ['b:ml', 'match:goals:reg:under:4', 'match:1x2:draw', 'a:ml:reg'] });
  assert.equal(first.betId, 'TOR145');
  const saved = await service.update(first.id, { ...first, recipients: [], notes: '', markets: first.markets.map(market => ({ ...market, playTo: '+150' })) });
  const merged = await service.add({ game: { ...hockey, away_winoddsfulltime: 180 }, marketIds: ['a:handicap:-3.5'] });
  assert.equal(merged.id, saved.id);
  assert.equal(merged.markets[0].fair, 150);
  assert.equal(merged.markets[0].playTo, '+150');
  assert.equal((await service.list())[0].game.sport, 'hockey');
  const message = telegramText(saved);
  assert.equal(message.split('\n')[2], 'Hockey · NHL · Nov 4, 5:00 PM EST');
  assert.match(message, /Total goals under 4 \(regulation only\)/);
  assert.match(message, /ML \(regulation only, draw = void\)/);
  assert.doesNotMatch(message, /League of Legends|Format unknown/);

  const channel = '-100123';
  const legacyText = message.replace('Hockey · NHL', 'Hockey · NHL · Home goalie: Home goalie · Away goalie: Away goalie');
  const fingerprint = createHash('sha256').update(legacyText).digest('hex');
  const key = createHash('sha256').update(`${channel}\n${fingerprint}`).digest('hex');
  const row = db.rows.get(gameKey(normalized));
  row.payload = JSON.stringify({ ...JSON.parse(row.payload), deliveries: [{ key, channel, status: 'sent' }] });
  const recipients = [{ id: 'sam', name: 'Sam', telegramChannel: channel }];
  const calls = [];
  const telegram = { async sendMessage(input) { calls.push(input); return { message: { messageId: 42 } }; } };
  const retried = await service.send(merged.id, { ...saved, revision: merged.revision, recipients }, telegram);
  assert.equal(calls.length, 0);
  await service.send(merged.id, { ...retried, notes: 'Updated price guidance' }, telegram);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text, /Home goalie|Away goalie/);
});
