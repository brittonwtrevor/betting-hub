#!/usr/bin/env node
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { connectionOptions } = require('./publish-hockey-future-games.cjs');
const { createFeedHealthService } = require('../server/feed-health.cjs');
const { stageFeeds, pandaReports, stageEvents, oddsEvents } = require('./feed-events.cjs');

const hub = path.resolve(__dirname, '..');
const hockey = path.resolve(process.env.HOCKEY_MODEL_ROOT || path.join(hub, '../EP-HOCKEY-DB-MODELS'));
const lol = path.resolve(process.env.LOL_PROJECT_ROOT || path.join(hub, '../LOL-MODEL-V2'));
const shim = path.join(__dirname, 'monitor-bin/Rscript');
const odds = path.join(hockey, 'SCRIPTS/DAILYRUNSCRIPTS/ODDS_SCRAPING/RUN_HOCKEY_ODDS.sh');
const hockeyApi = path.join(hockey, 'SCRIPTS/DAILYRUNSCRIPTS/EP_API_UPDATE');

function run(command, args, { cwd, env, capture = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', chunk => {
        if (!target.write(chunk)) { stream.pause(); target.once('drain', () => stream.resume()); }
        output = (output + chunk.toString()).slice(-65536);
      });
    }
    const forward = signal => { child.kill(signal); };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    child.once('error', error => { console.error(`Unable to launch collector (${error.code || 'launch error'}).`); });
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      resolve({ code: code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1), output });
    });
  });
}

async function publish(events) {
  if (!events.length) return;
  const options = connectionOptions(process.env, hockey, false, process.env.LOL_CONNECTION_ENV_FILE);
  const store = createFeedHealthService({ options });
  try {
    await store.record(events);
  } finally { await store.close().catch(() => {}); }
}

function reportPublishError(error) {
  console.error(`Feed telemetry could not be saved (${error.code || 'configuration error'}).`);
}

async function rscript(args) {
  const executable = process.env.FEED_MONITOR_REAL_RSCRIPT;
  if (!executable) throw new Error('Set FEED_MONITOR_REAL_RSCRIPT to the existing Rscript executable.');
  const script = args.find(arg => arg.endsWith('.R'));
  const track = script && stageFeeds[path.basename(script)] && !args.some(arg => ['--dry-run', '--no-write', '--help', '-h'].includes(arg));
  const start = Date.now();
  const result = await run(executable, args, { capture: !!track });
  if (track) {
    const at = new Date().toISOString();
    const reportFile = process.env.LOL_PIPELINE_STATUS_FILE;
    const report = reportFile ? await fs.readFile(reportFile, 'utf8').catch(() => '') : '';
    await publish(stageEvents(script, { ...result, at, durationMs: Date.parse(at) - start, report })).catch(reportPublishError);
  }
  return result.code;
}

async function readOddsRuns() {
  const directory = process.env.HOCKEY_ODDS_RUNTIME_DIR || path.join(hockey, 'output/odds_refresh');
  let file;
  try { file = await fs.open(path.join(directory, 'runs.jsonl'), 'r'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  try {
    const { size } = await file.stat();
    const offset = Math.max(0, size - 256 * 1024);
    const buffer = Buffer.alloc(size - offset);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    const lines = buffer.toString('utf8', 0, bytesRead).split('\n');
    if (offset) lines.shift();
    return lines.flatMap(line => {
      try { const run = JSON.parse(line); return run.dry_run === false ? [run] : []; }
      catch { return []; } // Concurrent append may leave an incomplete last line.
    });
  } finally { await file.close(); }
}

function quoteSnapshots(run) {
  if (!run?.database || !run?.run_id) return {};
  const query = `import json, sqlite3, sys
from pathlib import Path
with sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True, timeout=2) as db:
    rows = db.execute('SELECT Feed, COUNT(*), MAX(ScrapedAtUTC) FROM HOCKEYSCRAPEDODDS WHERE ScrapeRunId = ? GROUP BY Feed', (sys.argv[2],))
    result = {feed: {'records': 0, 'dataAt': None} for feed in ['DraftKings', 'OwlsInsight', 'Caddyshack']}
    result.update({feed: {'records': count, 'dataAt': at} for feed, count, at in rows})
    print(json.dumps(result))`;
  const result = spawnSync('python3', ['-c', query, run.database, run.run_id], { encoding: 'utf8', timeout: 4000 });
  return result.status === 0 ? JSON.parse(result.stdout) : {};
}

async function readOddsEvents(failedSince) {
  const runs = await readOddsRuns();
  const latest = new Map();
  const successes = new Map();
  const dataRuns = new Map();
  for (const run of runs) for (const event of oddsEvents(run)) {
    if (!latest.has(event.id) || latest.get(event.id).at <= event.at) {
      latest.set(event.id, event);
      dataRuns.set(event.id, run);
    }
    if (event.status === 'success' && (!successes.has(event.id) || successes.get(event.id).at < event.at)) successes.set(event.id, event);
  }
  const snapshots = new Map();
  const enriched = [...latest].map(([id, event]) => {
    const run = dataRuns.get(id);
    if (!snapshots.has(run.run_id)) snapshots.set(run.run_id, quoteSnapshots(run));
    return oddsEvents(run, snapshots.get(run.run_id)).find(item => item.id === id) || event;
  });
  const prior = enriched.flatMap(event => {
    const lastSuccess = successes.get(event.id);
    return lastSuccess && lastSuccess.at < event.at ? [lastSuccess] : [];
  });
  const lastScrape = latest.get('hockey-odds');
  if (failedSince != null && (!lastScrape || Date.parse(lastScrape.at) < failedSince)) {
    const at = new Date().toISOString();
    enriched.push({ id: 'hockey-odds', at, status: 'failed', durationMs: Date.parse(at) - failedSince });
  }
  return [...prior, ...enriched];
}

async function readPandaEvents(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const events = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('lol-pipeline-status.')) continue;
    for (const [file, script] of Object.entries(pandaReports)) {
      const reportPath = path.join(directory, entry.name, file);
      let handle;
      try {
        handle = await fs.open(reportPath, 'r');
        const stat = await handle.stat();
        if (!stat.isFile()) continue;
        const report = await handle.readFile('utf8');
        if (!/^level=(success|warning)\r?\n./.test(report) || !report.endsWith('\n')) continue;
        events.push(...stageEvents(script, { at: stat.mtime.toISOString(), code: 0, report }));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      } finally { await handle?.close(); }
    }
  }
  return events;
}

async function sync(mode, args) {
  if (args.length > 1 || (args.length && args[0] !== '--preview')) return 2;
  const events = await readOddsEvents();
  if (mode === 'sync') {
    events.push(...await readPandaEvents(process.env.LOL_PIPELINE_REPORTS_DIR || os.tmpdir()));
  }
  if (args[0] === '--preview') {
    const latest = new Map();
    for (const event of events.sort((a, b) => a.at.localeCompare(b.at))) latest.set(event.id, event);
    console.table([...latest.values()].map(({ id, at, status, records, gaps }) => ({ id, at, status, records, gaps })));
  } else {
    await publish(events);
    console.log(`Synced telemetry for ${new Set(events.map(event => event.id)).size} feeds.`);
  }
  return 0;
}

async function main([mode, ...args]) {
  if (mode === 'rscript') return rscript(args);
  if (mode === 'sync-odds' || mode === 'sync') return sync(mode, args);
  if (!['hockey', 'hockey-data', 'lol', 'hockey-rosters', 'hockey-odds'].includes(mode)) {
    console.error('Usage: monitor-feeds.zsh hockey|hockey-data|lol|hockey-rosters|hockey-odds|sync|sync-odds [runner arguments]');
    return 2;
  }
  const rscriptCommand = process.env.FEED_MONITOR_REAL_RSCRIPT || process.env.RSCRIPT || 'Rscript';
  const executable = spawnSync('which', [rscriptCommand], { encoding: 'utf8' }).stdout?.trim();
  if (!executable || path.resolve(executable) === shim) throw new Error('Rscript was not found. Set FEED_MONITOR_REAL_RSCRIPT.');
  const env = { ...process.env, FEED_MONITOR_REAL_RSCRIPT: executable, FEED_MONITOR_NODE: process.execPath,
    HOCKEY_NODE_BIN: process.env.HOCKEY_NODE_BIN || process.execPath, RSCRIPT: shim, PATH: `${path.dirname(shim)}${path.delimiter}${process.env.PATH || ''}` };
  const start = Math.floor(Date.now() / 1000) * 1000;
  let result;
  if (mode === 'hockey-data') {
    if (args.length) return 2;
    const days = `--days=${env.GAMELOG_LOOKBACK_DAYS || '7'}`;
    for (const stage of [['GAME_QUERY_DB_UPDATE.R'], ['CHECK_GAME_LOGS.R', days], ['UPDATE_GAME_LOGS.R', days]]) {
      result = await run(shim, stage, { env, cwd: hockeyApi });
      if (result.code !== 0) return result.code;
    }
  }
  if (mode === 'hockey') result = await run('zsh', [path.join(hub, 'scripts/run-hockey-pipeline.zsh'), ...args], { env });
  if (mode === 'lol') result = await run('sh', [path.join(lol, 'pipelines/full_pipeline.sh'), ...args], { env, cwd: lol });
  if (mode === 'hockey-rosters') result = await run(shim, ['CURRENT_ROSTERS.R', ...args], { env, cwd: hockeyApi });
  if (mode === 'hockey-odds') result = await run('sh', [odds, ...args], { env });
  const reportsOdds = (mode === 'hockey' || mode === 'hockey-odds') && !args.some(arg => ['--help', '-h', '--dry-run', '--upload-only'].includes(arg));
  if (reportsOdds) {
    const failedSince = mode === 'hockey-odds' && result.code !== 0 && !/^(true|1|yes|y)$/i.test(process.env.HOCKEY_ODDS_DRY_RUN || '') ? start : undefined;
    await readOddsEvents(failedSince).then(publish).catch(reportPublishError);
  }
  return result.code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Feed monitor could not run${error.code ? ` (${error.code})` : ''}. Check the runner configuration.`);
    process.exitCode = 1;
  });
}
module.exports = { readPandaEvents };
