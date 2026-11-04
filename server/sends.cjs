const { createHash, randomUUID } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');
const { allMarkets } = require('../src/features/bets/markets');
const invalid = message => Object.assign(new Error(message), { status: 400 });
function text(value, max = 200, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid('Invalid or missing draft field.');
  return value.trim();
}
function normalizeGame(raw) {
  if (!raw || raw.sport !== 'lol') throw invalid('Select a League of Legends game.');
  const game = { sport: 'lol' };
  for (const key of ['match_id', 'game_id']) game[key] = text(raw[key] == null ? '' : String(raw[key]), 100);
  if (!game.match_id && !game.game_id) throw invalid('This game has no match or game ID.');
  for (const key of ['team_a', 'team_b', 'league', 'begin_at']) game[key] = text(raw[key], 200, true);
  if (!Number.isFinite(Date.parse(game.begin_at.replace(' ', 'T')))) throw invalid('Invalid game start time.');
  game.series_format = ['BO1', 'BO3', 'BO5'].includes(raw.series_format) ? raw.series_format : null;
  for (const key of ['xgb_map1', 'bo3_price', 'bo5_price']) game[key] = Number.isFinite(raw[key]) && Math.abs(raw[key]) >= 100 ? raw[key] : null;
  for (const side of ['a', 'b']) for (const role of ['adc', 'sup', 'mid', 'jun', 'top']) game[`${side}_${role}`] = text(raw[`${side}_${role}`], 200);
  game.publishedAt = text(raw.publishedAt, 100);
  return game;
}
function gameKey(game) {
  return createHash('sha256').update(JSON.stringify([game.sport, game.match_id || `game:${game.game_id}`, game.team_a, game.team_b, ...['a', 'b'].flatMap(side => ['adc', 'sup', 'mid', 'jun', 'top'].map(role => game[`${side}_${role}`]))])).digest('hex');
}
function chooseMarkets(game, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 60 || ids.some(id => typeof id !== 'string')) throw invalid('Select at least one market.');
  const catalog = new Map(allMarkets(game).filter(market => market.available).map(market => [market.id, market]));
  return [...new Set(ids)].map(id => {
    const market = catalog.get(id);
    if (!market) throw invalid('A selected market is unavailable for this series.');
    return { id, label: market.label, fair: market.fair ?? null, needsLine: !!market.needsLine, line: market.line || '', playTo: '' };
  });
}
function editDraft(draft, input) {
  if (!input || !Array.isArray(input.markets) || !input.markets.length || input.markets.length > 60) throw invalid('Keep at least one market, or remove the card.');
  const current = new Map(draft.markets.map(market => [market.id, market]));
  const seen = new Set();
  const markets = input.markets.map(edit => {
    const existing = current.get(edit?.id);
    if (!existing || seen.has(edit.id)) throw invalid('Invalid or duplicate market.');
    seen.add(edit.id);
    const playTo = text(edit.playTo, 16);
    if (playTo && (!/^[+-]?\d+$/.test(playTo) || Math.abs(Number(playTo)) < 100 || Math.abs(Number(playTo)) > 1000000)) throw invalid(`Enter American odds of +100 or greater, or -100 or lower, for ${existing.label}.`);
    const line = existing.needsLine ? text(edit.line, 16) : existing.line;
    if (existing.needsLine && line && (!/^\d+(?:\.\d+)?$/.test(line) || Number(line) <= 0 || Number(line) > 1000)) throw invalid(`Enter a positive total for ${existing.label}.`);
    return { ...existing, playTo, line };
  });
  if (!Array.isArray(input.recipients) || input.recipients.length > 100) throw invalid('Invalid partners.');
  const recipients = input.recipients.map(partner => ({ id: text(partner?.id, 100, true), name: text(partner?.name, 200, true), telegramChannel: text(partner?.telegramChannel, 200) }));
  return { ...draft, markets, recipients, notes: text(input.notes, 2000) };
}
function createSendsService({ env = process.env, createPool, now = () => new Date(), makeId = randomUUID } = {}) {
  let pool;
  let schema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = pool.query(`CREATE TABLE IF NOT EXISTS hub_send_drafts (
      id VARCHAR(36) PRIMARY KEY, game_key CHAR(64) NOT NULL UNIQUE,
      revision INT NOT NULL DEFAULT 1, payload JSON NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    )`).catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  const decode = row => ({ ...(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload), revision: row.revision });
  async function transaction(work) {
    const db = await database();
    const connection = await db.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  return {
    async list() {
      const db = await database();
      const [rows] = await db.query('SELECT payload, revision FROM hub_send_drafts ORDER BY created_at DESC, id');
      return rows.map(decode);
    },
    async add(input) {
      const game = normalizeGame(input?.game);
      const selected = chooseMarkets(game, input?.marketIds);
      const key = gameKey(game);
      return transaction(async connection => {
        const draft = { id: makeId(), game, markets: selected, notes: '', recipients: [], status: 'draft', createdAt: now().toISOString(), updatedAt: now().toISOString() };
        await connection.execute('INSERT INTO hub_send_drafts (id, game_key, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE game_key = game_key', [draft.id, key, JSON.stringify(draft)]);
        const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE game_key = ? FOR UPDATE', [key]);
        const existing = decode(row);
        // Existing prices and publication snapshot stay intact when more markets are selected.
        const additions = chooseMarkets(existing.game, input.marketIds).filter(market => !existing.markets.some(old => old.id === market.id));
        if (!additions.length) return existing;
        const next = { ...existing, markets: [...existing.markets, ...additions], updatedAt: now().toISOString(), revision: existing.revision + 1 };
        await connection.execute('UPDATE hub_send_drafts SET payload = ?, revision = revision + 1 WHERE game_key = ?', [JSON.stringify(next), key]);
        return next;
      });
    },
    async update(id, input) {
      return transaction(async connection => {
        const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw Object.assign(new Error('This draft no longer exists. Refresh Sends.'), { status: 404 });
        if (input?.revision !== row.revision) throw Object.assign(new Error('This draft changed on another screen. Refresh Sends before editing again.'), { status: 409 });
        const next = { ...editDraft(decode(row), input), updatedAt: now().toISOString(), revision: row.revision + 1 };
        await connection.execute('UPDATE hub_send_drafts SET payload = ?, revision = revision + 1 WHERE id = ?', [JSON.stringify(next), id]);
        return next;
      });
    },
    async remove(id, revision) {
      if (!Number.isInteger(revision) || revision < 1) throw invalid('Refresh Sends before removing this draft.');
      const db = await database();
      const [result] = await db.execute('DELETE FROM hub_send_drafts WHERE id = ? AND revision = ?', [id, revision]);
      if (!result.affectedRows) throw Object.assign(new Error('This draft changed or was removed. Refresh Sends.'), { status: 409 });
    },
    async close() { if (pool) await pool.end(); },
  };
}
module.exports = { createSendsService, normalizeGame, chooseMarkets, editDraft, gameKey };
