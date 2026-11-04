// Prices are already calculated by EP-HOCKEY-DB-MODELS/DATASAVEFORAPP.R.
// Read the published Shiny export without rebuilding or collapsing goalie scenarios.
const { mysqlOptions, americanToProbability } = require('./lol.cjs');
const TABLE = 'hub_hockey_future_games';
const columns = [
  ['dateTime', 'Game time (ET)', 'date'], ['leagueName', 'League'],
  ['homeTeamName', 'Home'], ['visitingTeamName', 'Away'],
  ['winoddsfulltime', 'Home fair ML incl OT/SO', 'odds'], ['away_winoddsfulltime', 'Away fair ML incl OT/SO', 'odds'],
  ['HomeML', 'Home sportsbook ML', 'odds'], ['AwayML', 'Away sportsbook ML', 'odds'],
  ['edge_home', 'Home edge', 'edge'], ['edge_away', 'Away edge', 'edge'],
  ['Total', 'Game total', 'number'], ['OverOdds', 'Over odds', 'odds'], ['UnderOdds', 'Under odds', 'odds'],
  ['edge_over', 'Over edge', 'edge'], ['edge_under', 'Under edge', 'edge'],
  ['goalie_team', 'Home goalie'], ['goalie_team_n', 'Home goalie games', 'number'], ['goalie_team_last_game', 'Home goalie days since last game', 'number'],
  ['goalie_opp', 'Away goalie'], ['goalie_opp_n', 'Away goalie games', 'number'], ['goalie_opp_last_game', 'Away goalie days since last game', 'number'],
  ['HomePuckLine', 'Home puck line', 'number'], ['HomePuckLineOdds', 'Home puck line odds', 'odds'],
  ['AwayPuckLine', 'Away puck line', 'number'], ['AwayPuckLineOdds', 'Away puck line odds', 'odds'],
  ['winoddsregtime', 'Regulation ML American', 'odds'],
  ...['4.5', '5', '5.5', '6', '6.5', '7', '7.5'].map(total => [`full_game_o${total}`, `OT/SO O${total}`, 'odds']),
  ['team_b2b_type', 'Home B2B'], ['opp_b2b_type', 'Away B2B'],
  ['reg_time_home_win_prob', 'Regulation home win', 'probability'], ['reg_time_draw_prob', 'Regulation draw', 'probability'],
  ['reg_time_away_win_prob', 'Regulation away win', 'probability'],
  ['winprob', 'Home win probability', 'percent'], ['model_spread', 'Model spread', 'number'],
  ['seasonType', 'Season type'], ['date', 'Game date'], ['id', 'Game ID'],
].map(([key, label, type = 'text']) => ({ key, label, type }));

function numeric(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeGame(raw) {
  const row = { ...raw };
  for (const column of columns) {
    if (!['text', 'date'].includes(column.type)) row[column.key] = numeric(row[column.key]);
  }
  // Match Shiny's total-edge calculation at the quoted total, using quoted vig.
  const total = numeric(raw.Total);
  const line = ['4.5', '5', '5.5', '6', '6.5', '7', '7.5'].find(n => total !== null && Math.abs(Number(n) - total) < 1e-8);
  const over = line ? americanToProbability(row[`full_game_o${line}`]) : null;
  const marketOver = americanToProbability(row.OverOdds);
  const marketUnder = americanToProbability(row.UnderOdds);
  row.edge_over = over === null || marketOver === null ? null : over - marketOver;
  row.edge_under = over === null || marketUnder === null ? null : 1 - over - marketUnder;
  return row;
}

function createHockeyGamesService({ env = process.env, createPool, now = () => new Date() } = {}) {
  let pool;
  let pending;
  return {
    async getFutureGames() {
      if (pending) return pending;
      pending = (async () => {
        if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
        const [rows] = await pool.query({ sql: `SELECT \`row_number\`, \`record_json\`, \`published_at\`, \`source_modified_at\` FROM \`${TABLE}\` ORDER BY \`row_number\``, timeout: 20000 });
        const records = rows.filter(row => Number(row.row_number) > 0);
        const metadata = rows.find(row => Number(row.row_number) === 0);
        if (!metadata) throw Object.assign(new Error('No hockey publication.'), { code: 'HOCKEY_NOT_PUBLISHED' });
        return {
          columns, games: records.map(row => normalizeGame(typeof row.record_json === 'string' ? JSON.parse(row.record_json) : row.record_json)),
          fetchedAt: now().toISOString(),
          source: { name: 'DigitalOcean MySQL', table: TABLE, updatedAt: metadata.published_at, fileModifiedAt: metadata.source_modified_at },
        };
      })();
      try { return await pending; } finally { pending = null; }
    },
    async close() { if (pool) await pool.end(); },
  };
}

module.exports = { TABLE, columns, normalizeGame, createHockeyGamesService };
