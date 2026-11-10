const { createHash, randomUUID, randomInt } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');
const { allMarkets, gameDescription } = require('../src/features/bets/markets');
const { chatId } = require('./telegram.cjs');
const invalid = message => Object.assign(new Error(message), { status: 400 });
function text(value, max = 200, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid('Invalid or missing draft field.');
  return value.trim();
}
function normalizeGame(raw) {
  if (!raw || !['lol', 'hockey'].includes(raw.sport)) throw invalid('Select a supported game.');
  const game = { sport: raw.sport };
  for (const key of ['match_id', 'game_id']) game[key] = text(raw[key] == null ? '' : String(raw[key]), 100);
  if (!game.match_id && !game.game_id) throw invalid('This game has no match or game ID.');
  for (const key of ['team_a', 'team_b', 'league', 'begin_at']) game[key] = text(raw[key], 200, true);
  if (!Number.isFinite(Date.parse(game.begin_at.replace(' ', 'T')))) throw invalid('Invalid game start time.');
  if (game.sport === 'hockey') {
    for (const key of ['winoddsfulltime', 'away_winoddsfulltime']) game[key] = Number.isFinite(raw[key]) && Math.abs(raw[key]) >= 100 ? raw[key] : null;
    for (const period of ['full_game', 'reg_time']) for (const direction of ['o', 'u']) for (let line = 4; line <= 8; line += 0.5) {
      const key = `${period}_${direction}${line}`;
      game[key] = Number.isFinite(raw[key]) && Math.abs(raw[key]) >= 100 ? raw[key] : null;
    }
    for (const key of ['reg_time_home_win_prob', 'reg_time_draw_prob', 'reg_time_away_win_prob']) game[key] = Number.isFinite(raw[key]) && raw[key] >= 0 && raw[key] <= 1 ? raw[key] : null;
    for (const key of ['goalie_team', 'goalie_opp']) game[key] = text(raw[key] == null ? '' : String(raw[key]), 200);
    game.publishedAt = text(raw.publishedAt, 100);
    return game;
  }
  game.series_format = ['BO1', 'BO3', 'BO5'].includes(raw.series_format) ? raw.series_format : null;
  for (const key of ['xgb_map1', 'bo3_price', 'bo5_price']) game[key] = Number.isFinite(raw[key]) && Math.abs(raw[key]) >= 100 ? raw[key] : null;
  for (const side of ['a', 'b']) for (const role of ['adc', 'sup', 'mid', 'jun', 'top']) game[`${side}_${role}`] = text(raw[`${side}_${role}`], 200);
  game.publishedAt = text(raw.publishedAt, 100);
  return game;
}
function gameKey(game) {
  if (game.sport === 'hockey') return createHash('sha256').update(JSON.stringify([game.sport, game.match_id || `game:${game.game_id}`, game.team_a, game.team_b, game.goalie_team, game.goalie_opp])).digest('hex');
  return createHash('sha256').update(JSON.stringify([game.sport, game.match_id || `game:${game.game_id}`, game.team_a, game.team_b, ...['a', 'b'].flatMap(side => ['adc', 'sup', 'mid', 'jun', 'top'].map(role => game[`${side}_${role}`]))])).digest('hex');
}
function chooseMarkets(game, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 60 || ids.some(id => typeof id !== 'string')) throw invalid('Select at least one market.');
  const catalog = new Map(allMarkets(game).filter(market => market.available).map(market => [market.id, market]));
  return [...new Set(ids)].map(id => {
    const market = catalog.get(id);
    if (!market) throw invalid('A selected market is unavailable for this game.');
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
function teamPrefix(draft) {
  const side = draft.markets.find(market => /^[ab]:/.test(market.id))?.id[0] || 'a';
  return draft.game[`team_${side}`].normalize('NFKD').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3).padEnd(3, 'X');
}
function telegramText(draft, { includeGoalies = false } = {}) {
  for (const market of draft.markets) {
    if (!market.playTo) throw invalid(`Enter a play-to price for ${market.label} before sending.`);
    if (market.needsLine && !market.line) throw invalid(`Enter a total for ${market.label} before sending.`);
  }
  const timestamp = draft.game.begin_at.trim().replace(' ', 'T');
  const start = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`);
  const when = start.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const message = [
    `Bet ID: ${draft.betId}`,
    `${draft.game.team_a} vs ${draft.game.team_b}`,
    `${gameDescription(draft.game, { includeGoalies })} · ${when}`,
    '',
    ...draft.markets.map(market => `• ${market.label}${market.needsLine ? ` ${market.line}` : ''} · Play to ${Number(market.playTo) > 0 ? '+' : ''}${Number(market.playTo)}`),
    ...(draft.notes ? ['', `Notes: ${draft.notes}`] : []),
  ].join('\n');
  if (!includeGoalies && message.length > 4096) throw invalid('This card exceeds Telegram’s 4,096-character limit. Shorten the notes or remove some markets.');
  return message;
}
function requireIdle(draft) {
  if (draft.deliveries?.some(delivery => delivery.status === 'sending')) throw Object.assign(new Error('A Telegram send is in progress or awaiting delivery confirmation. Refresh Sends and check the partner chat.'), { status: 409 });
}
function createSendsService({ env = process.env, createPool, now = () => new Date(), makeId = randomUUID, numberStart = () => randomInt(1000) } = {}) {
  let pool;
  let schema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_send_drafts (
      id VARCHAR(36) PRIMARY KEY, game_key CHAR(64) NOT NULL UNIQUE,
      revision INT NOT NULL DEFAULT 1, payload JSON NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`);
      // Keep reservations after a card is removed so an old reply cannot identify a new send.
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_send_ids (
        bet_id CHAR(6) PRIMARY KEY, draft_id VARCHAR(36) NOT NULL UNIQUE
      )`);
    })().catch(error => { schema = null; throw error; });
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
  async function identify(connection, draft) {
    if (draft.betId) return draft;
    const [[reserved]] = await connection.execute('SELECT bet_id FROM hub_send_ids WHERE draft_id = ?', [draft.id]);
    let betId = reserved?.bet_id;
    const prefix = teamPrefix(draft);
    const start = numberStart();
    for (let offset = 0; !betId && offset < 1000; offset++) {
      const candidate = `${prefix}${String((start + offset) % 1000).padStart(3, '0')}`;
      try {
        await connection.execute('INSERT INTO hub_send_ids (bet_id, draft_id) VALUES (?, ?)', [candidate, draft.id]);
        betId = candidate;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    if (!betId) throw Object.assign(new Error(`All 1,000 send IDs for ${prefix} have been used.`), { status: 409 });
    const next = { ...draft, betId };
    // Assigning metadata leaves the editable draft revision intact.
    await connection.execute('UPDATE hub_send_drafts SET payload = ? WHERE id = ?', [JSON.stringify(next), draft.id]);
    return next;
  }
  return {
    async findByBetIds(ids) {
      if (!ids.length) return [];
      const db = await database();
      const [rows] = await db.execute(`SELECT ids.bet_id, ids.draft_id, drafts.payload
        FROM hub_send_ids ids LEFT JOIN hub_send_drafts drafts ON drafts.id = ids.draft_id
        WHERE ids.bet_id IN (${ids.map(() => '?').join(', ')})`, ids);
      return rows.map(row => ({ betId: row.bet_id, draftId: row.draft_id,
        context: row.payload == null ? null : typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload }));
    },
    async list() {
      const db = await database();
      const [rows] = await db.query('SELECT payload, revision FROM hub_send_drafts ORDER BY created_at DESC, id');
      const drafts = [];
      for (const row of rows) {
        const draft = decode(row);
        if (draft.betId) drafts.push(draft);
        else {
          const identified = await transaction(async connection => {
            const [[current]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE id = ? FOR UPDATE', [draft.id]);
            return current ? identify(connection, decode(current)) : null;
          });
          if (identified) drafts.push(identified);
        }
      }
      return drafts;
    },
    async add(input) {
      const game = normalizeGame(input?.game);
      const selected = chooseMarkets(game, input?.marketIds);
      const key = gameKey(game);
      return transaction(async connection => {
        const draft = { id: makeId(), game, markets: selected, notes: '', recipients: [], status: 'draft', createdAt: now().toISOString(), updatedAt: now().toISOString() };
        await connection.execute('INSERT INTO hub_send_drafts (id, game_key, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE game_key = game_key', [draft.id, key, JSON.stringify(draft)]);
        const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE game_key = ? FOR UPDATE', [key]);
        const existing = await identify(connection, decode(row));
        requireIdle(existing);
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
        requireIdle(decode(row));
        const next = { ...editDraft(await identify(connection, decode(row)), input), updatedAt: now().toISOString(), revision: row.revision + 1 };
        await connection.execute('UPDATE hub_send_drafts SET payload = ?, revision = revision + 1 WHERE id = ?', [JSON.stringify(next), id]);
        return next;
      });
    },
    async send(id, input, telegram) {
      if (!telegram) throw invalid('Configure the Telegram bot in DigitalOcean runtime settings first.');
      // Reserve delivery in a committed transaction before contacting Telegram. The
      // fingerprint prevents repeat clicks/retries from duplicating confirmed sends.
      const prepared = await transaction(async connection => {
        const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE id = ? FOR UPDATE', [id]);
        if (!row) throw Object.assign(new Error('This draft no longer exists. Refresh Sends.'), { status: 404 });
        if (input?.revision !== row.revision) throw Object.assign(new Error('This draft changed on another screen. Refresh Sends before sending.'), { status: 409 });
        requireIdle(decode(row));
        const next = editDraft(await identify(connection, decode(row)), input);
        if (!next.recipients.length) throw invalid('Select at least one partner / Telegram group before sending.');
        const destinations = new Map();
        for (const partner of next.recipients) {
          let channel;
          try { channel = chatId(partner.telegramChannel); }
          catch { throw invalid(`Add a numeric Telegram chat ID or public @channel for ${partner.name} in Partner Accounting. Invite links cannot receive messages.`); }
          destinations.set(channel.toLowerCase(), { name: partner.name, channel });
        }
        const message = telegramText(next);
        // Keep the original hockey delivery key so this formatting change cannot resend an existing delivery.
        const fingerprintText = next.game.sport === 'hockey' ? telegramText(next, { includeGoalies: true }) : message;
        const fingerprint = createHash('sha256').update(fingerprintText).digest('hex');
        const deliveries = [...(next.deliveries || [])];
        const pending = [];
        for (const { name, channel } of destinations.values()) {
          const key = createHash('sha256').update(`${channel.toLowerCase()}\n${fingerprint}`).digest('hex');
          const previous = deliveries.find(delivery => delivery.key === key);
          if (previous?.status === 'sent' || previous?.status === 'uncertain') continue;
          const delivery = { key, name, channel, status: 'sending', attemptedAt: now().toISOString() };
          if (previous) deliveries.splice(deliveries.indexOf(previous), 1, delivery);
          else deliveries.push(delivery);
          pending.push(delivery);
        }
        const draft = { ...next, deliveries, updatedAt: now().toISOString(), revision: row.revision + 1 };
        await connection.execute('UPDATE hub_send_drafts SET payload = ?, revision = revision + 1 WHERE id = ?', [JSON.stringify(draft), id]);
        return { draft, pending, message };
      });
      let draft = prepared.draft;
      for (const delivery of prepared.pending) {
        let outcome;
        try {
          const result = await telegram.sendMessage({ chatId: delivery.channel, text: prepared.message });
          outcome = { status: 'sent', sentAt: now().toISOString(), messageId: result.message.messageId, ...(result.message.chatId ? { chatId: String(result.message.chatId) } : {}) };
        } catch (error) {
          outcome = { status: error.deliveryUncertain || !error.telegramSafe ? 'uncertain' : 'failed', error: error.telegramSafe ? error.message : 'Delivery could not be confirmed. Check the partner chat before sending again.' };
        }
        draft = await transaction(async connection => {
          const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE id = ? FOR UPDATE', [id]);
          if (!row) throw Object.assign(new Error('Delivery may have completed. Check Telegram before sending again.'), { status: 409 });
          const current = decode(row);
          const next = { ...current, deliveries: current.deliveries.map(item => item.key === delivery.key ? { ...item, ...outcome } : item), revision: row.revision + 1 };
          await connection.execute('UPDATE hub_send_drafts SET payload = ?, revision = revision + 1 WHERE id = ?', [JSON.stringify(next), id]);
          return next;
        });
      }
      return draft;
    },
    async remove(id, revision) {
      if (!Number.isInteger(revision) || revision < 1) throw invalid('Refresh Sends before removing this draft.');
      await transaction(async connection => {
        const [[row]] = await connection.execute('SELECT payload, revision FROM hub_send_drafts WHERE id = ? FOR UPDATE', [id]);
        if (!row || row.revision !== revision) throw Object.assign(new Error('This draft changed or was removed. Refresh Sends.'), { status: 409 });
        requireIdle(decode(row));
        await connection.execute('DELETE FROM hub_send_drafts WHERE id = ? AND revision = ?', [id, revision]);
      });
    },
    async close() { if (pool) await pool.end(); },
  };
}
module.exports = { createSendsService, normalizeGame, chooseMarkets, editDraft, gameKey, teamPrefix, telegramText };
