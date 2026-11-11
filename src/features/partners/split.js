const fullSplitBps = 10000;
const splitError = 'Enter a split from 0% to 100% with up to two decimal places.';

function splitToBps(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const percent = String(value).trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(percent) || Number(percent) > 100) return null;
  return Math.round(Number(percent) * 100);
}

function splitAmount(amount, bps) {
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(Math.abs(amount) * 100);
  // Multiply in two parts to keep even large payouts within safe integer precision.
  const whole = Math.floor(cents / fullSplitBps) * bps;
  const remainder = Math.round((cents % fullSplitBps) * bps / fullSplitBps);
  const share = whole + remainder;
  return share === 0 ? 0 : Math.sign(amount) * share / 100;
}

module.exports = { fullSplitBps, splitError, splitToBps, splitAmount };
