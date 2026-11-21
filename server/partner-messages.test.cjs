const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPartnerMessagesService, normalize } = require('./partner-messages.cjs');

const id = '9709b3c0-bddd-4ad0-8e9b-2c6c53f98a11';
const secondId = '9709b3c0-bddd-4ad0-8e9b-2c6c53f98a12';
const env = { LOL_DO_DB_HOST: 'db.example', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'test-only', LOL_DO_DB_NAME: 'defaultdb' };
function fixture() {
  const messages = new Map(), deliveries = new Map(), calls = [];
  let failReceipt = false;
  const pool = {
    async query(sql) {
      if (sql.startsWith('CREATE')) return [[]];
      if (sql.startsWith('SELECT * FROM hub_partner_messages ORDER')) return [[...messages.values()].reverse().slice(0, 30)];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params = []) {
      if (sql.startsWith('SELECT * FROM hub_partner_messages')) return [[messages.get(params[0])].filter(Boolean)];
      if (sql.startsWith('SELECT * FROM hub_partner_message_deliveries')) return [[...deliveries.values()].filter(row => sql.includes(' IN (') ? params.includes(row.message_id) : row.message_id === params[0]).map(row => ({ ...row }))];
      if (sql.startsWith('INSERT INTO hub_partner_messages')) {
        const [messageId, text, partnerIds, botId, createdAt] = params;
        if (messages.has(messageId)) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        messages.set(messageId, { id: messageId, message_text: text, partner_ids: partnerIds, bot_id: botId, created_at: createdAt });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO hub_partner_message_deliveries')) {
        const [messageId, channel, names] = params;
        deliveries.set(`${messageId}:${channel}`, { message_id: messageId, channel, partner_names: names, status: 'pending', sent_at: null, telegram_message_id: null, error: '' });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT d.*')) {
        const row = [...deliveries.values()].find(delivery => delivery.status === 'pending');
        return [row ? [{ ...row, ...messages.get(row.message_id) }] : []];
      }
      if (sql.includes("SET status = 'sending'")) {
        const [attemptedAt, messageId, channel] = params;
        Object.assign(deliveries.get(`${messageId}:${channel}`), { status: 'sending', attempted_at: attemptedAt, error: '' });
      } else if (sql.includes('SET status = ?')) {
        if (failReceipt) { failReceipt = false; throw new Error('Database disconnected after Telegram sent'); }
        const [status, sentAt, telegramMessageId, error, messageId, channel] = params;
        Object.assign(deliveries.get(`${messageId}:${channel}`), { status, sent_at: sentAt, telegram_message_id: telegramMessageId, error });
      } else if (sql.includes("SET status = 'uncertain'")) {
        for (const row of deliveries.values()) if (row.status === 'sending' && row.attempted_at < params[1]) Object.assign(row, { status: 'uncertain', error: params[0] });
      } else if (sql.includes("SET status = 'pending'")) {
        for (const row of deliveries.values()) if (row.message_id === params[0] && row.status === 'failed') Object.assign(row, { status: 'pending', error: '' });
      } else throw new Error(`Unexpected SQL: ${sql}`);
      return [{ affectedRows: 1 }];
    },
    async getConnection() {
      let snapshot;
      return {
        execute: pool.execute,
        async beginTransaction() { snapshot = { messages: structuredClone([...messages]), deliveries: structuredClone([...deliveries]) }; },
        async commit() {},
        async rollback() { messages.clear(); deliveries.clear(); for (const entry of snapshot.messages) messages.set(...entry); for (const entry of snapshot.deliveries) deliveries.set(...entry); },
        release() {},
      };
    },
  };
  const partners = [
    { id: 'a', name: 'Partner A', telegramChannel: '@SharedChat' },
    { id: 'b', name: 'Partner B', telegramChannel: '@sharedchat' },
    { id: 'c', name: 'Partner C', telegramChannel: '-100123' },
    { id: 'd', name: 'Partner D', telegramChannel: 'https://t.me/+invite' },
  ];
  const telegram = {
    async getConfig() { return { configured: true, bot: { id: 12345 } }; },
    async sendMessage(input) { calls.push(input); return { message: { messageId: calls.length } }; },
  };
  let time = new Date('2026-11-21T19:00:00Z');
  const service = createPartnerMessagesService({ env, createPool: () => pool, partnersService: { async list() { return partners; } }, telegramService: telegram, pause: async () => {}, now: () => time });
  return { service, telegram, calls, deliveries, partners, set time(value) { time = value; }, failReceipt() { failReceipt = true; } };
}

test('validates text and recipients before queueing, preserving plain text and newlines', () => {
  const input = { id, text: 'Hello partners!\nPrices +110 < -120 & updates.', partnerIds: ['c', 'a', 'a'] };
  assert.deepEqual(normalize(input), { ...input, partnerIds: ['a', 'c'] });
  for (const changes of [{ id: 'bad' }, { text: '  \n ' }, { text: 'x'.repeat(4097) }, { partnerIds: [] }, { partnerIds: ['../a'] }, { partnerIds: Array(501).fill('a') }]) assert.throws(() => normalize({ ...input, ...changes }));
});

test('queues saved partners once per channel and replays a receipt without repeating delivery', async () => {
  const { service, calls } = fixture();
  const input = { id, text: 'A plain message\nwith +odds & <text>.', partnerIds: ['a', 'b', 'c'] };
  const queued = await service.add(input);
  assert.equal(calls.length, 0);
  assert.equal(queued.deliveries.length, 2);
  assert.deepEqual(queued.deliveries[0].partners, ['Partner A', 'Partner B']);
  await service.processPending();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.text === input.text && call.expectedBotId === '12345'));
  assert.deepEqual(new Set(calls.map(call => call.chatId)), new Set(['@sharedchat', '-100123']));
  assert.ok((await service.get(id)).deliveries.every(delivery => delivery.status === 'sent'));
  assert.ok((await service.add({ ...input, partnerIds: ['c', 'b', 'a'] })).deliveries.every(delivery => delivery.status === 'sent'));
  await service.retry(id);
  await service.processPending();
  assert.equal(calls.length, 2);
  await assert.rejects(service.add({ ...input, text: 'Changed' }), { status: 409 });
});

test('rejects unsaved or unusable partners and a missing bot without sending anything', async () => {
  const { service, calls, telegram } = fixture();
  await assert.rejects(service.add({ id, text: 'Hi', partnerIds: ['missing'] }), /no longer exists/);
  await assert.rejects(service.add({ id, text: 'Hi', partnerIds: ['a', 'd'] }), /Partner D/);
  assert.deepEqual(await service.list(), []);
  telegram.getConfig = async () => ({ configured: false });
  await assert.rejects(service.add({ id, text: 'Hi', partnerIds: ['a'] }), /Configure/);
  assert.equal(calls.length, 0);
});

test('partial failures continue other channels, retry only failed channels, and never retry uncertain sends', async () => {
  const { service, telegram, calls } = fixture();
  telegram.sendMessage = async input => {
    calls.push(input);
    if (input.chatId === '-100123') throw Object.assign(new Error('No posting permission'), { telegramSafe: true });
    throw Object.assign(new Error('Timeout. Check this chat.'), { telegramSafe: true, deliveryUncertain: true });
  };
  await service.add({ id, text: 'Hi', partnerIds: ['a', 'c'] });
  await service.processPending();
  assert.deepEqual((await service.get(id)).deliveries.map(delivery => delivery.status), ['uncertain', 'failed']);
  telegram.sendMessage = async input => { calls.push(input); return { message: { messageId: 7 } }; };
  await service.retry(id);
  await service.processPending();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].chatId, '-100123');
  assert.deepEqual((await service.get(id)).deliveries.map(delivery => delivery.status), ['uncertain', 'sent']);
});

test('a restarted worker resumes pending channels and marks interrupted sends uncertain', async () => {
  const context = fixture();
  await context.service.add({ id, text: 'Hi', partnerIds: ['a', 'c'] });
  context.failReceipt();
  await assert.rejects(context.service.processPending(), /Database disconnected/);
  assert.equal(context.calls.length, 1);
  context.time = new Date('2026-11-21T19:03:00Z');
  await context.service.processPending();
  assert.equal(context.calls.length, 2);
  assert.deepEqual((await context.service.get(id)).deliveries.map(delivery => delivery.status), ['uncertain', 'sent']);
});

test('only one local worker runs, while a new message may intentionally repeat the text', async () => {
  const { service, calls } = fixture();
  await service.add({ id, text: 'Hi', partnerIds: ['a'] });
  await Promise.all([service.processPending(), service.processPending()]);
  assert.equal(calls.length, 1);
  await service.add({ id: secondId, text: 'Hi', partnerIds: ['a'] });
  await service.processPending();
  assert.equal(calls.length, 2);
  assert.equal((await service.list()).length, 2);
});
