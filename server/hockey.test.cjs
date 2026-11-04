const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { TABLE, normalizeGame, createHockeyGamesService } = require('./hockey.cjs');
const { parseCsv, publish, connectionOptions } = require('../scripts/publish-hockey-future-games.cjs');

const sample = { id: '1', date: '2026-11-04', dateTime: '2026-11-04T09:00:00+0300', leagueName: 'VHL', homeTeamName: 'Home', visitingTeamName: 'Away', goalie_team: 'Goalie A', goalie_opp: 'Goalie B', winoddsfulltime: '-123', HomeML: null, Total: '5.5', OverOdds: '-110', UnderOdds: '-120', 'full_game_o5.5': '150', edge_home: null };

test('uses the existing app project CA for this cluster without disabling TLS verification', () => {
  const env = { LOL_DO_DB_HOST: 'db-mysql-nyc3-65249-do-user-42192939-0.k.db.ondigitalocean.com', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'test', LOL_DO_DB_NAME: 'defaultdb' };
  const options = connectionOptions(env, '/tmp/nonexistent-hockey-certificate-fixture');
  const cert = new X509Certificate(options.ssl.ca);
  assert.equal(cert.ca, true);
  assert.equal(cert.verify(cert.publicKey), true);
  assert.ok(new Date(cert.validFrom) < new Date('2026-11-04'));
  assert.ok(new Date(cert.validTo) > new Date('2026-11-04'));
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  const explicit = connectionOptions({ ...env, LOL_DO_DB_SSL_CA: 'explicit-ca' }, '/tmp/nonexistent-hockey-certificate-fixture');
  assert.equal(explicit.ssl.ca, 'explicit-ca');
  const other = connectionOptions({ ...env, LOL_DO_DB_HOST: 'other.example.test' }, '/tmp/nonexistent-hockey-certificate-fixture');
  assert.equal(other.ssl.ca, undefined);
});

test('automatically uses the adjacent LoL connection file, preserving secrets and verified TLS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hockey-shared-db-'));
  try {
    fs.mkdirSync(path.join(root, 'LOL-MODEL-V2'));
    const file = path.join(root, 'LOL-MODEL-V2/.env');
    const text = 'LOL_DO_DB_HOST=shared.example.test\nLOL_DO_DB_PORT=25060\nLOL_DO_DB_USER=shared-user\nLOL_DO_DB_PASSWORD="secret#with spaces"\nLOL_DO_DB_NAME=defaultdb\nLOL_DO_DB_SSL_CA="first\\nsecond"\n';
    fs.writeFileSync(file, text);
    const options = connectionOptions({}, path.join(root, 'EP-HOCKEY-DB-MODELS'));
    assert.equal(options.host, 'shared.example.test');
    assert.equal(options.user, 'shared-user');
    assert.equal(options.password, 'secret#with spaces');
    assert.equal(options.database, 'defaultdb');
    assert.equal(options.ssl.ca, 'first\nsecond');
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.verifyIdentity, true);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    const overridden = connectionOptions({ DO_DB_HOST: 'override.example.test', LOL_DO_DB_PASSWORD: 'override-secret' }, path.join(root, 'EP-HOCKEY-DB-MODELS'));
    assert.equal(overridden.host, 'override.example.test');
    assert.equal(overridden.password, 'override-secret');
    assert.equal(overridden.user, 'shared-user');
    assert.throws(() => connectionOptions({}, root, false, path.join(root, 'missing.env')), /does not exist/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reads real CSV quoting, missing values and rejects partial rows before any publication', () => {
  const header = 'id,date,leagueName,homeTeamName,visitingTeamName,goalie_team,goalie_opp,winoddsfulltime';
  const rows = parseCsv(`${header}\r\n1,2026-11-04,NCAA,"Home, University",Away,"A ""Goalie""\nJr",B,-123\r\n2,2026-11-05,NCAA,Home,Away,NA,,NA`);
  assert.equal(rows[0].homeTeamName, 'Home, University');
  assert.equal(rows[0].goalie_team, 'A "Goalie"\nJr');
  assert.equal(rows[1].goalie_team, null);
  assert.equal(rows[1].winoddsfulltime, null);
  assert.throws(() => parseCsv(`${header}\n1,2026-11-04`), /Incomplete/);
  assert.throws(() => parseCsv(`${header}\n"unfinished`), /Incomplete/);
  assert.throws(() => parseCsv('id,date\n1,today'), /missing required/);
});

test('preserves published prices and computes the same quoted-total edges as Shiny', () => {
  const result = normalizeGame(sample);
  assert.equal(result.winoddsfulltime, -123);
  assert.equal(result['full_game_o5.5'], 150);
  assert.equal(result.HomeML, null);
  assert.equal(result.edge_home, null);
  assert.ok(Math.abs(result.edge_over - (0.4 - 110 / 210)) < 1e-12);
  assert.ok(Math.abs(result.edge_under - (0.6 - 120 / 220)) < 1e-12);
  assert.equal(normalizeGame({ ...sample, Total: '8.5' }).edge_over, null);
  assert.equal(normalizeGame({ ...sample, OverOdds: null }).edge_over, null);
});

test('service reads only its snapshot, retains all goalie variants and shares concurrent reads', async () => {
  let queries = 0;
  const env = { LOL_DO_DB_HOST: 'example.test', LOL_DO_DB_USER: 'reader', LOL_DO_DB_PASSWORD: 'secret', LOL_DO_DB_NAME: 'defaultdb' };
  const service = createHockeyGamesService({ env, createPool: options => {
    assert.equal(options.ssl.rejectUnauthorized, true);
    return { async query({ sql }) {
      assert.match(sql, new RegExp(`FROM \x60${TABLE}\x60`));
      assert.match(sql, /SELECT `row_number`,/);
      assert.match(sql, /ORDER BY `row_number`$/);
      assert.doesNotMatch(sql, /INSERT|DELETE|UPDATE|CREATE|DROP/);
      queries++;
      return [[{ row_number: 0, published_at: '2026-11-04T12:00:00Z', source_modified_at: '2026-11-04T07:00:00Z' },
        { row_number: 1, record_json: JSON.stringify(sample) }, { row_number: 2, record_json: { ...sample, goalie_opp: 'Goalie C' } }]];
    } };
  } });
  const [first, second] = await Promise.all([service.getFutureGames(), service.getFutureGames()]);
  assert.deepEqual(first, second);
  assert.equal(queries, 1);
  assert.equal(first.games.length, 2);
  assert.equal(first.games[1].goalie_opp, 'Goalie C');
  assert.equal(first.source.updatedAt, '2026-11-04T12:00:00Z');
  assert.doesNotMatch(JSON.stringify(first), /secret|example.test/);
});

function fakeConnection(fail = false) {
  const calls = [];
  let inserts = 0;
  return { calls, async query(sql, params) {
    calls.push(sql);
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.startsWith('INSERT')) { if (fail) throw new Error('simulated insert failure'); inserts += params[0].length; }
    if (sql.startsWith('SELECT COUNT')) return [[{ n: inserts }]];
    return [[]];
  }, async beginTransaction() { calls.push('BEGIN'); }, async commit() { calls.push('COMMIT'); }, async rollback() { calls.push('ROLLBACK'); } };
}

test('publisher commits complete snapshots and rolls back a failed replacement', async () => {
  const load = async () => ({ records: [sample, { ...sample, goalie_opp: 'Goalie C' }], modifiedAt: '2026-11-04T07:00:00Z' });
  const connection = fakeConnection();
  const result = await publish(connection, load);
  assert.match(connection.calls.find(sql => sql.startsWith('CREATE')), /`row_number` INT/);
  assert.match(connection.calls.find(sql => sql.startsWith('INSERT')), /\(`row_number`, `record_json`, `published_at`, `source_modified_at`\)/);
  assert.equal(result.rows, 2);
  assert.equal(result.games, 1);
  assert.ok(connection.calls.indexOf('BEGIN') < connection.calls.findIndex(sql => sql.startsWith('DELETE')));
  assert.ok(connection.calls.indexOf('COMMIT') > connection.calls.findIndex(sql => sql.startsWith('SELECT COUNT')));
  assert.ok(connection.calls.every(sql => !/TREVORFAIRS|UPCOMINGGAMES|FutureGames.csv/.test(sql)));
  const failure = fakeConnection(true);
  await assert.rejects(publish(failure, load), /simulated/);
  assert.ok(failure.calls.includes('ROLLBACK'));
  assert.ok(!failure.calls.includes('COMMIT'));
  assert.match(failure.calls.at(-1), /RELEASE_LOCK/);
});

test('empty accidental exports do not erase data; intentional empty snapshots carry metadata', async () => {
  const connection = fakeConnection();
  const load = async () => ({ records: [], modifiedAt: '2026-11-04T07:00:00Z' });
  await assert.rejects(publish(connection, load), /Empty export rejected/);
  assert.ok(!connection.calls.some(sql => sql.startsWith('DELETE')));
  assert.equal((await publish(fakeConnection(), load, { allowEmpty: true })).rows, 0);
});
