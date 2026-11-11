const grades = ['UNGRADED', 'VOID', 'WIN', 'LOSS', 'PARTRETURN'];
const totalGoalsTeam = 'Total Goals';
function confirmationTeam(team, bet, sport) {
  const market = bet?.trim() || '';
  const goalTotal = /^(?:(?:game|match)\s+)?(?:total goals|goals? totals?)(?=\s|:|$)/i.test(market);
  const hockeyTotal = sport === 'hockey' && /^(?:(?:(?:game|match)\s+)?total\s*:?\s*)?(?:over|under|[ou])\s*\d+(?:\.\d+)?(?:\s+goals)?(?:\s+\([^)]*\))?$/i.test(market);
  return goalTotal || hockeyTotal ? totalGoalsTeam : team;
}

const invalid = message => Object.assign(new Error(message), { status: 400, confirmSafe: true });
function amount(value, signed = false) {
  if (value == null || value === '') return null;
  const pattern = signed ? /^[+-]?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(String(value)) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 10000000) throw invalid('Enter a dollar amount with at most two decimal places (maximum $10,000,000).');
  return Math.round(Number(value) * 100) / 100;
}
function normalizeFields(input, sport) {
  if (!input || typeof input !== 'object') throw invalid('Enter the bet details.');
  const result = {};
  for (const [key, max] of [['betId', 6], ['game', 400], ['team', 200], ['bet', 300]]) {
    if (typeof input[key] !== 'string' || input[key].trim().length > max) throw invalid(`Enter a valid ${key}.`);
    result[key] = input[key].trim();
  }
  result.betId = result.betId.toUpperCase();
  if (!/^[A-Z]{3}\d{3}$/.test(result.betId)) throw invalid('Enter a six-character Bet ID such as HAN187.');
  result.team = confirmationTeam(result.team, result.bet, sport);
  result.risk = amount(input.risk);
  if (result.risk !== null && result.risk <= 0) throw invalid('Risk must be greater than zero.');
  result.odds = input.odds == null || input.odds === '' ? null : Number(input.odds);
  if (result.odds !== null && (!/^[+-]?\d+$/.test(String(input.odds)) || !Number.isSafeInteger(result.odds) || Math.abs(result.odds) < 100 || Math.abs(result.odds) > 1000000)) throw invalid('Enter American odds of +100 or greater, or -100 or lower.');
  result.grade = input.grade || 'UNGRADED';
  if (!grades.includes(result.grade)) throw invalid('Choose a valid grade.');
  result.partialReturn = result.grade === 'PARTRETURN' ? amount(input.partialReturn, true) : null;
  result.complete = !!(result.game && result.team && result.bet && result.risk !== null && result.odds !== null);
  if (result.grade !== 'UNGRADED' && !result.complete) throw invalid('Complete the game, team, bet, risk, and odds before grading.');
  if (result.grade === 'PARTRETURN' && result.partialReturn === null) throw invalid('Enter the signed net P/L for PARTRETURN.');
  result.pl = calculatePL(result);
  return result;
}
function calculatePL({ grade, risk, odds, partialReturn }) {
  if (!grades.includes(grade) || grade === 'UNGRADED') return null;
  if (grade === 'VOID') return 0;
  if (grade === 'PARTRETURN') return partialReturn == null || partialReturn === '' ? null : Number(partialReturn);
  if (risk == null || risk === '' || !Number.isFinite(Number(risk)) || Number(risk) <= 0) return null;
  const cents = Math.round(Number(risk) * 100);
  if (grade === 'LOSS') return -cents / 100;
  if (odds == null || odds === '' || !Number.isFinite(Number(odds)) || Math.abs(Number(odds)) < 100) return null;
  return Math.round(Number(odds) > 0 ? cents * Number(odds) / 100 : cents * 100 / Math.abs(Number(odds))) / 100;
}
module.exports = { grades, normalizeFields, calculatePL, confirmationTeam, totalGoalsTeam };
