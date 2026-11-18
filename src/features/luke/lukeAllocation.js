const { fullSplitBps, splitToBps, splitAmount } = require('../partners/split');
const settled = new Set(['WIN', 'LOSS', 'VOID', 'PARTRETURN']);
const cents = value => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100);
const numeric = value => value != null && value !== '' && Number.isFinite(Number(value));
const decimalOdds = value => numeric(value) && Math.abs(Number(value)) >= 100
  ? Number(value) > 0 ? 1 + Number(value) / 100 : 1 + 100 / Math.abs(Number(value)) : null;

function capToCents(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) ||
      Number(value) <= 0 || Number(value) > 10000000) return null;
  return cents(Number(value));
}

function lukeRows(bets, allocationPercent = 45, riskWinCap = 3000, betCaps = new Map()) {
  const bps = splitToBps(allocationPercent);
  if (bps == null) throw new Error('Enter an allocation from 0% to 100% with up to two decimal places.');
  const capCents = capToCents(riskWinCap);
  if (capCents == null) throw new Error('Enter a risk / to-win cap greater than $0, up to $10,000,000, with at most two decimal places.');
  const groups = new Map();
  for (const bet of bets) {
    if (bet.sport !== 'hockey' || !/^NCAA(?:$|[\s(./-])/i.test(bet.league || '') || !bet.betId) continue;
    if (splitToBps(bet.splitPercent) === 0) continue;
    if (!groups.has(bet.betId)) groups.set(bet.betId, []);
    groups.get(bet.betId).push(bet);
  }
  return [...groups].map(([betId, fills]) => {
    const betCapCents = betCaps.has(betId) ? capToCents(betCaps.get(betId)) : capCents;
    if (betCapCents == null) throw new Error('Enter a valid risk / to-win cap for this Bet ID.');
    let amountCents = 0, weightedOdds = 0, profitCents = 0, openCents = 0;
    let missingOriginal = 0, missingProfit = 0, openFills = 0, missingHistory = 0;
    for (const fill of fills) {
      const partnerSplit = splitToBps(fill.splitPercent) ?? fullSplitBps;
      const decimal = decimalOdds(fill.originalOdds);
      const valid = numeric(fill.originalStake) && Number(fill.originalStake) > 0 && decimal != null;
      const riskCents = valid ? cents(splitAmount(Number(fill.originalStake), partnerSplit)) : 0;
      if (!valid) missingOriginal++;
      if (!fill.originalFromHistory) missingHistory++;
      amountCents += riskCents;
      weightedOdds += riskCents * (decimal || 0);
      if (fill.status === 'UNGRADED') { openFills++; openCents += riskCents; }
      else if (!settled.has(fill.status) || !numeric(fill.settledProfit)) missingProfit++;
      else profitCents += cents(splitAmount(Number(fill.settledProfit), partnerSplit));
    }
    const totalAmount = !missingOriginal ? amountCents / 100 : null;
    const pregameOdds = totalAmount > 0 ? weightedOdds / amountCents : null;
    const cap = pregameOdds != null ? pregameOdds > 2 ? betCapCents / 100 : betCapCents / 100 / (pregameOdds - 1) : null;
    const risk = totalAmount == null ? null : totalAmount === 0 ? 0 : cents(Math.min(totalAmount * bps / 10000, cap)) / 100;
    const confirmsProfit = missingProfit ? null : profitCents / 100;
    const lukeProfit = risk == null || confirmsProfit == null ? null : totalAmount === 0 ? 0 : cents(risk * confirmsProfit / totalAmount) / 100;
    const dates = fills.map(fill => fill.betDate).filter(Boolean).sort();
    return {
      betId, event: [...new Set(fills.map(fill => fill.event).filter(Boolean))].join(' · '),
      selections: [...new Set(fills.map(fill => fill.selection).filter(Boolean))].join(' · '),
      firstFillDate: dates[0] || '', fills: fills.length, openFills,
      status: missingOriginal || missingProfit || missingHistory ? 'Needs review' : openFills === fills.length ? 'Open' : openFills ? 'Partially settled' : 'Settled',
      totalAmount, pregameOdds, allocationPercent: bps / 100, riskWinCap: betCapCents / 100, cap,
      lukeRisk: risk,
      openRisk: risk == null ? null : totalAmount === 0 ? 0 : cents(risk * openCents / amountCents) / 100,
      confirmsProfit, settledOdds: openFills || confirmsProfit == null || !(totalAmount > 0) ? null : 1 + confirmsProfit / totalAmount,
      lukeProfit, missingHistory,
    };
  }).sort((a, b) => b.firstFillDate.localeCompare(a.firstFillDate) || a.betId.localeCompare(b.betId));
}

module.exports = { lukeRows, decimalOdds, capToCents };
