const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lukeRows } = require('../src/features/luke/lukeAllocation');
const { originalFill } = require('./original-fill.cjs');
const { createLukeOriginatorService } = require('./luke-originator.cjs');
const fill = (overrides = {}) => ({ betId: 'HAR561', sport: 'hockey', league: 'NCAA', event: 'Harvard vs Boston',
  selection: 'Moneyline', betDate: '2026-11-17', originalStake: 10000, originalOdds: 150, originalFromHistory: true,
  status: 'WIN', settledProfit: 15000, ...overrides });

test('applies partner splits to original risk, P/L and weighted odds before allocating once per Bet ID', () => {
  const [row] = lukeRows([
    fill({ id: '1', partnerId: 'a', splitPercent: 50, originalStake: 5000, originalOdds: 100, settledProfit: 5000 }),
    fill({ id: '2', partnerId: 'b', splitPercent: 25, selection: 'Over 5.5', originalStake: 5000, originalOdds: 200, status: 'LOSS', settledProfit: -5000 }),
    fill({ sport: 'lol' }), fill({ league: 'NHL' }), fill({ league: 'Not NCAA' }),
  ]);
  assert.equal(row.fills, 2);
  assert.equal(row.totalAmount, 3750);
  assert.equal(row.pregameOdds, 7 / 3);
  assert.equal(row.lukeRisk, 1687.5);
  assert.equal(row.confirmsProfit, 1250);
  assert.equal(row.lukeProfit, 562.5);
  assert.equal(row.settledOdds, 1 + 1 / 3);
});

test('a 50% partner contributes half their risk and P/L before Luke’s 45% allocation', () => {
  const [row] = lukeRows([fill({ originalStake: 1000, settledProfit: 200, splitPercent: 50 })]);
  assert.equal(row.totalAmount, 500);
  assert.equal(row.confirmsProfit, 100);
  assert.equal(row.lukeRisk, 225);
  assert.equal(row.lukeProfit, 45);
  const [loss] = lukeRows([fill({ originalStake: 1000, status: 'LOSS', settledProfit: -1000, splitPercent: 50 })]);
  assert.equal(loss.lukeProfit, -225);
});

test('uses split-adjusted odds for the cap and split-adjusted risk for open exposure', () => {
  const fills = [
    fill({ originalStake: 20000, originalOdds: -200, settledProfit: 10000, splitPercent: 40 }),
    fill({ originalStake: 20000, originalOdds: 200, status: 'LOSS', settledProfit: -20000, splitPercent: 10 }),
  ];
  const [row] = lukeRows(fills);
  assert.equal(row.totalAmount, 10000);
  assert.equal(row.pregameOdds, 1.8);
  assert.equal(row.lukeRisk, 3750);
  assert.equal(row.confirmsProfit, 2000);
  assert.equal(row.lukeProfit, 750);
  const [open] = lukeRows([fills[0], { ...fills[1], status: 'UNGRADED', settledProfit: null }]);
  assert.equal(open.lukeRisk, 3750);
  assert.equal(open.openRisk, 750);
  assert.equal(open.lukeProfit, 1500);
  assert.equal(open.status, 'Partially settled');
});

test('0% partners do not contribute exposure, P/L or unsettled fills', () => {
  assert.deepEqual(lukeRows([fill({ splitPercent: 0 })]), []);
  const [row] = lukeRows([fill({ splitPercent: 50 }), fill({ splitPercent: 0, status: 'UNGRADED', originalStake: null, settledProfit: null })]);
  assert.equal(row.fills, 1);
  assert.equal(row.status, 'Settled');
  assert.equal(row.totalAmount, 5000);
  assert.equal(row.confirmsProfit, 7500);
});

test('applies the requested caps above, at, and below decimal 2 with configurable allocation', () => {
  const row = (values, percent = 45) => lukeRows([fill(values)], percent)[0];
  assert.equal(row({}).lukeRisk, 3000);
  assert.equal(row({ originalOdds: -100 }).lukeRisk, 3000);
  assert.equal(row({ originalOdds: -200, originalStake: 20000 }).lukeRisk, 6000);
  assert.equal(row({ originalOdds: -200, originalStake: 10000 }).lukeRisk, 4500);
  assert.equal(row({}, 10).lukeRisk, 1000);
  assert.equal(row({}, 0).lukeRisk, 0);
  assert.equal(row({ originalStake: 123.45, originalOdds: -110 }, 45.25).lukeRisk, 55.86);
  assert.throws(() => row({}, 101), /allocation/);
  assert.equal(lukeRows([fill()], 45, 2000)[0].lukeRisk, 2000);
  assert.equal(lukeRows([fill({ originalOdds: -100 })], 45, 2000)[0].lukeRisk, 2000);
  const [favorite] = lukeRows([fill({ originalOdds: -200, originalStake: 20000, settledProfit: 10000 })], 45, 2000);
  assert.equal(favorite.lukeRisk, 4000);
  assert.equal(favorite.lukeProfit, 2000);
});

test('voids, partial voids and resettlements keep original risk, odds, and denominator while using Confirms P/L', () => {
  const original = fill({ originalStake: 10000, originalOdds: -200, stake: 0, odds: 100, status: 'VOID', settledProfit: 0 });
  const [voided] = lukeRows([original]);
  assert.equal(voided.lukeRisk, 4500);
  assert.equal(voided.lukeProfit, 0);
  const [resettled] = lukeRows([{ ...original, status: 'PARTRETURN', settledProfit: 1250 }]);
  assert.equal(resettled.totalAmount, 10000);
  assert.equal(resettled.lukeRisk, 4500);
  assert.equal(resettled.settledOdds, 1.125);
  assert.equal(resettled.lukeProfit, 562.5);
  const [lost] = lukeRows([{ ...original, status: 'LOSS', settledProfit: -10000 }]);
  assert.equal(lost.lukeProfit, -4500);
});

test('$9,000 at even money with $6,000 voided returns Luke $4,000 with $1,000 net profit', () => {
  const [original] = lukeRows([fill({ originalStake: 9000, originalOdds: 100, settledProfit: 9000 })]);
  assert.equal(original.lukeRisk, 3000);
  assert.equal(original.lukeProfit, 3000);
  const [partlyVoided] = lukeRows([
    fill({ originalStake: 6000, originalOdds: 100, status: 'VOID', settledProfit: 0 }),
    fill({ originalStake: 3000, originalOdds: 100, status: 'WIN', settledProfit: 3000 }),
  ]);
  assert.equal(partlyVoided.totalAmount, 9000);
  assert.equal(partlyVoided.lukeRisk, 3000);
  assert.equal(partlyVoided.lukeProfit, 1000);
  assert.equal(partlyVoided.lukeRisk + partlyVoided.lukeProfit, 4000);
});

test('partial settlement shows P/L to date without treating pending fills as finalized odds', () => {
  const [row] = lukeRows([fill({ originalStake: 1000, settledProfit: 500 }),
    fill({ originalStake: 1000, status: 'UNGRADED', settledProfit: null })]);
  assert.equal(row.status, 'Partially settled');
  assert.equal(row.lukeRisk, 900);
  assert.equal(row.openRisk, 450);
  assert.equal(row.lukeProfit, 225);
  assert.equal(row.settledOdds, null);
  assert.equal(lukeRows([fill({ settledProfit: null })])[0].lukeProfit, null);
  assert.equal(lukeRows([fill({ originalStake: null })])[0].lukeRisk, null);
  assert.equal(lukeRows([fill({ originalFromHistory: false })])[0].status, 'Needs review');
  for (const sign of [-1, 1]) {
    const [rounded] = lukeRows([fill({ originalStake: 100, settledProfit: sign * 2.5 })], 5);
    assert.equal(rounded.lukeProfit, sign * 0.13);
  }
});

test('originals come from the first complete audit entry, even after odds edits, voids and resettlements', () => {
  const current = { betId: 'HAR561', risk: 100, odds: 100, grade: 'PARTRETURN', pl: 200 };
  const incomplete = { ...current, risk: null, odds: null };
  const pregame = { ...current, risk: 10000, odds: -200, grade: 'UNGRADED', pl: null };
  const history = [
    { payload: { before: null, after: { ...pregame, betId: 'BOS145' } } },
    { payload: JSON.stringify({ before: null, after: incomplete }) },
    { payload: { before: incomplete, after: pregame } },
    { payload: { before: pregame, after: { ...current, grade: 'VOID' } } },
    { payload: { before: { ...current, grade: 'VOID' }, after: current } },
  ];
  assert.deepEqual(originalFill(current, history), { originalStake: 10000, originalOdds: -200, originalFromHistory: true });
  assert.deepEqual(originalFill(current), { originalStake: 100, originalOdds: 100, originalFromHistory: false });
});

test('saves allocation durably with revision checks and applies the Confirms partner split', async () => {
  const stored = { allocation_bps: 4500, risk_win_cap_cents: 300000, revision: 1 };
  const pool = {
    async query(sql) { return sql.startsWith('SELECT') ? [[{ ...stored }]] : [[]]; },
    async execute(sql, [bps, revision]) {
      if (revision !== stored.revision) return [{ affectedRows: 0 }];
      stored.allocation_bps = bps; stored.revision++;
      return [{ affectedRows: 1 }];
    }, async end() {},
  };
  const confirmsService = { async listReportBets(options) {
    assert.deepEqual(options, { includeOriginal: true, includeIncomplete: true });
    return [fill({ splitPercent: 50 })];
  } };
  const make = () => createLukeOriginatorService({ env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' }, createPool: () => pool, confirmsService });
  assert.equal((await make().report()).rows[0].lukeRisk, 2250);
  assert.equal((await make().report()).settings.riskWinCap, 3000);
  await make().save({ allocationPercent: '40', revision: 1 });
  const report = await make().report();
  assert.equal(report.settings.allocationPercent, 40);
  assert.equal(report.settings.riskWinCap, 3000);
  assert.equal(report.rows[0].lukeRisk, 2000);
  assert.equal(report.rows[0].lukeProfit, 3000);
  assert.equal(report.rows[0].totalAmount, 5000);
  assert.equal(report.rows[0].confirmsProfit, 7500);
  await assert.rejects(make().save({ allocationPercent: '20', riskWinCap: '2000', revision: 1 }), error => error.status === 409);
  for (const value of ['', null, 'abc', '-1', '100.01', '2.123']) {
    await assert.rejects(make().save({ allocationPercent: value, riskWinCap: '2000', revision: 2 }), /allocation/);
  }
});

test('upgrades existing Luke settings with the $3,000 default without replacing allocation', async () => {
  let migrated = false;
  const service = createLukeOriginatorService({
    env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' },
    createPool: () => ({ async query(sql) {
      if (sql.startsWith('SHOW')) return [[]];
      if (sql.startsWith('ALTER')) { migrated = true; return [[]]; }
      if (sql.startsWith('SELECT')) return [[{ allocation_bps: 3500, risk_win_cap_cents: migrated ? 300000 : null, revision: 4 }]];
      return [[]];
    } }), confirmsService: { async listReportBets() { return []; } },
  });
  const report = await service.report();
  assert.ok(migrated);
  assert.deepEqual(report.settings, { allocationPercent: 35, riskWinCap: 3000, revision: 4 });
});

test('settlement checks persist across service restarts independently of grades and P/L with stale-write protection', async () => {
  const saved = new Map();
  let bet = fill();
  const pool = {
    async query(sql) {
      if (sql.startsWith('SHOW')) return [[{ Field: 'risk_win_cap_cents' }]];
      if (sql.startsWith('SELECT allocation_bps')) return [[{ allocation_bps: 4500, risk_win_cap_cents: 300000, revision: 1 }]];
      if (sql.includes('FROM hub_luke_bet_caps')) return [[]];
      if (sql.startsWith('SELECT bet_id')) return [[...saved.values()].map(row => ({ ...row }))];
      return [[]];
    },
    async execute(sql, values) {
      if (sql.startsWith('INSERT INTO hub_luke_settlements')) {
        const [bet_id, settled] = values;
        if (saved.has(bet_id)) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        saved.set(bet_id, { bet_id, settled, revision: 1 });
      } else {
        const [settled, bet_id, revision] = values;
        const current = saved.get(bet_id);
        if (current?.revision !== revision) return [{ affectedRows: 0 }];
        saved.set(bet_id, { bet_id, settled, revision: revision + 1 });
      }
      return [{ affectedRows: 1 }];
    }, async end() {},
  };
  const make = () => createLukeOriginatorService({ env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' },
    createPool: () => pool, confirmsService: { async listReportBets() { return [bet, fill({ betId: 'BOS145' })]; } } });
  assert.equal((await make().report()).rows.find(row => row.betId === 'HAR561').settledWithLuke, false);
  const marked = await make().setSettlement('HAR561', { settledWithLuke: true, settlementRevision: 0 });
  assert.equal(marked.settlementRevision, 1);
  const [checked] = (await make().report()).rows.filter(row => row.betId === 'HAR561');
  assert.equal(checked.settledWithLuke, true);
  assert.equal(checked.lukeProfit, 4500);
  assert.equal((await make().report()).rows.find(row => row.betId === 'BOS145').settledWithLuke, false);
  await assert.rejects(make().setSettlement('HAR561', { settledWithLuke: false, settlementRevision: 0 }), error => error.status === 409);
  bet = { ...bet, status: 'LOSS', settledProfit: -10000 };
  assert.equal((await make().report()).rows.find(row => row.betId === 'HAR561').settledWithLuke, true);
  await make().setSettlement('HAR561', { settledWithLuke: false, settlementRevision: 1 });
  assert.equal((await make().report()).rows.find(row => row.betId === 'HAR561').settledWithLuke, false);
  await assert.rejects(make().setSettlement('HAR561', { settledWithLuke: true, settlementRevision: 1 }), error => error.status === 409);
  await assert.rejects(make().setSettlement('HAR561', { settledWithLuke: 'true', settlementRevision: 2 }), /Refresh/);
});

test('stores each Bet ID cap independently, restores it after restart, and recalculates only that bet', async () => {
  const caps = new Map();
  const pool = {
    async query(sql) {
      if (sql.startsWith('SHOW')) return [[{ Field: 'risk_win_cap_cents' }]];
      if (sql.startsWith('SELECT allocation_bps')) return [[{ allocation_bps: 4500, risk_win_cap_cents: 300000, revision: 1 }]];
      if (sql.includes('FROM hub_luke_bet_caps')) return [[...caps.values()].map(row => ({ ...row }))];
      if (sql.includes('FROM hub_luke_settlements')) return [[{ bet_id: 'HAR561', settled: 1, revision: 3 }]];
      return [[]];
    },
    async execute(sql, values) {
      if (sql.startsWith('INSERT')) {
        const [bet_id, risk_win_cap_cents] = values;
        if (caps.has(bet_id)) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        caps.set(bet_id, { bet_id, risk_win_cap_cents, revision: 1 });
      } else {
        const [risk_win_cap_cents, bet_id, revision] = values;
        if (caps.get(bet_id)?.revision !== revision) return [{ affectedRows: 0 }];
        caps.set(bet_id, { bet_id, risk_win_cap_cents, revision: revision + 1 });
      }
      return [{ affectedRows: 1 }];
    }, async end() {},
  };
  const make = () => createLukeOriginatorService({ env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' },
    createPool: () => pool, confirmsService: { async listReportBets() { return [
      fill({ originalStake: 20000, originalOdds: 100, splitPercent: 50, settledProfit: 20000 }),
      fill({ betId: 'BOS145', originalStake: 20000, originalOdds: -200, splitPercent: 50, settledProfit: 10000 }),
    ]; } } });
  assert.ok((await make().report()).rows.every(row => row.riskWinCap === 3000 && row.capRevision === 0));
  const changed = await make().setCap('HAR561', { riskWinCap: '2000', capRevision: 0 });
  assert.equal(changed.lukeRisk, 2000);
  assert.equal(changed.lukeProfit, 2000);
  assert.equal(changed.capRevision, 1);
  assert.equal(changed.settledWithLuke, true);
  assert.equal(changed.settlementRevision, 3);
  let report = await make().report();
  const other = report.rows.find(row => row.betId === 'BOS145');
  assert.equal(other.riskWinCap, 3000);
  assert.equal(other.lukeRisk, 4500);
  assert.equal(other.lukeProfit, 2250);
  const favorite = await make().setCap('BOS145', { riskWinCap: '1500', capRevision: 0 });
  assert.equal(favorite.lukeRisk, 3000);
  assert.equal(favorite.lukeProfit, 1500);
  const updated = await make().setCap('HAR561', { riskWinCap: '2500', capRevision: 1 });
  assert.equal(updated.lukeRisk, 2500);
  report = await make().report();
  assert.equal(report.rows.find(row => row.betId === 'HAR561').riskWinCap, 2500);
  assert.equal(report.rows.find(row => row.betId === 'BOS145').riskWinCap, 1500);
  await assert.rejects(make().setCap('HAR561', { riskWinCap: 3000, capRevision: 0 }), error => error.status === 409);
  await assert.rejects(make().setCap('HAR561', { riskWinCap: 3000, capRevision: 1 }), error => error.status === 409);
  for (const value of ['', null, true, 'abc', '-1', '0', '10000000.01', '2.123']) {
    await assert.rejects(make().setCap('HAR561', { riskWinCap: value, capRevision: 2 }), /cap/);
  }
});
