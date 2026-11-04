// Shared by the browser and draft API so market IDs and validation stay consistent.
function oppositeOdds(odds) {
  return Number.isFinite(odds) && odds !== 0 ? Math.abs(odds) === 100 ? 100 : -odds : null;
}
function marketGroups(game) {
  const bestOf = { BO1: 1, BO3: 3, BO5: 5 }[game.series_format];
  const seriesFair = { BO1: game.xgb_map1, BO3: game.bo3_price, BO5: game.bo5_price }[game.series_format];
  const groups = ['a', 'b'].map(side => {
    const team = game[`team_${side}`];
    const price = value => Number.isFinite(value) ? side === 'a' ? value : oppositeOdds(value) : null;
    const markets = [{ id: `${side}:ml`, label: `${team} ML`, fair: price(seriesFair), available: true }];
    for (let map = 1; map <= 5; map++) markets.push({ id: `${side}:map:${map}`, label: `${team} Map ${map}`, fair: map === 1 ? price(game.xgb_map1) : null, available: !bestOf || map <= bestOf });
    for (const direction of ['Over', 'Under']) for (let map = 1; map <= 5; map++) {
      markets.push({ id: `${side}:kills:${direction.toLowerCase()}:${map}`, label: `${team} kill total ${direction.toLowerCase()} · Map ${map}`, needsLine: true, available: !bestOf || map <= bestOf });
    }
    for (const line of [-1.5, -2.5, 1.5, 2.5]) markets.push({ id: `${side}:handicap:${line}`, label: `${team} ${line > 0 ? '+' : ''}${line} maps`, line: String(line), available: !bestOf || bestOf >= Math.abs(line) * 2 });
    return { id: side, label: `Team-specific · ${team}`, markets };
  });
  const markets = ['Over', 'Under'].map(direction => ({ id: `match:maps:${direction.toLowerCase()}`, label: `Total maps ${direction.toLowerCase()}`, needsLine: true, available: bestOf !== 1 }));
  for (const direction of ['Over', 'Under']) for (let map = 1; map <= 5; map++) {
    markets.push({ id: `match:kills:${direction.toLowerCase()}:${map}`, label: `Kill total ${direction.toLowerCase()} · Map ${map}`, needsLine: true, available: !bestOf || map <= bestOf });
  }
  return [...groups, { id: 'match', label: 'Match-specific', markets }];
}
function allMarkets(game) { return marketGroups(game).flatMap(group => group.markets); }
function formatOdds(value) { return Number.isFinite(value) ? value > 0 ? `+${value}` : String(value) : '—'; }
module.exports = { marketGroups, allMarkets, formatOdds, oppositeOdds };
