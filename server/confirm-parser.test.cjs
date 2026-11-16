const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfirmParser, validateExtraction, defaultFields, partnerFor, eligibleContexts } = require('./confirm-parser.cjs');
const { normalizeFields, calculatePL } = require('../src/features/bets/confirmationFields');
const context = { game: { team_a: 'Hanwha Life Esports', team_b: 'Bilibili Gaming' }, markets: [{ id: 'a:ml', label: 'Hanwha Life Esports ML', playTo: '+150' }], recipients: [{ id: 'trevor', name: 'Trevor', telegramChannel: '-5550868176' }] };
const message = { botId: '1', chatId: '-5550868176', chat: 'trevor_partner', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], contexts: [{ betId: 'HAN187', context }] };
const extracted = { bets: [{ betId: 'HAN187', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110 }], issues: [] };
const response = result => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 100 } }) });

test('bot receipt messages cannot become new AI bets', () => {
  assert.deepEqual(eligibleContexts({ ...message, senderId: message.botId, text: 'BET LOGGED\nBet ID: HAN187' }), []);
});

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

test('manual send instructions provide selection context without supplying the actual risk or price', async () => {
  const manualText = 'Chiefs -3.5 vs Broncos. Play to -110.';
  const reply = { ...message, text: 'CHI145 $250 -105', betIds: ['CHI145'], contexts: [{ betId: 'CHI145',
    context: { manualText, game: { sport: 'other' }, markets: [], recipients: context.recipients } }] };
  const calls = [];
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async (_url, input) => {
    calls.push(JSON.parse(input.body));
    return response({ bets: [{ betId: 'CHI145', game: 'Chiefs vs Broncos', team: 'Chiefs', bet: 'Chiefs -3.5', risk: 250, odds: -105 }], issues: [] });
  } });
  const [bet] = (await parser.parse(reply)).bets;
  assert.deepEqual(JSON.parse(calls[0].messages.at(-1).content), { reply: reply.text, sends: [{ betId: 'CHI145', manualText }] });
  assert.deepEqual(bet, normalizeFields({ betId: 'CHI145', game: 'Chiefs vs Broncos', team: 'Chiefs', bet: 'Chiefs -3.5', risk: 250, odds: -105 }));
  assert.equal(bet.complete, true);
  assert.deepEqual(defaultFields(reply), { betId: 'CHI145', game: manualText, team: 'Match', bet: manualText,
    risk: null, odds: null, grade: 'UNGRADED', partialReturn: null });
  await assert.rejects(parser.parse({ ...reply, chatId: '-999' }), /send context is unavailable/);
});

test('assigns Total Goals to hockey game totals and keeps the team on team totals', () => {
  const hockey = { ...message, text: 'TEX137 Total goals o5.5 $960 -120', betIds: ['TEX137'],
    contexts: [{ betId: 'TEX137', context: { ...context, game: { sport: 'hockey', team_a: 'Texas Stars', team_b: 'Manitoba Moose' } } }] };
  const fill = { betId: 'TEX137', risk: 960, odds: -120 };
  const { bets } = validateExtraction({ bets: [
    { ...fill, team: null, bet: 'Total goals over 5.5' },
    { ...fill, team: 'Texas Stars', bet: 'u6.5' },
    { ...fill, team: 'Total Goals', bet: 'Game total under 6.5' },
    { ...fill, team: 'Texas Stars', bet: 'Team total goals over 2.5' },
  ], issues: [] }, hockey);
  assert.deepEqual(bets.map(bet => bet.team), ['Total Goals', 'Total Goals', 'Total Goals', 'Texas Stars']);
  assert.ok(bets.every(bet => bet.complete));
});

test('accepts positive odds in a multi-bet Telegram reply even if the model omits JSON quotes', async () => {
  const harvard = { ...message, text: 'HAR561 Harvard +2.5 $670 -127.2 Harvard ML $500 +366.7', betIds: ['HAR561'],
    contexts: [{ betId: 'HAR561', context: { ...context, game: { team_a: 'Boston Univ.', team_b: 'Harvard Univ.' },
      markets: [{ id: 'b:spread', label: 'Harvard +2.5', line: 2.5 }, { id: 'b:ml', label: 'Harvard ML' }] } }] };
  const selection = { betId: 'HAR561', team: 'Harvard Univ.' };
  const bets = [{ ...selection, bet: 'Spread +2.5', risk: 670, odds: -127.2 }, { ...selection, bet: 'Moneyline', risk: 500, odds: '+366.7' }];
  const issues = ['Preserve quoted text such as "odds":+366.7, as written.'];
  const json = JSON.stringify({ bets, issues });
  for (const content of [json, json.replace('"odds":"+366.7"', '"odds": +366.7')]) {
    const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async () => ({
      ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
    }) });
    const result = await parser.parse(harvard);
    assert.deepEqual(result.bets.map(({ bet, risk, odds }) => ({ bet, risk, odds })), [
      { bet: 'Spread +2.5', risk: 670, odds: -127 }, { bet: 'Moneyline', risk: 500, odds: 367 },
    ]);
    assert.deepEqual(result.issues, issues);
  }
});

test('keeps Harvard +2.5 as a spread selection and reads price and risk separately', async () => {
  const harvard = { ...message, betIds: ['HAR561'], contexts: [{ betId: 'HAR561', context: { ...context,
    game: { sport: 'hockey', team_a: 'Boston Univ.', team_b: 'Harvard Univ.' },
    markets: [{ id: 'b:handicap:2.5', label: 'Harvard +2.5 goals', line: 2.5, playTo: '-110' }],
  } }] };
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async () => {
    assert.fail('A standalone team and spread can be read directly');
  } });
  for (const terms of ['-127.2 $670', '$670 -127.2']) {
    const result = await parser.parse({ ...harvard, text: `HAR561\nHarvard +2.5 ${terms}` });
    assert.deepEqual(result.bets.map(({ betId, team, bet, risk, odds, complete }) => ({ betId, team, bet, risk, odds, complete })), [
      { betId: 'HAR561', team: 'Harvard Univ.', bet: 'Harvard +2.5', risk: 670, odds: -127, complete: true },
    ]);
    assert.deepEqual(result.issues, []);
  }
  const partial = await parser.parse({ ...harvard, text: 'HAR561 Harvard +2.5' });
  const [bet] = partial.bets;
  assert.equal(bet.bet, 'Harvard +2.5');
  assert.equal(bet.odds, null);
  assert.equal(bet.risk, null);
  assert.equal(bet.complete, false);
  assert.deepEqual(partial.issues, ['The reply is missing risk and odds.']);
});

test('keeps every named parlay leg in one Bet description and the combined price in Odds', async () => {
  const parlay = { ...message, text: 'HAR561 harvard and chiefs parlay 350 $2', betIds: ['HAR561'],
    contexts: [{ betId: 'HAR561', context: { ...context, game: { team_a: 'Boston Univ.', team_b: 'Harvard Univ.' } } }] };
  const calls = [];
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async (url, input) => {
    calls.push(JSON.parse(input.body));
    return response({ bets: [{ betId: 'HAR561', team: 'Harvard Univ.', bet: 'Parlay (350)', risk: 2, odds: null }], issues: [] });
  } });

  const result = await parser.parse(parlay);
  assert.deepEqual(result.bets.map(({ betId, team, bet, risk, odds, complete }) => ({ betId, team, bet, risk, odds, complete })), [
    { betId: 'HAR561', team: 'Harvard Univ.', bet: 'Parlay: harvard and chiefs', risk: 2, odds: 350, complete: true },
  ]);
  assert.match(calls[0].messages[0].content, /every reported selection, including teams from other games/);
  assert.match(calls[0].messages[0].content, /"bet":"Parlay: Harvard and Chiefs","risk":2,"odds":350/);

  const detailed = { ...result.bets[0], bet: 'Parlay: Harvard +2.5' };
  const detailedReply = { ...parlay, text: 'HAR561 Harvard +2.5 and Chiefs ML parlay -125 $2' };
  const [detailedBet] = validateExtraction({ bets: [detailed], issues: [] }, detailedReply).bets;
  assert.equal(detailedBet.bet, 'Parlay: Harvard +2.5 and Chiefs ML');
  assert.equal(detailedBet.odds, -125);
});

test('raw parlay reply overrides a straight handicap or separately extracted legs and keeps the combined stake and odds', () => {
  const reply = { ...message, text: 'HAR561 Harvard +2.5 and Chiefs ML parlay +300 $2,500.00', betIds: ['HAR561'],
    contexts: [{ betId: 'HAR561', context: { ...context, game: { team_a: 'Boston Univ.', team_b: 'Harvard Univ.' },
      markets: [{ id: 'b:spread', label: 'Harvard +2.5' }, { id: 'b:ml', label: 'Harvard ML' }] } }] };
  const handicap = { betId: 'HAR561', team: 'Harvard Univ.', bet: 'Handicap +2.5', risk: 2500, odds: 300 };
  for (const bets of [[handicap], [handicap, { ...handicap, bet: 'Chiefs Moneyline', risk: 2, odds: -110 }], []]) {
    const result = validateExtraction({ bets, issues: [] }, reply);
    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].bet, 'Parlay: Harvard +2.5 and Chiefs ML');
    assert.equal(result.bets[0].team, 'Harvard Univ.');
    assert.equal(result.bets[0].risk, 2500);
    assert.equal(result.bets[0].odds, 300);
    assert.equal(result.bets[0].complete, true);
  }
  assert.throws(() => validateExtraction({ bets: [handicap], issues: [] }, { ...reply,
    text: 'HAR561 $2500 at +300 parlay Harvard +2.5 and Chiefs ML' }), /parlay.*manually/);
});

test('keeps extra parlay legs from before or after the combined terms in one Bet field', () => {
  const fill = { ...extracted.bets[0], odds: 470, risk: 3000 };
  const result = { bets: [fill], issues: [] };
  for (const text of [
    'HAN187 Moneyline +470 $3,000\nParlay with Boston College Moneyline x Niagara -1.5',
    'HAN187 Moneyline $3,000 +470 parlay with Boston College Moneyline\nx Niagara -1.5',
    'HAN187 Moneyline parlay with Boston College Moneyline x Niagara -1.5 $3,000 +470',
  ]) {
    const { bets } = validateExtraction(result, { ...message, text });
    assert.equal(bets.length, 1);
    assert.equal(bets[0].bet, 'Parlay: Hanwha Life Esports Moneyline x Boston College Moneyline x Niagara -1.5');
    assert.equal(bets[0].risk, 3000);
    assert.equal(bets[0].odds, 470);
  }
  assert.throws(() => validateExtraction(result, {
    ...message, text: 'HAN187 Moneyline +470 $3,000 parlay with Boston College Moneyline +120 $500',
  }), /parlay.*manually/);
});

test('parses the Niagara reply as one cross-game parlay with its linked team, combined price, and stake', async () => {
  const reply = { ...message, text: 'NIA735\nNiagara -1.5 x Boston College Moneyline +470 $3000', betIds: ['NIA735'],
    contexts: [{ betId: 'NIA735', context: { ...context,
      game: { sport: 'hockey', team_a: 'Niagara Univ.', team_b: 'Army' },
      markets: [{ id: 'a:spread', label: 'Niagara -1.5' }, { id: 'b:ml', label: 'Army ML' }],
    } }] };
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async () => {
    assert.fail('A complete shorthand parlay should be read directly from the reply');
  } });
  const result = await parser.parse(reply);
  assert.deepEqual(result.bets.map(({ betId, team, bet, risk, odds, complete }) => ({ betId, team, bet, risk, odds, complete })), [
    { betId: 'NIA735', team: 'Niagara Univ.', bet: 'Parlay: Niagara -1.5 x Boston College Moneyline', risk: 3000, odds: 470, complete: true },
  ]);
  assert.deepEqual(result.issues, []);
  for (const separator of ['X', '×']) {
    const [bet] = (await parser.parse({ ...reply,
      text: `NIA735 Niagara -1.5 ${separator} Boston College ML +470.5 $3,000.00`,
    })).bets;
    assert.equal(bet.bet, `Parlay: Niagara -1.5 ${separator} Boston College ML`);
    assert.equal(bet.odds, 471);
    assert.equal(bet.risk, 3000);
  }
  await assert.rejects(parser.parse({ ...reply, chatId: '-999' }), /send context is unavailable/);

  const wrongTeam = { bets: [{ betId: 'NIA735', team: 'Boston College', bet: 'Moneyline', risk: 3000, odds: 470 }], issues: [] };
  assert.deepEqual(validateExtraction(wrongTeam, reply).bets, result.bets);
  assert.throws(() => validateExtraction(wrongTeam, {
    ...reply, text: 'NIA735 Niagara ML +150.5 x Boston College ML +470 $3000',
  }), /could not reliably match the team/);
});

test('sends an image with a bet-ID-only caption as multimodal input, including prediction-market guidance', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const photoMessage = { ...message, text: 'HAN187', hasMedia: true };
  const calls = [];
  let readMessage;
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' },
    readImages: async input => { readMessage = input; return [image]; },
    fetchImpl: async (url, input) => { calls.push(JSON.parse(input.body)); return response({
      bets: [{ ...extracted.bets[0], risk: 0.99, odds: -1238 }], issues: ['Effective odds include $0.01 fees.'],
    }); },
  });
  const result = await parser.parse(photoMessage);
  assert.equal(readMessage, photoMessage);
  assert.equal(result.bets[0].risk, 0.99);
  assert.equal(result.bets[0].odds, -1238);
  assert.equal(result.bets[0].grade, 'UNGRADED');
  assert.equal(result.bets[0].pl, null);
  assert.equal(result.issues.length, 1);
  assert.equal(result.model, 'mistral-3-14B');
  const content = calls[0].messages.at(-1).content;
  assert.equal(JSON.parse(content[0].text).reply, 'HAN187');
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: image } });
  assert.match(calls[0].messages[1].content, /Cost plus separately charged Fees/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /api.telegram.org|test-secret|5550868176/);
});

test('supports image-only replies with linked send context and an optional vision model override', async () => {
  const bodies = [];
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret', DO_INFERENCE_MODEL: 'custom-text', DO_INFERENCE_VISION_MODEL: 'custom-vision' },
    readImages: async () => ['data:image/jpeg;base64,/9j/'],
    fetchImpl: async (url, input) => { bodies.push(JSON.parse(input.body)); return response(extracted); },
  });
  assert.equal((await parser.parse({ ...message, text: '', hasMedia: true })).model, 'custom-vision');
  assert.equal((await parser.parse(message)).model, 'custom-text');
  assert.ok(Array.isArray(bodies[0].messages.at(-1).content));
  assert.equal(typeof bodies[1].messages.at(-1).content, 'string');
});

test('does not silently parse just the caption if an attachment cannot be read; retries sanitized download failures', async () => {
  let calls = 0;
  const photoMessage = { ...message, text: 'HAN187', hasMedia: true };
  const parser = options => createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, fetchImpl: async () => { calls++; }, ...options });
  assert.match((await parser({ readImages: async () => [] }).parse(photoMessage)).issues[0], /attachment cannot be read/);
  await assert.rejects(parser({}).parse(photoMessage), /image retrieval/);
  await assert.rejects(parser({ readImages: async () => { throw new Error('secret-token-url'); } }).parse(photoMessage), error => error.confirmSafe && error.retryable && !error.message.includes('secret-token'));
  await assert.rejects(parser({ readImages: async () => { throw Object.assign(new Error('The screenshot exceeds 10 MB.'), { telegramSafe: true, status: 413 }); } }).parse(photoMessage), error => error.confirmSafe && !error.retryable && /10 MB/.test(error.message));
  assert.equal(calls, 0);
});

test('explains image incompatibility when the inference provider rejects multimodal input', async () => {
  const parser = createConfirmParser({ env: { DO_INFERENCE_API_KEY: 'test-secret' }, readImages: async () => ['data:image/png;base64,iVBORw0KGgo='],
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'secret provider body' }) }),
  });
  await assert.rejects(parser.parse({ ...message, hasMedia: true }), error => error.confirmSafe && !error.retryable && /DO_INFERENCE_VISION_MODEL/.test(error.message) && !error.message.includes('secret provider'));
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
  const rounded = normalizeFields({ ...base, odds: '-127.5', grade: 'WIN' });
  assert.equal(rounded.odds, -128);
  assert.equal(rounded.pl, 390.63);
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
