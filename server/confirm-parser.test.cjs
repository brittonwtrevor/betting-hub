const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfirmParser, validateExtraction, defaultFields, partnerFor, eligibleContexts } = require('./confirm-parser.cjs');
const { normalizeFields, calculatePL } = require('../src/features/bets/confirmationFields');
const context = { game: { team_a: 'Hanwha Life Esports', team_b: 'Bilibili Gaming' }, markets: [{ id: 'a:ml', label: 'Hanwha Life Esports ML', playTo: '+150' }], recipients: [{ id: 'trevor', name: 'Trevor', telegramChannel: '-5550868176' }] };
const message = { botId: '1', chatId: '-5550868176', chat: 'trevor_partner', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], contexts: [{ betId: 'HAN187', context }] };
const extracted = { bets: [{ betId: 'HAN187', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110 }], issues: [] };
const response = result => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 100 } }) });

test('uses the inexpensive DigitalOcean model and sends only reply plus compact context, never bot credentials or partner metadata', async () => {
  const calls = [];
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async (url, input) => { calls.push({ url, input }); return response(extracted); } });
  const result = await parser.parse(message);
  assert.equal(result.bets[0].game, 'Hanwha Life Esports vs Bilibili Gaming');
  assert.equal(result.bets[0].risk, 1);
  assert.equal(result.bets[0].odds, -110);
  assert.equal(result.bets[0].grade, 'UNGRADED');
  assert.equal(result.bets[0].pl, null);
  assert.equal(result.model, 'mistral-3-14B');
  assert.deepEqual(result.usage, { inputTokens: 500, outputTokens: 100 });
  assert.equal(calls[0].url, 'https://inference.do-ai.run/v1/chat/completions');
  assert.equal(calls[0].input.headers.Authorization, 'Bearer test-secret');
  const body = JSON.parse(calls[0].input.body);
  assert.equal(body.temperature, 0);
  assert.doesNotMatch(calls[0].input.body, /test-secret|5550868176|trevor_partner|recipients|playTo/);
});

test('supports multiple fills and leaves ambiguous values blank for review', () => {
  const result = validateExtraction({ bets: [extracted.bets[0], { ...extracted.bets[0], bet: 'Spread -1.5', risk: 200, odds: 150 }, { ...extracted.bets[0], risk: null, odds: null, team: null }], issues: ['Missing stake for third fill.'] }, message);
  assert.equal(result.bets.length, 3);
  assert.equal(result.bets[2].complete, false);
  assert.equal(result.bets[2].risk, null);
  assert.equal(result.bets[2].odds, null);
  for (const patch of [{ betId: 'BAD999' }, { team: 'Wrong team' }, { risk: -1 }, { odds: -50 }, { risk: 1.123 }]) {
    assert.throws(() => validateExtraction({ bets: [{ ...extracted.bets[0], ...patch }], issues: [] }, message), error => error.confirmSafe);
  }
  assert.equal(validateExtraction({ ...extracted, bets: [{ ...extracted.bets[0], grade: 'WIN', pl: 100000 }] }, message).bets[0].pl, null);
});

test('resolves partner context by numeric IDs, usernames, and delivered chat IDs without trusting display titles', () => {
  assert.equal(eligibleContexts(message).length, 1);
  assert.deepEqual(partnerFor(message, eligibleContexts(message)), { id: 'trevor', name: 'Trevor', chatId: '-5550868176' });
  assert.equal(defaultFields(message).team, 'Hanwha Life Esports');
  assert.equal(defaultFields({ ...message, contexts: [{ betId: 'HAN187', context: { ...context, markets: [{ id: 'match:maps:over', label: 'Total maps over' }] } }] }).team, 'Match');
  assert.equal(eligibleContexts({ ...message, chatId: '-999' }).length, 0);
  const renamed = { ...message, chatId: '-123', contexts: [{ betId: 'HAN187', context: { ...context, deliveries: [{ channel: '-5550868176', chatId: '-123' }] } }] };
  assert.equal(eligibleContexts(renamed).length, 1);
  assert.equal(partnerFor(renamed, eligibleContexts(renamed)).id, 'trevor');
});

test('rejects missing keys, malformed or truncated model responses and sanitizes provider/network failures', async () => {
  let calls = 0;
  await assert.rejects(createConfirmParser({ env: {}, fetchImpl: async () => { calls++; } }).parse(message), /model access key/);
  assert.equal(calls, 0);
  for (const fetchImpl of [
    async () => { throw new Error('Authorization: test-secret private-host'); },
    async () => ({ ok: false, status: 401, json: async () => ({ message: 'test-secret' }) }),
    async () => ({ ok: false, status: 429, json: async () => ({ message: 'test-secret' }) }),
    async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }),
    async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] }) }),
  ]) {
    const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl });
    await assert.rejects(parser.parse(message), error => error.confirmSafe && !/test-secret|private-host/.test(error.message));
  }
});

test('grades American odds with net profit and cent rounding, including signed PARTRETURN and zero', () => {
  const base = { betId: 'HAN187', game: 'HLE vs BLG', team: 'HLE', bet: 'ML', risk: 500, odds: -110 };
  assert.equal(normalizeFields({ ...base, grade: 'WIN' }).pl, 454.55);
  assert.equal(normalizeFields({ ...base, odds: 150, grade: 'WIN' }).pl, 750);
  assert.equal(normalizeFields({ ...base, risk: 1, grade: 'WIN' }).pl, 0.91);
  assert.equal(normalizeFields({ ...base, grade: 'LOSS' }).pl, -500);
  assert.equal(normalizeFields({ ...base, grade: 'VOID' }).pl, 0);
  for (const value of ['+50', '-25.35', '0']) assert.equal(normalizeFields({ ...base, grade: 'PARTRETURN', partialReturn: value }).pl, Number(value));
  assert.equal(normalizeFields({ ...base, grade: 'UNGRADED' }).pl, null);
  assert.equal(calculatePL({ ...base, grade: 'WIN', risk: '' }), null);
  assert.equal(normalizeFields({ ...base, risk: '', odds: '', team: '', grade: 'UNGRADED' }).complete, false);
  for (const patch of [{ risk: 0 }, { risk: -10 }, { risk: '1e3' }, { risk: '1.001' }, { odds: 0 }, { odds: -50 }, { grade: 'PUSH' }, { grade: 'WIN', team: '' }, { grade: 'PARTRETURN', partialReturn: '' }]) {
    assert.throws(() => normalizeFields({ ...base, ...patch }), error => error.status === 400);
  }
});
