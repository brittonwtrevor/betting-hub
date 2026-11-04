// Port of apps/dashboard/app.R:getupcominggames in LOL-MODEL-V2.
// TREVORFAIRS is published by pipelines/publish/WRITEFAIRSTOAWS.R.
const columns = [
  ['begin_at', 'Start time (ET)', 'date'], ['league', 'League'],
  ['team_a', 'Team A'], ['a', 'A logo', 'image'], ['team_b', 'Team B'], ['b', 'B logo', 'image'],
  ['map1_probability', 'XGB Map1 Probability', 'percent'], ['bo3_probability', 'BO3 Price Probability', 'percent'],
  ['xgb_map1', 'XGB Map1', 'odds'], ['ml_map1', 'ML Map1', 'odds'], ['priors_only', 'Priors Only', 'odds'],
  ['total', 'Total', 'number'], ['bo3_price', 'BO3 Price', 'odds'],
  ['bo5_probability', 'BO5 Price Probability', 'percent'], ['bo5_price', 'BO5 Price', 'odds'],
  ['game_duration', 'Game duration', 'number'],
  ...['a', 'b'].flatMap(team => ['adc', 'sup', 'mid', 'jun', 'top'].map(role => [`${team}_${role}`, `${team} ${role}`])),
  ['priors_pred', 'Priors prediction', 'number'], ['bot_lane_pred', 'Bot lane prediction', 'number'],
  ['central_players_pred', 'Central players prediction', 'number'], ['pred_top', 'Top prediction', 'number'],
  ['lineup_note', 'Lineup source', 'link'], ['islastlineup', 'Last lineup', 'number'],
  ['game_id', 'Game ID', 'number'], ['match_id', 'Match ID', 'number'],
].map(([key, label, type = 'text']) => ({ key, label, type }));

const sourceColumns = [
  'begin_at', 'league_name', 'lineup_note', 'islastlineup', 'game_id', 'match_id',
  'team_a_name', 'team_b_name', 'image_url_team_a', 'image_url_team_b',
  'pred_xgb', 'MLA', 'ML_PRIORS', 'total_kills_prediction', 'game_duration',
  ...['a', 'b'].flatMap(team => ['adc', 'sup', 'mid', 'jun', 'top'].map(role => `team_${team}_${role}_player_name`)),
  'bot_lane_pred', 'central_players_pred', 'pred_top', 'updateddate',
];

function numeric(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// R rounds ties to even, including in the initial two-decimal pass.
function round(value, digits = 0) {
  const number = numeric(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  const absolute = Math.abs(number);
  const scaled = absolute * scale;
  const floor = Math.floor(scaled);
  const lower = floor / scale;
  const upper = (floor + 1) / scale;
  // Compare distances before scaling: multiplying first can erase a double's
  // position just above/below a tie (for example, R's round(27.85, 1) is 27.9).
  const down = absolute - lower;
  const up = upper - absolute;
  return Math.sign(number) * (up < down || (up === down && floor % 2 === 1) ? upper : lower);
}

function americanToProbability(odds) {
  const value = numeric(odds);
  if (value === null || value === 0) return null;
  return value > 0 ? 100 / (value + 100) : -value / (100 - value);
}

function probabilityToAmerican(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  return round(p > 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
}

function safeUrl(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const extracted = text.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
    || text.match(/https?:\/\/[^\s"'<>),]+/)?.[0];
  try {
    const url = new URL(extracted || text);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function normalizeGame(raw) {
  const n = key => round(raw[key], 2);
  const map1 = round(n('pred_xgb'));
  const p = americanToProbability(map1);
  const bo3 = p === null ? null : probabilityToAmerican(p ** 2 + 2 * p ** 2 * (1 - p));
  const bo5 = p === null ? null : probabilityToAmerican(p ** 3 + 3 * p ** 3 * (1 - p) + 6 * p ** 3 * (1 - p) ** 2);
  const percent = odds => {
    const probability = americanToProbability(odds);
    return probability === null ? null : round(100 * probability, 1);
  };
  const row = {
    begin_at: raw.begin_at, league: raw.league_name, lineup_note: safeUrl(raw.lineup_note),
    islastlineup: numeric(raw.islastlineup), game_id: raw.game_id, match_id: raw.match_id,
    team_a: raw.team_a_name, a: safeUrl(raw.image_url_team_a), team_b: raw.team_b_name, b: safeUrl(raw.image_url_team_b),
    map1_probability: percent(map1), bo3_probability: percent(bo3), xgb_map1: map1,
    ml_map1: round(n('MLA')), priors_only: round(n('ML_PRIORS')), total: round(n('total_kills_prediction'), 1),
    bo3_price: bo3, bo5_probability: percent(bo5), bo5_price: bo5, game_duration: n('game_duration'),
    priors_pred: n('ML_PRIORS'), bot_lane_pred: n('bot_lane_pred'),
    central_players_pred: n('central_players_pred'), pred_top: n('pred_top'),
  };
  for (const team of ['a', 'b']) for (const role of ['adc', 'sup', 'mid', 'jun', 'top']) {
    row[`${team}_${role}`] = raw[`team_${team}_${role}_player_name`] || null;
  }
  return row;
}

function mysqlOptions(env) {
  const required = ['LOL_DO_DB_HOST', 'LOL_DO_DB_USER', 'LOL_DO_DB_PASSWORD', 'LOL_DO_DB_NAME'];
  if (required.some(key => !env[key])) {
    throw Object.assign(new Error('League of Legends data connection is not configured.'), { code: 'DB_NOT_CONFIGURED' });
  }
  const port = Number(env.LOL_DO_DB_PORT || 25060);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('Invalid database port.'), { code: 'DB_NOT_CONFIGURED' });
  }
  return {
    host: env.LOL_DO_DB_HOST, port, user: env.LOL_DO_DB_USER,
    password: env.LOL_DO_DB_PASSWORD, database: env.LOL_DO_DB_NAME,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(env.LOL_DO_DB_SSL_CA ? { ca: env.LOL_DO_DB_SSL_CA.replace(/\\n/g, '\n') } : {}) },
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    connectionLimit: 3, waitForConnections: true, queueLimit: 20, connectTimeout: 10000,
    enableKeepAlive: true, multipleStatements: false,
  };
}

function createUpcomingGamesService({ env = process.env, createPool, now = () => new Date() } = {}) {
  let pool;
  let pending;
  return {
    async getUpcomingGames() {
      // Share concurrent requests; retain no stale response after a failed refresh.
      if (pending) return pending;
      pending = (async () => {
        if (!pool) {
          const options = mysqlOptions(env);
          pool = (createPool || require('mysql2/promise').createPool)(options);
        }
        const sql = `SELECT ${sourceColumns.map(name => `\`${name}\``).join(', ')} FROM \`TREVORFAIRS\` ORDER BY \`begin_at\`, \`match_id\`, \`game_id\``;
        const [rows] = await pool.query({ sql, timeout: 15000 });
        const dates = rows.map(row => row.updateddate).filter(Boolean).sort();
        return {
          columns, games: rows.map(normalizeGame), fetchedAt: now().toISOString(),
          source: { name: 'DigitalOcean MySQL', table: 'TREVORFAIRS', updatedAt: dates.at(-1) || null },
        };
      })();
      try { return await pending; }
      finally { pending = null; }
    },
    async close() { if (pool) await pool.end(); },
  };
}

module.exports = { columns, normalizeGame, round, americanToProbability, mysqlOptions, createUpcomingGamesService };
