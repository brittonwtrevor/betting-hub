const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramReceiver, extractBetIds } = require('./telegram-receiver.cjs');

const env = { LOL_DO_DB_HOST: 'test', LOL_DO_DB_USER: 'test', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'test' };
const date = '2026-11-04T18:00:00.000Z';
function update(id, text, kind = 'message', more = {}) {
  return { update_id: id, [kind]: { message_id: 10, date: 1793815200, chat: { id: -10012345, title: 'trevor_partner', username: 'trevor_partner' }, from: { id: 123, username: 'trevor' }, ...(text == null ? {} : { text }), ...more } };
}
function fixture(options = {}) {
  let saved = { states: {}, inbox: {}, bets: {} };
  let transaction;
  let time = new Date(date);
  let updates = options.updates || [];
  let acquired = options.acquired ?? 1;
  let fail = options.fail;
  let scheduled;
  let interval;
  let cleared = false;
  const trace = [];
  const errors = [];
  const config = { configured: true, bot: { id: 123456789, username: 'bettingtasks_bot' } };
  const execute = async (sql, p = []) => {
    trace.push({ sql, params: p });
    if (fail?.(sql, p)) throw new Error('private-host password=secret');
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('INSERT INTO hub_telegram_poll_state')) saved.states[p[0]] ||= { next_offset: null, last_update_at_ms: null };
    else if (sql.startsWith('SELECT * FROM hub_telegram_poll_state')) return [[saved.states[p[0]]].filter(Boolean)];
    else if (sql.startsWith('INSERT INTO hub_telegram_inbox')) {
      const [bot_id, update_id, kind, chat_id, message_id, sender_id, raw_text, candidate_bet_ids, raw_update, received_at] = p;
      saved.inbox[`${bot_id}:${update_id}`] ||= { bot_id, update_id, kind, chat_id, message_id, sender_id, raw_text, candidate_bet_ids, raw_update, received_at };
    } else if (sql.startsWith('INSERT INTO hub_telegram_message_bets')) {
      const [bot_id, update_id, bet_id, draft_id, send_context] = p;
      saved.bets[`${bot_id}:${update_id}:${bet_id}`] ||= { bot_id, update_id, bet_id, draft_id, send_context };
    } else if (sql.startsWith('UPDATE hub_telegram_poll_state SET next_offset')) {
      const [next_offset, last_poll_at_ms, lastUpdate, botId] = p;
      Object.assign(saved.states[botId], { next_offset, last_poll_at_ms, last_error: null });
      if (lastUpdate != null) saved.states[botId].last_update_at_ms = lastUpdate;
    } else if (sql.startsWith('UPDATE hub_telegram_poll_state SET last_error')) saved.states[p[1]].last_error = p[0];
    else if (sql.startsWith('SELECT inbox.')) {
      assert.match(sql, /AND EXISTS/);
      assert.match(sql, /JSON_CONTAINS/);
      return [Object.values(saved.inbox).filter(row => row.message_id != null && String(row.bot_id) === p[0] && Object.values(saved.bets).some(bet => {
        if (bet.bot_id !== row.bot_id || bet.update_id !== row.update_id || !bet.send_context) return false;
        const context = JSON.parse(bet.send_context);
        const message = JSON.parse(row.raw_update)[row.kind];
        return context.recipients?.some(partner => partner.telegramChannel === String(row.chat_id) || partner.telegramChannel?.toLowerCase() === `@${message.chat?.username}`.toLowerCase())
          || context.deliveries?.some(delivery => delivery.chatId === String(row.chat_id));
      })).reverse().slice(0, 100).map(row => ({ ...row,
        matched_bet_ids: JSON.stringify(Object.values(saved.bets).filter(bet => bet.bot_id === row.bot_id && bet.update_id === row.update_id).map(bet => bet.bet_id)),
        send_contexts: JSON.stringify(Object.values(saved.bets).filter(bet => bet.bot_id === row.bot_id && bet.update_id === row.update_id).map(bet => ({ betId: bet.bet_id, draftId: bet.draft_id, context: JSON.parse(bet.send_context) }))),
      }))];
    }
    return [{ affectedRows: 1 }];
  };
  const connection = {
    execute,
    async beginTransaction() { trace.push('begin'); transaction = structuredClone(saved); },
    async commit() { if (fail?.('commit')) throw new Error('private commit failure'); trace.push('commit'); transaction = null; },
    async rollback() { trace.push('rollback'); if (transaction) saved = transaction; transaction = null; },
    release() { trace.push('release'); }, destroy() { trace.push('destroy'); },
  };
  const pool = { async query() { return [[]]; }, execute, async getConnection() { return connection; }, async end() { trace.push('end'); } };
  const telegramService = {
    async getConfig() { return config; },
    async receiveUpdates(input) {
      trace.push({ receive: input });
      if (options.receive) return options.receive(input);
      return updates.filter(item => input.offset == null || item.update_id >= input.offset).slice(0, 100);
    },
  };
  const context = { game: { team_a: 'Boston', team_b: 'Other' }, recipients: [{ id: 'trevor', name: 'Trevor', telegramChannel: '@trevor_partner' }] };
  const sendsService = { async findByBetIds(ids) {
    return ids.filter(id => ['BOS145', 'BUX234'].includes(id)).map(betId => ({ betId, draftId: `draft-${betId}`, context }));
  } };
  const makeReceiver = () => createTelegramReceiver({ env: { ...env, ...options.env }, telegramService, sendsService, createPool: () => pool, now: () => time,
    logger: { error: value => errors.push(value) }, setIntervalImpl: (callback, ms) => { scheduled = callback; interval = ms; return { unref() {} }; },
    clearIntervalImpl: () => { cleared = true; },
  });
  return { receiver: makeReceiver(), makeReceiver, get saved() { return saved; }, config, trace, errors, pool,
    get interval() { return interval; }, get scheduled() { return scheduled; }, get cleared() { return cleared; },
    setTime(value) { time = new Date(value); }, setUpdates(value) { updates = value; }, setFail(value) { fail = value; }, setAcquired(value) { acquired = value; } };
}

test('extracts distinct six-character IDs without mistaking larger words for a send', () => {
  assert.deepEqual(extractBetIds('bos145 ML -110 $500, BOS145; BUX234 -1.5 +150 200. BAD999'), ['BOS145', 'BUX234', 'BAD999']);
  assert.deepEqual(extractBetIds('ABOS145 BOS1456 _BOS145 BOS145_'), []);
});

test('archives exact text, full update metadata, and context for all recognized IDs; unmatched messages are preserved', async () => {
  const raw = 'bos145 ML -110 $500\n BUX234 -1.5 +150 200 🚀 BAD999';
  const events = [update(42, raw), update(43, 'a note without an ID'), update(44, 'BAD999 unknown send')];
  const f = fixture({ updates: events });
  assert.deepEqual(await f.receiver.poll(), { updateCount: 3 });
  assert.equal(Object.keys(f.saved.inbox).length, 3);
  assert.equal(f.saved.inbox['123456789:42'].raw_text, raw);
  assert.deepEqual(JSON.parse(f.saved.inbox['123456789:42'].raw_update), events[0]);
  assert.deepEqual(JSON.parse(f.saved.inbox['123456789:42'].candidate_bet_ids), ['BOS145', 'BUX234', 'BAD999']);
  assert.equal(Object.keys(f.saved.bets).length, 2);
  assert.equal(JSON.parse(f.saved.bets['123456789:42:BOS145'].send_context).recipients[0].name, 'Trevor');
  assert.equal(f.saved.states['123456789'].next_offset, 45);
  assert.equal(f.trace.find(item => item.receive).receive.offset, undefined);
});

test('restarts from the committed cursor, deduplicates replayed updates, and appends edits separately', async () => {
  const f = fixture({ updates: [update(42, 'BOS145 original')] });
  await f.receiver.poll();
  const restarted = f.makeReceiver();
  await restarted.poll();
  assert.equal(f.trace.filter(item => item.receive)[1].receive.offset, 43);
  assert.equal(Object.keys(f.saved.inbox).length, 1);
  // Simulate Telegram delivering an overlapping batch after reconnect.
  f.saved.states['123456789'].next_offset = 42;
  f.setUpdates([update(42, 'BOS145 original'), update(43, 'BOS145 corrected -110 $200', 'edited_message')]);
  await restarted.poll();
  assert.equal(Object.keys(f.saved.inbox).length, 2);
  assert.equal(f.saved.inbox['123456789:42'].raw_text, 'BOS145 original');
  assert.equal(f.saved.inbox['123456789:43'].kind, 'edited_message');
  assert.equal(Object.keys(f.saved.bets).length, 2);
});

test('never advances the cursor after an inbox, link, cursor, or commit failure; retries the unsaved batch', async () => {
  for (const failure of ['INSERT INTO hub_telegram_inbox', 'INSERT INTO hub_telegram_message_bets', 'UPDATE hub_telegram_poll_state SET next_offset', 'commit']) {
    const f = fixture({ updates: [update(42, 'BOS145 ML -110 $500')], fail: sql => sql.startsWith(failure) });
    const result = await f.receiver.poll();
    assert.match(result.error, /without advancing/);
    assert.equal(f.saved.states['123456789'].next_offset, null);
    assert.equal(Object.keys(f.saved.inbox).length, 0);
    assert.equal(Object.keys(f.saved.bets).length, 0);
    assert.doesNotMatch(JSON.stringify(f.errors), /private-host|password|secret/);
    f.setFail(null);
    await f.receiver.poll();
    assert.equal(f.trace.filter(item => item.receive).at(-1).receive.offset, undefined);
    assert.equal(f.saved.states['123456789'].next_offset, 43);
    assert.equal(Object.keys(f.saved.inbox).length, 1);
  }
});

test('drains a backlog in batches and commits each batch before requesting a higher offset', async () => {
  const f = fixture({ updates: Array.from({ length: 101 }, (_, i) => update(i + 1, 'hello')) });
  assert.deepEqual(await f.receiver.poll(), { updateCount: 101 });
  const receives = f.trace.filter(item => item.receive);
  assert.deepEqual(receives.map(item => item.receive.offset), [undefined, 101]);
  const secondCall = f.trace.indexOf(receives[1]);
  assert.ok(f.trace.indexOf('commit') < secondCall);
  assert.equal(f.saved.states['123456789'].next_offset, 102);
});

test('only one instance reads the bot and a slow request cannot overlap another local poll', async () => {
  const skipped = fixture({ acquired: 0 });
  assert.deepEqual(await skipped.receiver.poll(), { skipped: true });
  assert.equal(skipped.trace.some(item => item.receive), false);
  let finish;
  const f = fixture({ receive: () => new Promise(resolve => { finish = resolve; }) });
  const first = f.receiver.poll();
  const second = f.receiver.poll();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.trace.filter(item => item.receive).length, 1);
  finish([]);
  await first;
  assert.ok(f.trace.some(item => item.sql?.startsWith('SELECT RELEASE_LOCK')));
});

test('schedules server polling every 10 seconds and closes it cleanly without needing a browser', async () => {
  const f = fixture();
  f.receiver.start();
  f.receiver.start();
  assert.equal(f.interval, 10000);
  await f.receiver.poll();
  f.scheduled();
  await f.receiver.poll();
  assert.equal(f.trace.filter(item => item.receive).length, 2);
  await f.receiver.close();
  assert.equal(f.cleared, true);
  assert.equal(f.trace.at(-1), 'end');
  assert.deepEqual(await f.receiver.poll(), { skipped: true });
  const disabled = fixture({ env: { TELEGRAM_POLLING_ENABLED: 'false' } });
  disabled.receiver.start();
  assert.equal(disabled.interval, undefined);
});

test('preserves captions, channels, media metadata and other update types without inventing extracted text', async () => {
  const photo = update(42, null, 'channel_post', { caption: 'BOS145', photo: [{ file_id: 'photo-id', width: 1000, height: 800 }], from: undefined, sender_chat: { id: -10012345, title: 'Trevor' } });
  const edited = update(43, 'BOS145 revised', 'edited_channel_post');
  const other = { update_id: 44, my_chat_member: { chat: { id: -10012345 }, new_chat_member: { status: 'administrator' } } };
  const f = fixture({ updates: [photo, edited, other] });
  await f.receiver.poll();
  assert.equal(f.saved.inbox['123456789:42'].raw_text, 'BOS145');
  assert.equal(f.saved.inbox['123456789:42'].sender_id, -10012345);
  assert.equal(JSON.parse(f.saved.inbox['123456789:42'].raw_update).channel_post.photo[0].file_id, 'photo-id');
  assert.deepEqual(JSON.parse(f.saved.inbox['123456789:44'].raw_update), other);
  assert.equal(f.saved.states['123456789'].next_offset, 45);
});

test('saved inbox reads durable messages and polling status without making a Telegram receive request', async () => {
  const f = fixture({ updates: [update(42, 'BOS145 ML -110 $500')] });
  await f.receiver.poll();
  const calls = f.trace.filter(item => item.receive).length;
  const inbox = await f.receiver.readInbox();
  assert.equal(inbox.messages[0].text, 'BOS145 ML -110 $500');
  assert.deepEqual(inbox.messages[0].betIds, ['BOS145']);
  assert.equal(inbox.messages[0].chat, 'trevor_partner');
  assert.equal(inbox.messages[0].botId, '123456789');
  assert.equal(inbox.messages[0].contexts[0].betId, 'BOS145');
  assert.equal(inbox.messages[0].contexts[0].context.game.team_a, 'Boston');
  assert.equal(inbox.receiver.lastPolledAt, date);
  assert.equal(f.trace.filter(item => item.receive).length, calls);
});

test('parser backlog reads use the latest unimported version while the normal inbox remains an event archive', async () => {
  const f = fixture({ updates: [update(42, 'BOS145 ML -110 $500')] });
  await f.receiver.poll();
  await f.receiver.readInbox({ forParsing: true });
  const sql = f.trace.filter(item => item.sql?.startsWith('SELECT inbox.')).at(-1).sql;
  assert.match(sql, /hub_confirm_sources imported/);
  assert.match(sql, /hub_telegram_inbox newer/);
  assert.match(sql, /imported\.update_id = inbox\.update_id/);
});

test('inbox shows only recognized bet IDs from their partner chats while preserving all incoming raw events', async () => {
  const f = fixture({ updates: [update(42, 'BOS145 ML -110 $500'), update(43, 'a partner note without an ID'),
    update(44, 'BAD999 unknown ID'), update(45, 'BOS145 unrelated chat', 'message', { chat: { id: -999999, title: 'trevor_partner' } })] });
  await f.receiver.poll();
  assert.equal(Object.keys(f.saved.inbox).length, 4);
  assert.equal(Object.keys(f.saved.bets).length, 2);
  const inbox = await f.receiver.readInbox();
  assert.deepEqual(inbox.messages.map(message => message.updateId), [42]);
  // Numeric chat IDs work for private partner groups without a username.
  f.setUpdates([update(46, 'BOS145 numeric group', 'message', { chat: { id: -100777, title: 'Private partner' } })]);
  await f.receiver.poll();
  const link = f.saved.bets['123456789:46:BOS145'];
  link.send_context = JSON.stringify({ recipients: [{ telegramChannel: '-100777' }] });
  assert.deepEqual((await f.receiver.readInbox()).messages.map(message => message.updateId), [46, 42]);
  // A recorded delivery's resolved numeric ID survives a public username change.
  link.send_context = JSON.stringify({ recipients: [{ telegramChannel: '@old_username' }], deliveries: [{ chatId: '-100777' }] });
  assert.deepEqual((await f.receiver.readInbox()).messages.map(message => message.updateId), [46, 42]);
});

test('rediscovers randomized Telegram IDs after a week without incoming updates', async () => {
  const f = fixture({ updates: [update(1000, 'old message')] });
  await f.receiver.poll();
  f.setTime('2026-11-12T18:00:00.000Z');
  f.setUpdates([update(12, 'new sequence')]);
  await f.receiver.poll();
  assert.equal(f.trace.filter(item => item.receive).at(-1).receive.offset, undefined);
  assert.equal(f.saved.states['123456789'].next_offset, 13);
  assert.equal(Object.keys(f.saved.inbox).length, 2);
});

test('missing credentials and lock-release failures are recoverable without leaking secrets or retaining a locked pooled connection', async () => {
  const missing = fixture();
  missing.config.configured = false;
  assert.match((await missing.receiver.poll()).error, /TELEGRAM_BOT_TOKEN/);
  assert.equal(missing.trace.some(item => item.receive), false);
  const f = fixture({ fail: sql => sql.startsWith('SELECT RELEASE_LOCK') });
  await f.receiver.poll();
  assert.equal(f.trace.at(-1), 'destroy');
  assert.equal(f.trace.includes('release'), false);
});
