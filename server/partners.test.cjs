const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPartnersService } = require('./partners.cjs');
const copy = value => structuredClone(value);
function fixture() {
  let rows = {}, aliases = {}, payments = {}, fail = false;
  const db = {
    async query(sql) {
      if (sql.startsWith('CREATE')) return [[]];
      if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'split_bps' }]];
      if (sql.includes('FROM hub_partner_aliases')) return [Object.entries(aliases).map(([legacy_id, partner_id]) => ({ legacy_id, partner_id }))];
      if (sql.includes('FROM hub_partner_payments')) return [Object.values(payments).map(copy)];
      return [Object.values(rows).map(copy)];
    },
    async execute(sql, p) {
      if (fail === true || fail && p?.[0] === fail) throw new Error('private-host password=secret');
      if (sql.startsWith('SELECT * FROM hub_partner_payments')) return [[payments[p[0]]].filter(Boolean).map(copy)];
      if (sql.startsWith('SELECT legacy_id')) return [[aliases[p[0]] ? { partner_id: aliases[p[0]] } : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT split_bps')) return [[rows[p[0]] ?? rows[aliases[p[1]]]].filter(Boolean).map(copy)];
      if (sql.startsWith('SELECT')) return [[sql.includes('name_key =') ? Object.values(rows).find(row => row.name_key === p[0]) : rows[p[0]]].filter(Boolean).map(copy)];
      if (sql.startsWith('INSERT INTO hub_partner_aliases')) { aliases[p[0]] = p[1]; return [{}]; }
      if (sql.startsWith('INSERT INTO hub_partner_payments')) {
        const [id, direction, amount_cents, reference, recorded_at, partner_id] = p;
        if (!rows[partner_id]) return [{ affectedRows: 0 }];
        if (payments[id]) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        payments[id] = { id, partner_id, direction, amount_cents, reference, recorded_at };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT')) {
        const [id, name, name_key, telegram_channel, split_bps, created_at, updated_at] = p;
        if (rows[id] || Object.values(rows).some(row => row.name_key === name_key)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        rows[id] = { id, name, name_key, telegram_channel, split_bps, created_at, updated_at, revision: 1 };
      } else if (sql.startsWith('UPDATE')) {
        const [name, name_key, telegram_channel, split_bps, updated_at, id] = p;
        Object.assign(rows[id], { name, name_key, telegram_channel, split_bps, updated_at, revision: rows[id].revision + 1 });
      } else throw new Error(`Unexpected SQL: ${sql}`);
      return [{ affectedRows: 1 }];
    },
    async getConnection() {
      let snapshot;
      return { execute: db.execute, async beginTransaction() { snapshot = copy({ rows, aliases }); }, async commit() {},
        async rollback() { ({ rows, aliases } = snapshot); }, release() {} };
    }, async end() {},
  };
  const service = () => createPartnersService({ createPool: () => db, env: { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' },
    now: () => new Date('2026-11-04T21:00:00.000Z'), makeId: () => 'new-id' });
  return { service: service(), restart: service, fail: (value = true) => { fail = value; } };
}

test('partners and channel edits survive service restart with stable IDs and revision protection', async () => {
  const f = fixture();
  const partner = await f.service.add({ name: ' Trevor ', telegramChannel: 'https://t.me/trevor_partner' });
  assert.equal(partner.telegramChannel, '@trevor_partner');
  const saved = await f.restart().update(partner.id, { ...partner, telegramChannel: '-5550868176' });
  assert.equal(saved.id, partner.id);
  assert.equal(saved.revision, 2);
  assert.equal((await f.restart().list())[0].telegramChannel, '-5550868176');
  await assert.rejects(f.service.update(partner.id, partner), error => error.status === 409);
  await assert.rejects(f.service.add({ name: 'trevor' }), error => error.status === 409);
});

test('partner splits persist with decimal precision and resolve archived partner IDs', async () => {
  const f = fixture();
  const initial = await f.service.add({ id: 'main', name: 'Sam' });
  assert.equal(initial.splitPercent, 100);
  const updated = await f.service.update(initial.id, { ...initial, splitPercent: '50.25' });
  await f.restart().importLegacy({ partners: [{ id: 'old', name: 'Sam', splitPercent: 10 }] });
  assert.equal(await f.restart().findSplitBps('old'), 5025);
  const channelEdit = await f.service.update(initial.id, { name: 'Sam', telegramChannel: '@sam', revision: updated.revision });
  assert.equal(channelEdit.splitPercent, 50.25);
  for (const splitPercent of [-1, '100.01', '1.234', '', null]) {
    await assert.rejects(f.service.update(initial.id, { ...channelEdit, splitPercent }), { status: 400 });
  }
  const zero = await f.service.update(initial.id, { ...channelEdit, splitPercent: 0 });
  assert.equal(zero.splitPercent, 0);
  assert.equal(await f.service.findSplitBps('old'), 0);
});

test('payments persist across restarts, preserve cents, and can be retried without a duplicate', async () => {
  const f = fixture();
  const partner = await f.service.add({ name: 'Sam' });
  const input = { id: 'eaaeff15-68a1-4c09-a77a-1a17bc7f5609', partnerId: partner.id, direction: 'Sent', amount: '100.07', reference: ' transfer ' };
  const payment = await f.service.addPayment(input);
  assert.deepEqual(payment, {
    id: input.id, partnerId: input.partnerId, direction: 'Sent', amount: 100.07, reference: 'transfer',
    date: '2026-11-04T21:00:00.000Z', status: 'Complete',
  });
  assert.deepEqual(await f.restart().addPayment(input), payment);
  await assert.rejects(f.service.addPayment({ ...input, direction: 'Received' }), { status: 409 });
  await assert.rejects(f.service.addPayment({ ...input, partnerId: 'missing' }), { status: 404 });
  for (const amount of ['0', '-100', '10.005', '10000001', '1e2']) {
    await assert.rejects(f.service.addPayment({ ...input, amount }), { status: 400 });
  }
  assert.deepEqual(await f.restart().listPayments(), [payment]);
});

test('legacy import keeps IDs, is repeatable, and cannot restore an outdated browser channel', async () => {
  const f = fixture();
  const input = { partners: [{ id: 'local-old', name: 'Trevor', telegramChannel: '@old' }] };
  await f.service.importLegacy(input);
  const initial = (await f.service.list())[0];
  await f.service.update(initial.id, { ...initial, telegramChannel: '@new' });
  await f.restart().importLegacy(input);
  const [saved] = await f.service.list();
  assert.equal(saved.id, 'local-old');
  assert.equal(saved.telegramChannel, '@new');
  assert.equal(saved.revision, 2);
  await f.service.importLegacy({ partners: [{ id: 'other-browser-id', name: 'trevor', telegramChannel: '@outdated' }] });
  const records = await f.restart().list();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].legacyIds, ['other-browser-id']);
  assert.equal(records[0].telegramChannel, '@new');
});

test('failed imports roll back, invalid input is rejected, and repeated creates are idempotent', async () => {
  const f = fixture();
  const input = { id: 'stable-id', name: 'Sam', telegramChannel: '@sam' };
  const first = await f.service.add(input);
  assert.deepEqual(await f.service.add(input), first);
  await assert.rejects(f.service.add({ ...input, telegramChannel: '@different' }), error => error.status === 409);
  for (const bad of [{ name: '' }, { name: 'X', telegramChannel: 'https://evil.test' }, { name: 'X', id: '../bad' }]) await assert.rejects(f.service.add(bad), error => error.status === 400);
  f.fail('another');
  await assert.rejects(f.service.importLegacy({ partners: [{ id: 'new', name: 'First' }, { id: 'another', name: 'Second' }] }));
  f.fail(false);
  assert.equal((await f.service.list()).length, 1);
  f.fail();
  await assert.rejects(f.service.add({ name: 'New' }));
});
