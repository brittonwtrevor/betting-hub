#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const { mysqlOptions } = require('../server/lol.cjs');
const { TABLE } = require('../server/hockey.cjs');
const DEFAULT_ROOT = path.resolve(__dirname, '../../EP-HOCKEY-DB-MODELS');

// RFC 4180: goalie/team names can contain commas, quotes, and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else throw new Error('Unexpected quote in FutureGames CSV.');
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(field); field = '';
      if (char !== ',') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error('Incomplete FutureGames CSV.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  const required = ['id', 'date', 'leagueName', 'homeTeamName', 'visitingTeamName', 'goalie_team', 'goalie_opp', 'winoddsfulltime'];
  if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw new Error('FutureGames CSV is missing required columns or has duplicate headers.');
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error('Incomplete FutureGames CSV row.');
    const record = Object.fromEntries(headers.map((key, i) => [key, ['', 'NA', 'NaN', 'Inf', '-Inf'].includes(values[i]) ? null : values[i]]));
    if (!record.id || !record.leagueName || !record.homeTeamName || !record.visitingTeamName) throw new Error('FutureGames row is missing its game identity.');
    return record;
  });
}

async function loadExport(file) {
  const before = await fs.stat(file);
  const records = parseCsv(await fs.readFile(file, 'utf8'));
  const after = await fs.stat(file);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('FutureGames changed during the read; retry after the export finishes.');
  return { records, modifiedAt: after.mtime.toISOString() };
}

function connectionOptions(env, hockeyRoot, useHockeyConnection, envFile) {
  let config = { ...env };
  const keys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME', 'SSL_CA'];
  // The app and LoL model already share this connection. Use their local
  // configuration for uploads too; explicit environment values take priority.
  for (const key of keys) config[`LOL_DO_DB_${key}`] ||= config[`DO_DB_${key}`];
  const connectionFile = envFile || env.LOL_CONNECTION_ENV_FILE || path.resolve(hockeyRoot, '../LOL-MODEL-V2/.env');
  if (require('node:fs').existsSync(connectionFile)) {
    if (!parseEnv) throw new Error('The hockey publisher requires Node 20.12 or newer to read the LoL connection file.');
    const saved = parseEnv(require('node:fs').readFileSync(connectionFile, 'utf8'));
    for (const key of keys) config[`LOL_DO_DB_${key}`] ||= saved[`LOL_DO_DB_${key}`];
    config.DO_DB_CA_CERT ||= saved.DO_DB_CA_CERT;
  } else if (envFile || env.LOL_CONNECTION_ENV_FILE) {
    throw new Error('The selected LoL connection file does not exist.');
  }
  if (useHockeyConnection && !config.LOL_DO_DB_HOST && !config.DO_DB_HOST) {
    // Reuse the user's existing connection configuration without printing secrets
    // or copying credentials into betting-hub. The module is not run as a script.
    const script = path.join(hockeyRoot, 'SCRIPTS/replicate_sqlite_to_digitalocean_mysql.py');
    const result = spawnSync('python3', ['-c',
      'import importlib.util,sys,json,dataclasses; s=importlib.util.spec_from_file_location("hockey_db_config",sys.argv[1]); m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); print(json.dumps(dataclasses.asdict(m.target_config_from_environment())))', script], { encoding: 'utf8', env, maxBuffer: 65536 });
    if (result.status !== 0) throw new Error('Unable to read the existing hockey database configuration. Use LOL_DO_DB_* or DO_DB_* variables.');
    const saved = JSON.parse(result.stdout);
    config = { ...config, DO_DB_HOST: saved.host, DO_DB_PORT: saved.port, DO_DB_USER: saved.user, DO_DB_PASSWORD: saved.password, DO_DB_NAME: saved.database, DO_DB_CA_CERT: saved.ca_cert || '' };
  }
  for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) config[`LOL_DO_DB_${key}`] ||= config[`DO_DB_${key}`];
  if (!config.LOL_DO_DB_SSL_CA && config.DO_DB_CA_CERT) config.LOL_DO_DB_SSL_CA = require('node:fs').readFileSync(config.DO_DB_CA_CERT, 'utf8');
  // Public project CA retrieved from the existing app's LOL_DO_DB_SSL_CA.
  // Credentials remain in the shared local .env; explicit CAs take priority.
  if (!config.LOL_DO_DB_SSL_CA && config.LOL_DO_DB_HOST === 'db-mysql-nyc3-65249-do-user-42192939-0.k.db.ondigitalocean.com') {
    config.LOL_DO_DB_SSL_CA = require('node:fs').readFileSync(path.join(__dirname, '../config/digitalocean-mysql-ca.pem'), 'utf8');
  }
  const options = mysqlOptions(config);
  for (const key of ['connectionLimit', 'waitForConnections', 'queueLimit']) delete options[key];
  return options;
}

async function publish(connection, load, { allowEmpty = false, now = () => new Date() } = {}) {
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [TABLE]);
    if (Number(lock.acquired) !== 1) throw new Error('Another hockey upload is running. Retry shortly.');
    locked = true;
    const { records, modifiedAt } = await load();
    if (!records.length && !allowEmpty) throw new Error('Empty export rejected; the previous publication is retained. Use --allow-empty for an intentional empty schedule.');
    await connection.query(`CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
      \`row_number\` INT UNSIGNED NOT NULL PRIMARY KEY,
      \`record_json\` JSON NOT NULL,
      \`published_at\` VARCHAR(32) NOT NULL,
      \`source_modified_at\` VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const publishedAt = now().toISOString();
    await connection.beginTransaction();
    try {
      await connection.query(`DELETE FROM \`${TABLE}\``);
      const rows = [[0, JSON.stringify({ rows: records.length }), publishedAt, modifiedAt], ...records.map((row, i) => [i + 1, JSON.stringify(row), publishedAt, modifiedAt])];
      for (let offset = 0; offset < rows.length; offset += 100) {
        await connection.query(`INSERT INTO \`${TABLE}\` (\`row_number\`, \`record_json\`, \`published_at\`, \`source_modified_at\`) VALUES ?`, [rows.slice(offset, offset + 100)]);
      }
      const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${TABLE}\``);
      if (Number(count.n) !== records.length + 1) throw new Error('Hockey upload row-count verification failed.');
      await connection.commit();
      return { rows: records.length, games: new Set(records.map(row => row.id)).size, publishedAt, modifiedAt };
    } catch (error) { await connection.rollback(); throw error; }
  } finally { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [TABLE]); }
}

async function main(args) {
  const flags = new Set(['--dry-run', '--allow-empty', '--use-hockey-connection']);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) values[args[i]] = true;
    else if (['--hockey-root', '--csv', '--env-file'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) { values[args[i]] = args[i + 1]; i++; }
    else throw new Error('Usage: node scripts/publish-hockey-future-games.cjs [--hockey-root PATH] [--csv PATH] [--env-file PATH] [--dry-run] [--allow-empty] [--use-hockey-connection]');
  }
  const root = path.resolve(values['--hockey-root'] || process.env.HOCKEY_MODEL_ROOT || DEFAULT_ROOT);
  const file = path.resolve(values['--csv'] || path.join(root, 'my-shiny-app/data/FutureGames.csv'));
  if (values['--dry-run']) {
    const data = await loadExport(file);
    console.log(JSON.stringify({ rows: data.records.length, games: new Set(data.records.map(row => row.id)).size, modifiedAt: data.modifiedAt }));
    return;
  }
  const options = connectionOptions(process.env, root, values['--use-hockey-connection'], values['--env-file']);
  const connection = await require('mysql2/promise').createConnection(options);
  try { console.log('Hockey Future Games published:', JSON.stringify(await publish(connection, () => loadExport(file), { allowEmpty: values['--allow-empty'] }))); }
  finally { await connection.end(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Driver messages may include connection details. Only report a safe code.
  console.error(error.code ? `Hockey upload failed (${error.code}); previous published data retained.` : error.message);
  process.exitCode = 1;
});
module.exports = { parseCsv, loadExport, connectionOptions, publish };
