import { formatOdds, oppositeOdds, seriesMoneyline } from '../bets/markets';
import { hockeySendGame } from '../sports/hockey/futureGames';

export const tradingColumns = [
  { key: 'sport_label', label: 'Sport', type: 'sport' },
  { key: 'begin_at', label: 'Start time (ET)', type: 'date' },
  { key: 'league', label: 'League' },
  { key: 'team_a', label: 'Team A' },
  { key: 'team_b', label: 'Team B' },
  { key: 'fair_ml_a', label: 'Team A Fair ML', type: 'moneyline', sortKey: 'fair_ml_a_sort' },
  { key: 'fair_ml_b', label: 'Team B Fair ML', type: 'moneyline', sortKey: 'fair_ml_b_sort' },
  { key: 'edge', label: 'Edge', sortKey: 'best_edge' },
];

const hasOdds = odds => Number.isFinite(odds) && Math.abs(odds) >= 100;
// Order from longest to shortest with +100 and -100 treated as the same price.
const oddsOrder = odds => odds > 0 ? odds - 100 : odds + 100;

function fairPrice(values) {
  const prices = values.filter(hasOdds).sort((a, b) => oddsOrder(b) - oddsOrder(a));
  if (!prices.length) return { text: '', sort: null };
  const first = prices[0], last = prices[prices.length - 1];
  return {
    text: oddsOrder(first) === oddsOrder(last) ? formatOdds(first) : `${formatOdds(first)} to ${formatOdds(last)}`,
    sort: oddsOrder(first),
  };
}

function moneylineFields(a, b) {
  return { fair_ml_a: a.text, fair_ml_b: b.text, fair_ml_a_sort: a.sort, fair_ml_b_sort: b.sort };
}

export function lolTradingGame(game) {
  const price = seriesMoneyline(game);
  const a = fairPrice([price]);
  const b = fairPrice([oppositeOdds(price)]);
  return { ...game, sport_label: 'League of Legends', edge: 'Unavailable', ...moneylineFields(a, b) };
}

function summarizeEdges(rows) {
  const bestByMarket = new Map();
  for (const row of rows) {
    const comparable = [
      ['Home ML', row.HomeML, row.edge_home], ['Away ML', row.AwayML, row.edge_away],
    ];
    if (Number.isFinite(row.Total)) comparable.push(
      [`Over ${row.Total}`, row.OverOdds, row.edge_over], [`Under ${row.Total}`, row.UnderOdds, row.edge_under],
    );
    for (const [side, odds, edge] of comparable) {
      if (hasOdds(odds) && Number.isFinite(edge) && edge > (bestByMarket.get(side) ?? -Infinity)) bestByMarket.set(side, edge);
    }
  }
  const positive = [...bestByMarket].filter(([, edge]) => edge > 0).sort((a, b) => b[1] - a[1]);
  return {
    edge: positive.map(([side, edge]) => {
      const points = (edge * 100).toFixed(1);
      return `${side} · ${points === '0.0' ? '<0.1' : `+${points}`} pp`;
    }).join('\n') || (bestByMarket.size ? 'No positive edge' : 'Unavailable'),
    best_edge: positive[0]?.[1] ?? (bestByMarket.size ? 0 : null),
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
  return Array.from(byGame.values(), scenarios => ({
    ...scenarios[0], sport_label: 'Hockey',
    ...moneylineFields(fairPrice(scenarios.map(row => row.winoddsfulltime)), fairPrice(scenarios.map(row => row.away_winoddsfulltime))),
    ...summarizeEdges(scenarios),
    ...(scenarios.length > 1 ? { scenarios } : {}),
  }));
}
