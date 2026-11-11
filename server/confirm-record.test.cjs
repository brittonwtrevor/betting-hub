const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateRecords, recordMetadata, columns } = require('./confirm-record.cjs');

const message = { botId: '1', chatId: '-100123', messageId: 10, from: 'trevor', date: '2026-11-05T01:00:00.000Z',
  receivedAt: '2026-11-05T01:01:00.000Z', text: 'BOS145 ML +300 $2,500.00\noriginal reply', contexts: [] };
const source = { message, partner: { id: 'partner-1', name: 'Trevor' } };

test('backfills existing bet attribution from the archived event without replacing financial fields', async () => {
  const calls = [];
  let released = false;
  const db = {
    async query(sql) {
      calls.push([sql]);
      if (sql.startsWith('SHOW')) return [[]];
      if (sql.startsWith('SELECT b.id')) return [[{ id: 'legacy', bot_id: 1, update_id: 42,
        payload: JSON.stringify({ betId: 'BOS145', grade: 'LOSS', risk: 500, pl: -500 }),
        source_payload: JSON.stringify(source), updated_at: '2026-11-05T02:00:00.000Z' }]];
      return [[]];
    },
    async execute(sql, params) {
      calls.push([sql, params]);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.startsWith('SELECT sender_id')) return [[{ sender_id: 123, kind: 'message',
        raw_update: JSON.stringify({ message: { from: { id: 123, username: 'trevor', first_name: 'Trevor', last_name: 'Britton' } } }) }]];
      return [[]];
    },
    release() { released = true; }, destroy() {},
  };
  await migrateRecords({ async getConnection() { return db; } });
  assert.ok(released);
  const alter = calls.find(([sql]) => sql.startsWith('ALTER'))[0];
  assert.match(alter, /partner_bet_dates/);
  assert.match(alter, /telegram_sender_id/);
  const [sql, params] = calls.find(([sql]) => sql.startsWith('UPDATE hub_confirm_bets SET'));
  assert.match(sql, /JSON_MERGE_PATCH\(payload, \?\)/);
  assert.match(sql, /recordVersion.*IS NULL/s);
  const metadata = JSON.parse(params[0]);
  assert.equal(metadata.bettorName, 'Trevor Britton');
  assert.equal(metadata.telegramSenderId, '123');
  assert.equal(metadata.partnerId, 'partner-1');
  assert.equal(metadata.betDate, '2026-11-04');
  assert.equal(metadata.gradedAt, '2026-11-05T02:00:00.000Z');
  assert.equal(metadata.rawResponse, message.text);
  for (const field of ['risk', 'odds', 'pl', 'grade', 'bet', 'team']) assert.equal(Object.hasOwn(metadata, field), false);
});

test('already-upgraded schema needs no ALTER and schema locks are released on migration failure', async () => {
  const calls = [];
  let fail = false;
  const db = { async execute(sql) { calls.push(sql); return [[{ acquired: 1 }]]; },
    async query(sql) {
      if (sql.startsWith('SHOW COLUMNS')) return [Object.keys(columns).map(Field => ({ Field }))];
      if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'partner_bet_dates' }, { Key_name: 'sender_bet_dates' }]];
      if (fail) throw new Error('test failure');
      calls.push(sql); return [[]];
    }, release() {}, destroy() {} };
  await migrateRecords({ async getConnection() { return db; } });
  assert.equal(calls.some(sql => sql.startsWith('ALTER')), false);
  fail = true;
  await assert.rejects(migrateRecords({ async getConnection() { return db; } }), /test failure/);
  assert.match(calls.at(-1), /RELEASE_LOCK/);
});

test('anonymous/channel messages do not invent a human sender identity', () => {
  const metadata = recordMetadata({ ...source, message: { ...message, from: '', senderId: null } }, { betId: 'BOS145', grade: 'UNGRADED' });
  assert.equal(metadata.telegramSenderId, null);
  assert.equal(metadata.telegramSenderName, '');
  assert.equal(metadata.bettorName, 'Trevor');
  assert.equal(metadata.gradedAt, null);
});

test('backfills raw responses for existing records without replacing saved snapshots or bet details', async () => {
  const calls = [];
  const db = {
    async execute(sql) { return [[{ acquired: 1 }]]; },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SHOW COLUMNS')) return [Object.keys(columns).map(Field => ({ Field }))];
      if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'partner_bet_dates' }, { Key_name: 'sender_bet_dates' }]];
      return [[]];
    }, release() {},
  };
  await migrateRecords({ async getConnection() { return db; } });
  const backfill = calls.find(sql => sql.startsWith('UPDATE hub_confirm_bets b JOIN'));
  assert.match(backfill, /JSON_SET\(b.payload, '\$\.rawResponse'/);
  assert.match(backfill, /WHERE JSON_EXTRACT\(b.payload, '\$\.rawResponse'\) IS NULL/);
  assert.doesNotMatch(backfill, /revision|updated_at|notifications/);
});
