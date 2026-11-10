import { formatOdds } from '../bets/markets';
import { hockeySendGame } from '../sports/hockey/futureGames';

export const tradingColumns = [
  ['series_format', 'Format'], ['sport_label', 'Sport'], ['begin_at', 'Start time (ET)', 'date'],
  ['league', 'League'], ['team_a', 'Team A'], ['team_b', 'Team B'],
  ['xgb_map1', 'XGB Map1', 'odds'], ['bo3_price', 'BO3 Price', 'odds'], ['bo5_price', 'BO5 Price', 'odds'],
  ['market_prices', 'Hockey sportsbook odds'], ['edge', 'Edge'],
].map(([key, label, type = 'text']) => ({ key, label, type }));

const hasOdds = odds => Number.isFinite(odds) && Math.abs(odds) >= 100;

function priceLine(market, sides) {
  const prices = sides.filter(([, odds]) => hasOdds(odds)).map(([side, odds]) => `${side} ${formatOdds(odds)}`);
  return prices.length ? `${market} · ${prices.join(' / ')}` : '';
}

export function hockeyTradingGame(row, publishedAt) {
  const total = Number.isFinite(row.Total) ? row.Total : null;
  const marketPrices = [
    priceLine('ML', [['Home', row.HomeML], ['Away', row.AwayML]]),
    total === null ? '' : priceLine(`Total ${total}`, [['Over', row.OverOdds], ['Under', row.UnderOdds]]),
  ].filter(Boolean);
  const comparable = [
    ['Home ML', row.HomeML, row.edge_home], ['Away ML', row.AwayML, row.edge_away],
    ...(total === null ? [] : [[`Over ${total}`, row.OverOdds, row.edge_over], [`Under ${total}`, row.UnderOdds, row.edge_under]]),
  ].filter(([, odds, edge]) => hasOdds(odds) && Number.isFinite(edge));
  const positive = comparable.filter(([, , edge]) => edge > 0).sort((a, b) => b[2] - a[2]);
  return {
    ...hockeySendGame(row, publishedAt), sport_label: 'Hockey', market_prices: marketPrices.join('\n'),
    edge: positive.map(([side, , edge]) => {
      const points = (edge * 100).toFixed(1);
      return `${side} · ${points === '0.0' ? '<0.1' : `+${points}`} pp`;
    }).join('\n') || (comparable.length ? 'No positive edge' : 'Unavailable'),
    best_edge: positive[0]?.[2] ?? (comparable.length ? 0 : null),
  };
}
