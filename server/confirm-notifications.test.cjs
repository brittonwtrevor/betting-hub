const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfirmNotifications, notificationText } = require('./confirm-notifications.cjs');
const bet = { betId: 'HAN187', game: 'Hanwha Life Esports vs Bilibili Gaming', team: 'Hanwha Life Esports', bet: 'Moneyline',
  risk: 500, odds: -110, partnerName: 'Trevor', bettorName: 'Luke', betDate: '2026-11-04', telegramBotId: '1', telegramChatId: '-5550868176', complete: true, grade: 'WIN', pl: 454.55 };

function fixture() {
  const jobs = {}, sent = [];
  let time = new Date('2026-11-04T22:00:00.000Z'), failure, acquired = 1, deleted = false;
  const db = {
    async execute(sql, p = []) {
      if (sql.includes('GET_LOCK')) return [[{ acquired }]];
      if (sql.includes('RELEASE_LOCK')) return [[{}]];
      if (sql.startsWith('INSERT')) {
        const [id, bet_row_id, bet_revision, source_id, bot_id, chat_id, kind, payload, created_at, updated_at] = p;
        jobs[id] ||= { id, bet_row_id, bet_revision, source_id, bot_id, chat_id, kind, payload, created_at, updated_at, status: 'pending', attempts: 0, retry_at_ms: 0 };
      } else if (sql.startsWith('SELECT n.*')) return [Object.values(jobs).filter(job => job.status === 'pending' || job.status === 'error' && job.attempts < 3 && job.retry_at_ms <= p[0])
        .sort((a, b) => a.bet_revision - b.bet_revision).map(job => ({ ...job, bet_payload: { deletedAt: deleted ? 'deleted' : null } }))];
      else if (sql.startsWith('SELECT COUNT')) return [[{ n: Object.values(jobs).filter(job => job.bet_row_id === p[0] && job.bet_revision < p[1]
        && (['pending', 'sending'].includes(job.status) || job.status === 'error' && job.attempts < 3)).length }]];
      else if (sql.includes("status = 'uncertain'")) {
        for (const job of Object.values(jobs)) if (job.status === 'sending') Object.assign(job, { status: 'uncertain', last_error: p[0] });
      } else if (sql.includes("status = 'cancelled'")) jobs[p[1]].status = 'cancelled';
      else if (sql.includes("status = 'sending'")) Object.assign(jobs[p[1]], { status: 'sending', attempts: jobs[p[1]].attempts + 1 });
      else if (sql.includes("status = 'sent'")) Object.assign(jobs[p[2]], { status: 'sent', telegram_message_id: p[0] });
      else if (sql.includes('status = ?')) Object.assign(jobs[p[4]], { status: p[0], last_error: p[1], retry_at_ms: p[2] });
      else throw new Error(`Unexpected SQL: ${sql}`);
      return [{ affectedRows: 1 }];
    }, release() {}, destroy() {},
  };
  const pool = { async getConnection() { return db; } };
  const telegramService = { async sendMessage(input) { sent.push(input); if (failure) throw failure; return { message: { messageId: sent.length } }; } };
  const make = () => createConfirmNotifications({ telegramService, now: () => time, logger: { error() {} } });
  return { db, pool, jobs, sent, make, notifications: make(), advance() { time = new Date(time.getTime() + 60001); },
    fail(error) { failure = error; }, lock(value) { acquired = value; }, deleteBet() { deleted = true; } };
}

test('receipts contain complete log details and net results for every grade', () => {
  assert.equal(notificationText('logged', { ...bet, partnerName: 'trevor_partner', risk: 100 }),
    "trevor_partner's HAN187 bet on Hanwha Life Esports Moneyline (Hanwha Life Esports vs Bilibili Gaming, 2026-11-04 ET), risking $100.00 at -110, was logged.");
  assert.doesNotMatch(notificationText('logged', bet), /\n|Bettor|Luke/);
  assert.match(notificationText('grade', bet), /was graded WIN with net P\/L of \+\$454.55\./);
  assert.doesNotMatch(notificationText('grade', bet), /\n|Bettor|Luke/);
  for (const [grade, pl, text] of [['LOSS', -500, '-$500.00'], ['VOID', 0, '$0.00'], ['PARTRETURN', -25, '-$25.00']]) {
    assert.ok(notificationText('grade', { ...bet, grade, pl }).includes(`was graded ${grade} with net P/L of ${text}.`));
  }
  assert.match(notificationText('grade', { ...bet, grade: 'UNGRADED', pl: null }), /is now ungraded with net P\/L pending\./);
  assert.equal(notificationText('grade', { ...bet, betId: 'GEN336', game: 'Gen.G vs LYON', team: 'Gen.G', bet: 'Map 1', risk: 250, odds: 100, partnerName: 'trevor_partner', grade: 'VOID', pl: 0 }),
    "trevor_partner's GEN336 bet on Gen.G Map 1 (Gen.G vs LYON, 2026-11-04 ET), risking $250.00 at +100, was graded VOID with net P/L of $0.00.");
  assert.match(notificationText('logged', { ...bet, complete: false, risk: null, odds: null }), /Not provided/);
  assert.match(notificationText('logged', { ...bet, complete: false }), /some details need review in Confirms/);
  assert.match(notificationText('delete', bet), /Trevor's HAN187 bet on .*was deleted from the bet log\./);
  assert.doesNotMatch(notificationText('delete', bet), /\n|Bettor|Luke|graded/);
});

test('one receipt per saved revision sends to the original bot/chat and survives restart without resending', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 2, 'grade', bet);
  assert.equal(Object.keys(f.jobs).length, 2);
  await f.notifications.flush(f.pool);
  await f.make().flush(f.pool);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].chatId, '-5550868176');
  assert.equal(f.sent[0].expectedBotId, '1');
  assert.match(f.sent[0].text, /was logged\./);
  assert.match(f.sent[1].text, /was graded WIN/);
  assert.ok(Object.values(f.jobs).every(job => job.status === 'sent'));
});

test('confirmed rejections back off and retry, while timeouts and interrupted sends never resend automatically', async () => {
  const f = fixture();
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  f.fail(Object.assign(new Error('Bot cannot access chat.'), { telegramSafe: true }));
  await f.notifications.flush(f.pool);
  await f.notifications.flush(f.pool);
  assert.equal(f.sent.length, 1);
  f.advance(); f.fail(null);
  await f.make().flush(f.pool);
  assert.equal(f.sent.length, 2);
  assert.equal(Object.values(f.jobs)[0].status, 'sent');

  await f.notifications.enqueue(f.db, 'source', 'bet-1', 2, 'grade', bet);
  f.fail(Object.assign(new Error('Timeout'), { deliveryUncertain: true }));
  await f.notifications.flush(f.pool);
  f.advance(); await f.make().flush(f.pool);
  assert.equal(f.sent.length, 3);
  assert.equal(Object.values(f.jobs)[1].status, 'uncertain');
  await f.notifications.enqueue(f.db, 'source', 'bet-2', 1, 'logged', bet);
  Object.values(f.jobs).at(-1).status = 'sending';
  await f.make().flush(f.pool);
  assert.equal(Object.values(f.jobs).at(-1).status, 'uncertain');
  assert.equal(f.sent.length, 3);
});

test('deleted bets and competing workers do not send receipts', async () => {
  const f = fixture(); await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  f.lock(0); await f.notifications.flush(f.pool);
  assert.equal(f.sent.length, 0);
  f.lock(1); f.deleteBet(); await f.notifications.flush(f.pool);
  assert.equal(Object.values(f.jobs)[0].status, 'cancelled');
  assert.equal(f.sent.length, 0);
});

test('a deleted bet sends its deletion notice once while obsolete log/grade receipts are cancelled', async () => {
  const f = fixture();
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 2, 'grade', bet);
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 3, 'delete', bet);
  f.deleteBet();
  await f.notifications.flush(f.pool);
  await f.make().flush(f.pool);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].chatId, '-5550868176');
  assert.match(f.sent[0].text, /was deleted from the bet log\./);
  assert.deepEqual(Object.values(f.jobs).map(job => job.status), ['cancelled', 'cancelled', 'sent']);
});

test('cancelled receipts cannot be reclaimed from an earlier worker snapshot', async () => {
  const f = fixture();
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  const execute = f.db.execute.bind(f.db);
  f.db.execute = async (sql, params) => sql.includes("status = 'sending'") ? [{ affectedRows: 0 }] : execute(sql, params);
  await f.notifications.flush(f.pool);
  assert.equal(f.sent.length, 0);
});

test('retries stop after three confirmed failures and do not permanently block a later grade receipt', async () => {
  const f = fixture();
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 1, 'logged', bet);
  f.fail(Object.assign(new Error('Rejected'), { telegramSafe: true }));
  for (let i = 0; i < 4; i++) { await f.notifications.flush(f.pool); f.advance(); }
  assert.equal(f.sent.length, 3);
  assert.equal(Object.values(f.jobs)[0].attempts, 3);
  await f.notifications.enqueue(f.db, 'source', 'bet-1', 2, 'grade', bet);
  f.fail(null); await f.notifications.flush(f.pool);
  assert.equal(f.sent.length, 4);
  assert.match(f.sent[3].text, /was graded WIN/);
});
