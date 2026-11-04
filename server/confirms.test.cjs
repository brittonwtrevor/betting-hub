const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfirmsService, sourceId } = require('./confirms.cjs');
const { validateExtraction } = require('./confirm-parser.cjs');
const { columns } = require('./confirm-record.cjs');
const copy = value => structuredClone(value);
const context = { game: { team_a: 'Hanwha Life Esports', team_b: 'Bilibili Gaming', begin_at: '2026-11-05 00:00:00', sport: 'lol', league: 'Worlds', match_id: '123' }, markets: [{ id: 'a:ml', label: 'HLE ML' }], recipients: [{ id: 'trevor', name: 'Trevor', telegramChannel: '-5550868176' }] };
const original = { botId: '1', chatId: '-5550868176', chat: 'trevor_partner', from: 'Trevor', messageId: 10, updateId: 42,
  senderId: '12345', senderName: 'Trevor Britton', senderUsername: 'TrevorBRedSox',
  receivedAt: '2026-11-04T18:17:00.000Z', date: '2026-11-04T18:17:00.000Z', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], contexts: [{ betId: 'HAN187', context }] };
const extraction = { bets: [{ betId: 'HAN187', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110 }], issues: [] };
function fixture(options = {}) {
  let data = { sources: {}, bets: {}, audit: [], receipts: {} };
  let time = new Date('2026-11-04T18:18:00.000Z');
  let messages = [copy(original)];
  let configured = options.configured ?? true;
  let failure;
  let parseCalls = 0;
  let nextId = 0;
  const trace = [];
  async function execute(sql, p = []) {
    trace.push(sql);
    if (failure?.(sql)) throw new Error('private-host password=secret');
    if (sql.includes('GET_LOCK')) return [[{ acquired: options.acquired ?? 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SHOW COLUMNS')) return [Object.keys(columns).map(Field => ({ Field }))];
    if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'partner_bet_dates' }, { Key_name: 'sender_bet_dates' }]];
    if (sql.startsWith('SELECT b.id')) return [[]];
    if (sql.startsWith('INSERT INTO hub_confirm_sources')) {
      const [id, bot_id, chat_id, message_id, update_id, payload, created_at, updated_at] = p;
      data.sources[id] ||= { id, bot_id, chat_id, message_id, update_id, payload, created_at, updated_at, revision: 1, status: 'pending', attempts: 0, retry_at_ms: 0, lease_until_ms: 0 };
    } else if (sql.startsWith('SELECT * FROM hub_confirm_sources WHERE id')) return [[data.sources[p[0]]].filter(Boolean).map(copy)];
    else if (sql.startsWith('SELECT * FROM hub_confirm_sources WHERE')) return [Object.values(data.sources).filter(row => row.status === 'pending' || row.status === 'error' && row.attempts < 3 && row.retry_at_ms <= p[0] || row.status === 'processing' && row.lease_until_ms <= p[1]).slice(0, 5).map(copy)];
    else if (sql.startsWith('SELECT * FROM hub_confirm_sources ORDER')) return [Object.values(data.sources).map(copy)];
    else if (sql.startsWith('SELECT * FROM hub_confirm_bets WHERE source_id IN')) return [Object.values(data.bets).filter(row => p.includes(row.source_id)).map(copy)];
    else if (sql.startsWith('SELECT * FROM hub_confirm_bets WHERE source_id')) return [Object.values(data.bets).filter(row => row.source_id === p[0]).map(copy)];
    else if (sql.startsWith('SELECT * FROM hub_confirm_bets WHERE id')) return [[data.bets[p[0]]].filter(Boolean).map(copy)];
    else if (sql.startsWith('INSERT INTO hub_confirm_bets')) {
      const [id, source_id, payload, created_at, updated_at] = p;
      if (data.bets[id]) throw new Error('Duplicate bet row');
      data.bets[id] = { id, source_id, payload, created_at, updated_at, revision: 1 };
    } else if (sql.startsWith('INSERT INTO hub_confirm_notifications')) {
      const [id, bet_row_id, bet_revision, source_id, bot_id, chat_id, kind, payload, created_at, updated_at] = p;
      data.receipts[id] ||= { id, bet_row_id, bet_revision, source_id, bot_id, chat_id, kind, payload, created_at, updated_at, status: 'pending' };
    } else if (sql.startsWith("UPDATE hub_confirm_notifications SET status = 'cancelled'")) {
      for (const receipt of Object.values(data.receipts)) if (receipt.bet_row_id === p[1] && ['pending', 'error'].includes(receipt.status)) receipt.status = 'cancelled';
    } else if (sql.startsWith('SELECT id, bet_row_id')) return [Object.values(data.receipts).filter(row => p.includes(row.source_id)).map(copy)];
    else if (sql.startsWith('INSERT INTO hub_confirm_history')) data.audit.push(copy(p));
    else if (sql.startsWith('UPDATE hub_confirm_bets')) {
      Object.assign(data.bets[p[2]], { payload: p[0], updated_at: p[1], revision: data.bets[p[2]].revision + 1 });
    } else if (sql.startsWith("UPDATE hub_confirm_sources SET status = 'processing'")) {
      const row = data.sources[p[1]];
      if (row.revision !== p[2]) return [{ affectedRows: 0 }];
      Object.assign(row, { status: 'processing', attempts: row.attempts + 1, lease_until_ms: p[0], last_error: null });
    } else if (sql.startsWith("UPDATE hub_confirm_sources SET status = 'error'")) {
      const row = data.sources[p[4]];
      if (row.revision === p[5] && row.status === 'processing') Object.assign(row, { status: 'error', last_error: p[0], retry_at_ms: p[1], attempts: p[2], lease_until_ms: 0, updated_at: p[3] });
    } else if (sql.startsWith('UPDATE hub_confirm_sources SET status = ?')) {
      const row = data.sources[p[3]];
      Object.assign(row, { status: p[0], payload: p[1], updated_at: p[2], revision: row.revision + 1, lease_until_ms: 0, last_error: null });
    } else if (sql.startsWith('UPDATE hub_confirm_sources SET update_id')) {
      const row = data.sources[p[4]];
      Object.assign(row, { update_id: p[0], payload: p[1], status: p[2], updated_at: p[3], revision: row.revision + 1, attempts: 0, retry_at_ms: 0, lease_until_ms: 0, last_error: null });
    } else if (sql.startsWith("UPDATE hub_confirm_sources SET status = 'manual'")) {
      const row = data.sources[p[1]]; Object.assign(row, { status: 'manual', revision: row.revision + 1, updated_at: p[0], last_error: null, lease_until_ms: 0 });
    } else if (sql.startsWith("UPDATE hub_confirm_sources SET status = 'pending'")) {
      const row = data.sources[p[0]]; Object.assign(row, { status: 'pending', revision: row.revision + 1, attempts: 0, retry_at_ms: 0, last_error: null });
    } else if (!sql.startsWith('CREATE')) throw new Error(`Unrecognized SQL: ${sql}`);
    return [{ affectedRows: 1 }];
  }
  const pool = { execute, query: execute, async end() {}, async getConnection() {
    let snapshot;
    return { execute, query: execute, async beginTransaction() { snapshot = copy(data); }, async commit() { snapshot = null; }, async rollback() { if (snapshot) data = snapshot; }, release() {}, destroy() {} };
  } };
  const telegramReceiver = { async readInbox({ forParsing }) {
    assert.equal(forParsing, true);
    return { messages: messages.filter(message => data.sources[sourceId(message)]?.update_id !== message.updateId).map(copy), receiver: { lastPolledAt: time.toISOString() } };
  } };
  const parser = { configured: () => configured, model: () => 'test-cheap-model', async parse(message) {
    parseCalls++;
    if (options.parse) return options.parse(message);
    return { ...validateExtraction(options.extraction || extraction, message), model: 'test-cheap-model', usage: { inputTokens: 500, outputTokens: 100 } };
  } };
  const makeService = () => createConfirmsService({ env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' },
    telegramReceiver, parser, createPool: () => pool, now: () => time, makeId: () => `bet-${++nextId}`, logger: { error() {} },
    sendsService: { async findByBetIds(ids) { return ids.filter(id => ['HAN187', 'BOS145'].includes(id)).map(betId => ({ betId })); } },
  });
  return { service: makeService(), makeService, get data() { return data; }, get parseCalls() { return parseCalls; }, trace,
    setFailure(value) { failure = value; }, setMessages(value) { messages = value; }, setConfigured(value) { configured = value; }, setTime(value) { time = new Date(value); } };
}

test('imports, parses, and persists multiple bets once across repeated reads and server restarts', async () => {
  const f = fixture({ extraction: { bets: [extraction.bets[0], { ...extraction.bets[0], bet: 'Spread -1.5', risk: 200, odds: 150 }], issues: [] } });
  await f.service.tick();
  const { sources } = await f.service.list();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].status, 'parsed');
  assert.equal(sources[0].bets.length, 2);
  assert.equal(sources[0].partner.id, 'trevor');
  assert.equal(sources[0].message.text, original.text);
  assert.equal(sources[0].bets[0].risk, 1);
  assert.equal(sources[0].bets[0].partnerId, 'trevor');
  assert.equal(sources[0].bets[0].bettorName, 'Trevor Britton');
  assert.equal(sources[0].bets[0].telegramSenderId, '12345');
  assert.equal(sources[0].bets[0].betDate, '2026-11-04');
  assert.equal(sources[0].bets[0].gameAt, '2026-11-05T00:00:00.000Z');
  assert.equal(sources[0].bets[0].createdAt, '2026-11-04T18:18:00.000Z');
  assert.equal(f.data.audit.length, 2);
  assert.equal(Object.keys(f.data.receipts).length, 2);
  const receipt = Object.values(f.data.receipts)[0];
  assert.equal(receipt.chat_id, '-5550868176');
  assert.match(JSON.parse(receipt.payload).text, /was logged\./);
  await f.service.tick();
  await f.makeService().tick();
  assert.equal(f.parseCalls, 1);
  assert.equal(Object.keys(f.data.bets).length, 2);
});

test('attribution edits persist in the same row while source identity remains server controlled', async () => {
  const f = fixture(); await f.service.tick();
  const initial = (await f.service.list()).sources[0].bets[0];
  f.setTime('2026-11-05T18:20:00.000Z');
  const edited = await f.service.update(initial.id, { ...initial, bettorName: 'Luke', betDate: '2026-11-03',
    partnerId: 'forged', telegramSenderId: 'forged', grade: 'WIN' });
  assert.equal(Object.keys(f.data.bets).length, 1);
  assert.equal(edited.bettorName, 'Luke');
  assert.equal(edited.partnerId, 'trevor');
  assert.equal(edited.telegramSenderId, '12345');
  assert.equal(edited.betDate, '2026-11-03');
  assert.equal(edited.gradedAt, '2026-11-05T18:20:00.000Z');
  f.setTime('2026-11-06T18:20:00.000Z');
  const renamed = await f.service.update(initial.id, { ...edited, bettorName: 'Luke B' });
  assert.equal(renamed.gradedAt, edited.gradedAt);
  const ungraded = await f.service.update(initial.id, { ...renamed, grade: 'UNGRADED' });
  assert.equal(ungraded.gradedAt, null);
  for (const changes of [{ bettorName: '' }, { betDate: '2026-02-30' }]) {
    await assert.rejects(f.service.update(initial.id, { ...ungraded, ...changes }), error => error.status === 400);
  }
});

test('deleting updates the current row and audit, survives restart and Telegram edits, and cannot be re-extracted', async () => {
  const f = fixture(); await f.service.tick();
  const source = (await f.service.list()).sources[0];
  const initial = source.bets[0];
  const graded = await f.service.update(initial.id, { ...initial, grade: 'WIN' });
  await assert.rejects(f.service.remove(initial.id, initial), error => error.status === 409);
  f.setFailure(sql => sql.startsWith('INSERT INTO hub_confirm_history'));
  await assert.rejects(f.service.remove(graded.id, graded));
  assert.equal(JSON.parse(f.data.bets[graded.id].payload).deletedAt, null);
  f.setFailure(null);
  await f.service.remove(graded.id, graded, 'trevor');
  const persisted = JSON.parse(f.data.bets[graded.id].payload);
  assert.ok(persisted.deletedAt);
  assert.equal(persisted.pl, 0.91);
  assert.equal(f.data.audit.at(-1)[2], 'delete');
  await f.makeService().tick();
  f.setMessages([{ ...original, updateId: 43, receivedAt: '2026-11-04T18:30:00.000Z' }]);
  await f.service.tick();
  const after = (await f.service.list()).sources[0];
  assert.equal(after.bets.length, 0);
  assert.equal(after.deletedBetCount, 1);
  assert.equal(after.deletionNotifications.length, 1);
  assert.equal(after.deletionNotifications[0].status, 'pending');
  const deletionReceipt = Object.values(f.data.receipts).find(row => row.kind === 'delete');
  assert.equal(deletionReceipt.chat_id, '-5550868176');
  assert.match(JSON.parse(deletionReceipt.payload).text, /was deleted from the bet log\./);
  assert.ok(Object.values(f.data.receipts).filter(row => row.kind !== 'delete').every(row => row.status === 'cancelled'));
  await assert.rejects(f.service.remove(graded.id, { revision: graded.revision + 1 }), /already deleted/);
  assert.equal(Object.values(f.data.receipts).filter(row => row.kind === 'delete').length, 1);
  assert.equal(f.parseCalls, 1);
  await assert.rejects(f.service.retry(after.id, { revision: after.revision }), /will not replace/);
  await assert.rejects(f.service.update(graded.id, { ...graded, revision: graded.revision + 1 }), /deleted/);
});

test('a deletion receipt queue failure rolls back both deletion and cancellation of prior receipts', async () => {
  const f = fixture(); await f.service.tick();
  const bet = (await f.service.list()).sources[0].bets[0];
  f.setFailure(sql => sql.startsWith('INSERT INTO hub_confirm_notifications'));
  await assert.rejects(f.service.remove(bet.id, bet));
  f.setFailure(null);
  assert.equal((await f.service.list()).sources[0].bets.length, 1);
  assert.equal(Object.values(f.data.receipts)[0].status, 'pending');
  assert.equal(JSON.parse(f.data.bets[bet.id].payload).deletedAt, null);
});

test('editing all six fields and grading persists computed P/L with before/after history and rejects stale revisions', async () => {
  const f = fixture(); await f.service.tick();
  const source = (await f.service.list()).sources[0];
  const initial = source.bets[0];
  const edited = await f.service.update(initial.id, { ...initial, betId: 'BOS145', game: 'Other game', team: 'Other team', bet: 'Spread -1.5', risk: '500', odds: '+150', grade: 'WIN', pl: 999999 }, 'trevor');
  assert.equal(edited.pl, 750);
  assert.equal(edited.revision, 2);
  const gradeReceipt = Object.values(f.data.receipts).find(row => row.kind === 'grade');
  assert.match(JSON.parse(gradeReceipt.payload).text, /was graded WIN with net P\/L of \+\$750.00\./);
  assert.equal((await f.makeService().list()).sources[0].bets[0].game, 'Other game');
  assert.equal(f.data.audit.at(-1)[2], 'grade');
  assert.equal(f.data.audit.at(-1)[3], 'trevor');
  assert.equal(JSON.parse(f.data.audit.at(-1)[4]).before.pl, null);
  await assert.rejects(f.service.update(initial.id, initial), error => error.status === 409);
  const partial = await f.service.update(initial.id, { ...edited, grade: 'PARTRETURN', partialReturn: '-25.50' });
  assert.equal(partial.pl, -25.5);
  await assert.rejects(f.service.update(initial.id, { ...partial, betId: 'BAD999' }), /does not exist/);
});

test('audit failure rolls back the financial edit instead of leaving an unaudited grade', async () => {
  const f = fixture(); await f.service.tick();
  const bet = (await f.service.list()).sources[0].bets[0];
  f.setFailure(sql => sql.startsWith('INSERT INTO hub_confirm_history'));
  await assert.rejects(f.service.update(bet.id, { ...bet, grade: 'LOSS' }));
  f.setFailure(null);
  assert.equal((await f.service.list()).sources[0].bets[0].grade, 'UNGRADED');
});

test('a receipt queue failure rolls back the grade, and unchanged grades do not enqueue more messages', async () => {
  const f = fixture(); await f.service.tick();
  const bet = (await f.service.list()).sources[0].bets[0];
  f.setFailure(sql => sql.startsWith('INSERT INTO hub_confirm_notifications'));
  await assert.rejects(f.service.update(bet.id, { ...bet, grade: 'WIN' }));
  f.setFailure(null);
  assert.equal((await f.service.list()).sources[0].bets[0].grade, 'UNGRADED');
  const graded = await f.service.update(bet.id, { ...bet, grade: 'WIN' });
  const count = Object.keys(f.data.receipts).length;
  await f.service.update(bet.id, { ...graded, bettorName: 'Luke' });
  assert.equal(Object.keys(f.data.receipts).length, count);
});

test('a Telegram edit flags review without overwriting parsed bets, user corrections, or grades', async () => {
  const f = fixture(); await f.service.tick();
  const bet = (await f.service.list()).sources[0].bets[0];
  await f.service.update(bet.id, { ...bet, risk: 500, grade: 'WIN' });
  f.setMessages([{ ...original, updateId: 43, text: 'HAN187 changed message $200', receivedAt: '2026-11-04T18:20:00.000Z' }]);
  await f.service.tick();
  const source = (await f.service.list()).sources[0];
  assert.equal(source.status, 'review');
  assert.match(source.issues[0], /edited/);
  assert.equal(source.bets[0].risk, 500);
  assert.equal(source.bets[0].pl, 454.55);
  assert.equal(source.message.updateId, 43);
  assert.equal(f.parseCalls, 1);
  await assert.rejects(f.service.retry(source.id, { revision: source.revision }), /will not replace/);
});

test('manual entry works without an AI key and cancels an in-flight extraction without overwriting the human bet', async () => {
  const manual = fixture({ configured: false });
  await manual.service.tick();
  const source = (await manual.service.list()).sources[0];
  assert.equal(manual.parseCalls, 0);
  const added = await manual.service.addManual(source.id, { revision: source.revision });
  assert.equal(added.team, 'Hanwha Life Esports');
  assert.equal(added.odds, null);
  await assert.rejects(manual.service.retry(source.id, { revision: 2 }), /model access key/);
  let finish;
  const f = fixture({ parse: message => new Promise(resolve => { finish = () => resolve(validateExtraction(extraction, message)); }) });
  const work = f.service.tick();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const processing = (await f.service.list()).sources[0];
  await f.service.addManual(processing.id, { revision: processing.revision });
  finish(); await work;
  const result = (await f.service.list()).sources[0];
  assert.equal(result.status, 'manual');
  assert.equal(result.bets.length, 1);
  assert.equal(result.bets[0].risk, null);
});

test('retryable failures back off and stop at three attempts; a manual retry can requeue an empty reply', async () => {
  const f = fixture({ parse: async () => { throw Object.assign(new Error('Temporary model outage'), { confirmSafe: true, retryable: true }); } });
  await f.service.tick();
  await f.service.tick();
  assert.equal(f.parseCalls, 1);
  f.setTime('2026-11-04T18:20:00.000Z'); await f.service.tick();
  f.setTime('2026-11-04T18:22:00.000Z'); await f.service.tick();
  f.setTime('2026-11-04T18:24:00.000Z'); await f.service.tick();
  assert.equal(f.parseCalls, 3);
  const source = (await f.service.list()).sources[0];
  assert.equal(source.status, 'error');
  await f.service.retry(source.id, { revision: source.revision });
  await f.service.tick();
  assert.equal(f.parseCalls, 4);
});

test('missing fields create review rows and a competing parser instance makes no paid call', async () => {
  const f = fixture({ extraction: { bets: [{ ...extraction.bets[0], risk: null }], issues: ['Missing risk.'] } });
  await f.service.tick();
  const source = (await f.service.list()).sources[0];
  assert.equal(source.status, 'review');
  assert.equal(source.bets[0].complete, false);
  await assert.rejects(f.service.update(source.bets[0].id, { ...source.bets[0], grade: 'WIN' }), /Complete/);
  const competing = fixture({ acquired: 0 });
  await competing.service.tick();
  assert.equal(competing.parseCalls, 0);
});
