// Shared by the browser and draft API so market IDs and validation stay consistent.
function oppositeOdds(odds) {
  return Number.isFinite(odds) && odds !== 0 ? Math.abs(odds) === 100 ? 100 : -odds : null;
}
const hockeyTotalLines = Array.from({ length: 9 }, (_, index) => 4 + index / 2);
function probabilityOdds(value) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return null;
  return Math.round(value >= 0.5 ? -100 * value / (1 - value) : 100 * (1 - value) / value);
}
function hockeyMarketGroups(game) {
  const groups = ['a', 'b'].map(side => {
    const home = side === 'a';
    const team = game[`team_${side}`];
    const markets = [{ id: `${side}:ml`, label: `${team} ML (${home ? 'Home' : 'Away'}, incl OT/SO)`, fair: game[home ? 'winoddsfulltime' : 'away_winoddsfulltime'] ?? null, available: true }];
    for (const line of [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]) {
      markets.push({ id: `${side}:handicap:${line}`, label: `${team} ${line > 0 ? '+' : ''}${line} goals (incl OT/SO)`, line: String(line), available: true });
    }
    return { id: side, label: `${home ? 'Home' : 'Away'} team · ${team}`, markets };
  });
  for (const period of ['full', 'reg']) {
    const scope = period === 'full' ? 'incl OT/SO' : 'regulation only';
    const markets = [];
    for (const direction of ['over', 'under']) for (const line of hockeyTotalLines) {
      // Only use model prices published for this exact period, line, and direction.
      const fair = game[`${period === 'full' ? 'full_game' : 'reg_time'}_${direction[0]}${line}`];
      markets.push({ id: `match:goals:${period}:${direction}:${line}`, label: `Total goals ${direction} ${line} (${scope})`, line: String(line), fair: Number.isFinite(fair) ? fair : null, available: true });
    }
    groups.push({ id: `totals:${period}`, label: `Goal totals · ${scope}`, markets });
  }
  groups.push({ id: '1x2', label: '1X2 · regulation only', markets: [
    { id: 'a:1x2', label: `${game.team_a} win (1X2, regulation only)`, fair: probabilityOdds(game.reg_time_home_win_prob), available: true },
    { id: 'match:1x2:draw', label: 'Draw (1X2, regulation only)', fair: probabilityOdds(game.reg_time_draw_prob), available: true },
    { id: 'b:1x2', label: `${game.team_b} win (1X2, regulation only)`, fair: probabilityOdds(game.reg_time_away_win_prob), available: true },
  ] });
  const home = game.reg_time_home_win_prob, away = game.reg_time_away_win_prob;
  const resolved = Number.isFinite(home) && Number.isFinite(away) && home >= 0 && away >= 0 && home + away > 0 && home + away <= 1;
  groups.push({ id: 'reg:ml', label: 'Moneyline · regulation only (draw = void)', markets: ['a', 'b'].map(side => ({
    id: `${side}:ml:reg`, label: `${game[`team_${side}`]} ML (regulation only, draw = void)`, fair: resolved ? probabilityOdds((side === 'a' ? home : away) / (home + away)) : null, available: true,
  })) });
  return groups;
}
function gameDescription(game, { includeGoalies = false } = {}) {
  if (game.sport !== 'hockey') return `League of Legends · ${game.league} · ${game.series_format || 'Format unknown'}`;
  const league = `Hockey · ${game.league}`;
  if (!includeGoalies) return league;
  return `${league} · Home goalie: ${game.goalie_team || 'Unknown'} · Away goalie: ${game.goalie_opp || 'Unknown'}`;
}
function marketGroups(game) {
  if (game.sport === 'hockey') return hockeyMarketGroups(game);
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
module.exports = { marketGroups, allMarkets, formatOdds, oppositeOdds, gameDescription };
