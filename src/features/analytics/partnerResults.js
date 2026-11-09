import { calculatePL, grades } from '../bets/confirmationFields';

const easternDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const settledGrades = grades.filter(grade => grade !== 'UNGRADED');

function dateInEastern(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const parts = Object.fromEntries(easternDate.formatToParts(time).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function periodBounds(period, now = new Date()) {
  const today = dateInEastern(now);
  const start = new Date(`${today}T00:00:00Z`);
  const through = new Date(start);
  switch (period) {
    case 'week':
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      break;
    case 'last-week': {
      const monday = start.getUTCDate() - (start.getUTCDay() + 6) % 7;
      start.setUTCDate(monday - 7);
      through.setUTCDate(monday - 1);
      break;
    }
    case 'month':
      start.setUTCDate(1);
      break;
    case 'year':
      start.setUTCMonth(0, 1);
      break;
    default:
      return null;
  }
  return [start.toISOString().slice(0, 10), through.toISOString().slice(0, 10)];
}

export function reportBets(bets, partners, basis) {
  const registry = new Map(partners.flatMap(partner =>
    [partner.id, ...(partner.legacyIds || [])].map(id => [id, partner])
  ));
  return bets.filter(bet => Number.isFinite(bet.stake) && bet.stake > 0 &&
    (bet.status === 'UNGRADED' || settledGrades.includes(bet.status))
  ).map(bet => {
    const partner = registry.get(bet.partnerId);
    const open = bet.status === 'UNGRADED';
    const placedOn = bet.betDate || dateInEastern(bet.placedAt);
    return {
      ...bet,
      partnerId: partner?.id || bet.partnerId || '',
      partnerName: partner?.name || bet.partnerName || 'Unknown partner',
      sport: bet.sport || '',
      league: bet.league || '',
      reportDate: open || basis === 'placed' ? placedOn : dateInEastern(bet.gradedAt),
      open,
    };
  });
}

export function summarize(bets) {
  const outcomes = { WIN: 0, LOSS: 0, VOID: 0, PARTRETURN: 0 };
  let riskCents = 0;
  let roiRiskCents = 0;
  let netCents = 0;
  let potentialCents = 0;
  let missingProfit = 0;
  for (const bet of bets) {
    const stakeCents = Math.round(bet.stake * 100);
    riskCents += stakeCents;
    if (bet.open) {
      const toWin = calculatePL({ grade: 'WIN', risk: bet.stake, odds: bet.odds });
      if (Number.isFinite(toWin)) potentialCents += Math.round(toWin * 100);
      else missingProfit++;
      continue;
    }
    outcomes[bet.status]++;
    if (bet.status !== 'VOID') roiRiskCents += stakeCents;
    const profit = bet.settledProfit ?? calculatePL({
      grade: bet.status, risk: bet.stake, odds: bet.odds, partialReturn: bet.partialReturn,
    });
    if (Number.isFinite(profit)) netCents += Math.round(profit * 100);
    else missingProfit++;
  }
  const decisions = outcomes.WIN + outcomes.LOSS;
  return {
    count: bets.length, risk: riskCents / 100, outcomes,
    profit: missingProfit ? null : netCents / 100,
    potential: missingProfit ? null : potentialCents / 100,
    roi: roiRiskCents && !missingProfit ? netCents / roiRiskCents : null,
    winRate: decisions ? outcomes.WIN / decisions : null,
  };
}
