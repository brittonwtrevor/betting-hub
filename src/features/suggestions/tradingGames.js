import { formatOdds, seriesMoneyline } from '../bets/markets';
import { hockeySendGame } from '../sports/hockey/futureGames';

export const tradingColumns = [
  { key: 'sport_label', label: 'Sport', type: 'sport' },
  { key: 'begin_at', label: 'Start time (ET)', type: 'date' },
  { key: 'league', label: 'League' },
  { key: 'team_a', label: 'Team A' },
  { key: 'team_b', label: 'Team B' },
  { key: 'fair_ml_a', label: 'Team A Fair ML', type: 'moneyline', sortKey: 'fair_ml_a_sort' },
  { key: 'total_edge', label: 'Total Edge', type: 'market-edge', sortKey: 'best_total_edge' },
  { key: 'edge', label: 'ML Edge', type: 'market-edge', sortKey: 'best_edge' },
];

const hasOdds = odds => Number.isFinite(odds) && Math.abs(odds) >= 100;
// Order from longest to shortest with +100 and -100 treated as the same price.
const oddsOrder = odds => odds > 0 ? odds - 100 : odds + 100;

function fairMoneyline(values) {
  const prices = values.filter(hasOdds).sort((a, b) => oddsOrder(b) - oddsOrder(a));
  if (!prices.length) return { fair_ml_a: '', fair_ml_a_sort: null };
  const first = prices[0], last = prices[prices.length - 1];
  return {
    fair_ml_a: oddsOrder(first) === oddsOrder(last) ? formatOdds(first) : `${formatOdds(first)} to ${formatOdds(last)}`,
    fair_ml_a_sort: oddsOrder(first),
  };
}

export function lolTradingGame(game) {
  return { ...game, sport_label: 'League of Legends', edge: 'Unavailable', ...fairMoneyline([seriesMoneyline(game)]) };
}

function summarizeEdges(rows, markets) {
  const bestByMarket = new Map();
  for (const row of rows) {
    for (const [side, odds, edge] of markets(row)) {
      if (hasOdds(odds) && Number.isFinite(edge) && edge > (bestByMarket.get(side) ?? -Infinity)) bestByMarket.set(side, edge);
    }
  }
  const positive = [...bestByMarket].filter(([, edge]) => edge > 0).sort((a, b) => b[1] - a[1]);
  return {
    text: positive.map(([side, edge]) => {
      const points = (edge * 100).toFixed(1);
      return `${side} · ${points === '0.0' ? '<0.1' : `+${points}`} pp`;
    }).join('\n') || (bestByMarket.size ? 'No positive edge' : 'Unavailable'),
    best: positive[0]?.[1] ?? (bestByMarket.size ? 0 : null),
  };
}

export function hockeyTradingGames(games, publishedAt) {
  const byGame = new Map();
  for (const row of games) {
    // The publisher requires a game ID. Keep unidentified rows separate if an older snapshot lacks it.
    const key = row.id == null || row.id === '' ? row : String(row.id);
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key).push(hockeySendGame(row, publishedAt));
  }
  return Array.from(byGame.values(), scenarios => {
    const moneyline = summarizeEdges(scenarios, row => [
      ['Home ML', row.HomeML, row.edge_home], ['Away ML', row.AwayML, row.edge_away],
    ]);
    const totals = summarizeEdges(scenarios, row => Number.isFinite(row.Total) ? [
      [`Over ${row.Total}`, row.OverOdds, row.edge_over], [`Under ${row.Total}`, row.UnderOdds, row.edge_under],
    ] : []);
    return {
      ...scenarios[0], sport_label: 'Hockey',
      ...fairMoneyline(scenarios.map(row => row.winoddsfulltime)),
      edge: moneyline.text, best_edge: moneyline.best,
      total_edge: totals.text, best_total_edge: totals.best,
      ...(scenarios.length > 1 ? { scenarios } : {}),
    };
  });
}
