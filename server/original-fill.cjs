// The audit trail predates settlement. Read the earliest saved complete amount
// and price instead of allowing a void/resettlement to replace the risk basis.
function originalFill(current, history = []) {
  const valid = fields => fields && fields.betId === current.betId &&
    Number.isFinite(Number(fields.risk)) && Number(fields.risk) > 0 &&
    fields.odds != null && Number.isFinite(Number(fields.odds)) && Math.abs(Number(fields.odds)) >= 100;
  for (const entry of history) {
    const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
    for (const fields of [payload.before, payload.after]) {
      if (valid(fields)) return { originalStake: Number(fields.risk), originalOdds: Number(fields.odds), originalFromHistory: true };
    }
  }
  return { originalStake: valid(current) ? Number(current.risk) : null,
    originalOdds: valid(current) ? Number(current.odds) : null, originalFromHistory: false };
}

module.exports = { originalFill };
