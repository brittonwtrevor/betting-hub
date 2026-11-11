const { test } = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createConfirmsService, sourceId } = require('./confirms.cjs');
const { validateExtraction } = require('./confirm-parser.cjs');

// Optional real-MySQL regression, using an explicitly supplied local Unix socket.
// Creates and removes only its own isolated test database. No Telegram/AI calls.
test('MySQL upgrades existing fills and keeps typed reporting columns synchronized through edits, grades and deletion', {
  skip: !process.env.CONFIRMS_TEST_MYSQL_SOCKET,
}, async () => {
  const options = { socketPath: process.env.CONFIRMS_TEST_MYSQL_SOCKET, user: 'root' };
  const admin = await mysql.createConnection(options);
  const database = `betting_hub_confirms_test_${process.pid}`;
  let service, pool;
  try {
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    pool = mysql.createPool({ ...options, database });
    // Simulate the schema deployed before organized columns/attribution existed.
    await pool.query(`CREATE TABLE hub_confirm_bets (
      id VARCHAR(36) PRIMARY KEY, source_id CHAR(64) NOT NULL, revision INT NOT NULL DEFAULT 1,
      payload JSON NOT NULL, created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL)`);
    await pool.query(`CREATE TABLE hub_confirm_sources (
      id CHAR(64) PRIMARY KEY, bot_id BIGINT NOT NULL, chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL,
      update_id BIGINT NOT NULL, revision INT NOT NULL DEFAULT 1, status VARCHAR(16) NOT NULL, payload JSON NOT NULL,
      attempts INT NOT NULL DEFAULT 0, retry_at_ms BIGINT NOT NULL DEFAULT 0, lease_until_ms BIGINT NOT NULL DEFAULT 0,
      last_error TEXT NULL, created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL)`);
    await pool.query(`CREATE TABLE hub_telegram_inbox (bot_id BIGINT, update_id BIGINT, sender_id BIGINT, raw_update JSON, kind VARCHAR(64))`);
    const context = { game: { team_a: 'Boston', team_b: 'Toronto', begin_at: '2026-11-05 00:00:00', sport: 'lol', league: 'Test league', match_id: 'game-123' },
      markets: [{ id: 'a:ml', label: 'Boston ML' }], recipients: [{ id: 'partner-1', name: 'Trevor', telegramChannel: '-100123' }] };
    let message = { botId: '1', chatId: '-100123', chat: 'trevor_partner', messageId: 10, updateId: 42, from: 'trevor',
      receivedAt: '2026-11-05T01:01:00.000Z', date: '2026-11-05T01:00:00.000Z',
      text: 'BOS145 ML -110 $500', betIds: ['BOS145'], contexts: [{ betId: 'BOS145', context }] };
    const source = sourceId(message);
    const fields = validateExtraction({ bets: [{ betId: 'BOS145', team: 'Boston', bet: 'Moneyline', risk: 500, odds: -110 }], issues: [] }, message).bets[0];
    await pool.execute('INSERT INTO hub_confirm_sources (id, bot_id, chat_id, message_id, update_id, status, payload, created_at, updated_at) VALUES (?, 1, -100123, 10, 42, ?, ?, ?, ?)',
      [source, 'parsed', JSON.stringify({ message, partner: { id: 'partner-1', name: 'Trevor' }, issues: [] }), message.receivedAt, message.receivedAt]);
    await pool.execute('INSERT INTO hub_confirm_bets (id, source_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['legacy-bet', source, JSON.stringify(fields), message.receivedAt, message.receivedAt]);
    await pool.execute('INSERT INTO hub_telegram_inbox VALUES (1, 42, 123, ?, ?)',
      [JSON.stringify({ message: { from: { id: 123, first_name: 'Trevor', last_name: 'Britton', username: 'trevor' } } }), 'message']);
    let parseCalls = 0;
    const makeService = () => createConfirmsService({ createPool: () => pool,
      telegramReceiver: { async readInbox() { return { messages: [message], receiver: {} }; } },
      sendsService: { async findByBetIds() { return [{ betId: 'BOS145', context }]; } },
      parser: { configured: () => true, model: () => 'test', async parse() { parseCalls++; return { bets: [fields], issues: [] }; } },
    });
    service = makeService();
    let bet = (await service.list()).sources[0].bets[0];
    assert.equal(bet.bettorName, 'Trevor Britton');
    assert.equal(bet.telegramSenderId, '123');
    assert.equal(bet.betDate, '2026-11-04'); // Reply's Eastern date, not UTC date.
    assert.equal(bet.gameAt, '2026-11-05T00:00:00.000Z');
    assert.equal(bet.rawResponse, message.text);
    const [[upgraded]] = await pool.query('SELECT bet_id, risk, partner_id, telegram_sender_id, bet_date FROM hub_confirm_bets');
    assert.deepEqual({ ...upgraded }, { bet_id: 'BOS145', risk: '500.00', partner_id: 'partner-1', telegram_sender_id: '123', bet_date: '2026-11-04' });
    bet = await service.update(bet.id, { ...bet, bettorName: 'Luke', betDate: '2026-11-03', risk: 200, odds: 150, grade: 'WIN' });
    const [[graded]] = await pool.query('SELECT COUNT(*) AS rows_count, bettor_name, bet_date, risk, odds, grade, pl, graded_at FROM hub_confirm_bets GROUP BY id');
    assert.equal(graded.rows_count, 1);
    assert.equal(graded.bettor_name, 'Luke');
    assert.equal(graded.bet_date, '2026-11-03');
    assert.equal(graded.risk, '200.00');
    assert.equal(graded.pl, '300.00');
    assert.ok(graded.graded_at);
    const [report] = await service.listReportBets({ includeIncomplete: true });
    assert.equal(report.rawResponse, message.text);
    assert.equal(report.splitPercent, 100);
    const editedSplit = await service.updateSplit(bet.id, { revision: bet.revision, splitPercent: 50.25 });
    const [[savedSplit]] = await pool.query('SELECT split_bps FROM hub_confirm_bets');
    assert.equal(savedSplit.split_bps, 5025);
    assert.equal((await service.listReportBets())[0].yourShare, 150.75);
    bet = { ...bet, revision: editedSplit.revision };
    await service.remove(bet.id, bet, 'test-user');
    assert.equal((await service.list()).sources[0].bets.length, 0);
    const [[deleted]] = await pool.query('SELECT deleted_at, grade, pl, partner_id FROM hub_confirm_bets');
    assert.ok(deleted.deleted_at);
    assert.equal(deleted.pl, '300.00');
    assert.equal(deleted.partner_id, 'partner-1');
    const [[active]] = await pool.query('SELECT COUNT(*) AS n FROM hub_confirm_bets WHERE deleted_at IS NULL');
    assert.equal(active.n, 0);
    message = { ...message, updateId: 43, receivedAt: '2026-11-05T01:30:00.000Z' };
    await service.tick();
    assert.equal(parseCalls, 0);
    const [history] = await pool.query('SELECT action FROM hub_confirm_history ORDER BY id');
    assert.deepEqual(history.map(row => row.action), ['grade', 'split_edit', 'delete', 'telegram_edit']);
    // An independent startup must accept the already-upgraded schema unchanged.
    const restart = makeService();
    assert.equal((await restart.list()).sources[0].deletedBetCount, 1);
  } finally {
    if (service) await service.close(); else if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
});
