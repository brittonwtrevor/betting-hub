const { mysqlOptions } = require('./lol.cjs');
const { splitToBps } = require('../src/features/partners/split');
const { lukeRows, capToCents } = require('../src/features/luke/lukeAllocation');
const fail = (message, status = 400) => Object.assign(new Error(message), { status, lukeSafe: true });

function createLukeOriginatorService({ env = process.env, confirmsService, createPool } = {}) {
  let pool, schema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_luke_settings (
        id TINYINT PRIMARY KEY, allocation_bps INT NOT NULL, revision INT NOT NULL DEFAULT 1,
        risk_win_cap_cents BIGINT NOT NULL DEFAULT 300000
      ) ENGINE=InnoDB`);
      const [columns] = await pool.query("SHOW COLUMNS FROM hub_luke_settings LIKE 'risk_win_cap_cents'");
      if (!columns.length) {
        try { await pool.query('ALTER TABLE hub_luke_settings ADD COLUMN risk_win_cap_cents BIGINT NOT NULL DEFAULT 300000'); }
        catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
      }
      await pool.query('INSERT IGNORE INTO hub_luke_settings (id, allocation_bps) VALUES (1, 4500)');
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_luke_settlements (
        bet_id CHAR(6) PRIMARY KEY, settled TINYINT NOT NULL DEFAULT 0,
        revision INT NOT NULL DEFAULT 1,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB`);
    })().catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function settings() {
    const db = await database();
    const [[row]] = await db.query('SELECT allocation_bps, risk_win_cap_cents, revision FROM hub_luke_settings WHERE id = 1');
    return { allocationPercent: row.allocation_bps / 100, riskWinCap: Number(row.risk_win_cap_cents) / 100, revision: row.revision };
  }
  return {
    async report() {
      const [config, bets] = await Promise.all([settings(), confirmsService.listReportBets({ includeOriginal: true, includeIncomplete: true })]);
      const db = await database();
      const [settlements] = await db.query('SELECT bet_id, settled, revision FROM hub_luke_settlements');
      const byBet = new Map(settlements.map(row => [row.bet_id, row]));
      return { settings: config, rows: lukeRows(bets, config.allocationPercent, config.riskWinCap).map(row => ({ ...row,
        settledWithLuke: Boolean(Number(byBet.get(row.betId)?.settled || 0)),
        settlementRevision: byBet.get(row.betId)?.revision ?? 0,
      })) };
    },
    async save(input) {
      const bps = splitToBps(input?.allocationPercent);
      if (bps == null) throw fail('Enter an allocation from 0% to 100% with up to two decimal places.');
      const capCents = capToCents(input?.riskWinCap);
      if (capCents == null) throw fail('Enter a risk / to-win cap greater than $0, up to $10,000,000, with at most two decimal places.');
      if (!Number.isInteger(input?.revision) || input.revision < 1) throw fail('Refresh Luke Originator before saving.');
      const db = await database();
      const [result] = await db.execute('UPDATE hub_luke_settings SET allocation_bps = ?, risk_win_cap_cents = ?, revision = revision + 1 WHERE id = 1 AND revision = ?', [bps, capCents, input.revision]);
      if (!result.affectedRows) throw fail('Luke’s settings changed on another screen. Refresh before saving.', 409);
      return { allocationPercent: bps / 100, riskWinCap: capCents / 100, revision: input.revision + 1 };
    },
    async setSettlement(betId, input) {
      if (!/^[A-Z]{3}\d{3}$/.test(betId) || typeof input?.settledWithLuke !== 'boolean' ||
          !Number.isInteger(input?.settlementRevision) || input.settlementRevision < 0) throw fail('Refresh Luke Originator before marking this Bet ID settled.');
      const db = await database();
      const conflict = () => fail('This Bet ID’s settlement check changed on another screen. Refresh before changing it.', 409);
      if (input.settlementRevision === 0) {
        try {
          await db.execute('INSERT INTO hub_luke_settlements (bet_id, settled) VALUES (?, ?)', [betId, Number(input.settledWithLuke)]);
        } catch (error) { if (error.code === 'ER_DUP_ENTRY') throw conflict(); throw error; }
      } else {
        const [result] = await db.execute('UPDATE hub_luke_settlements SET settled = ?, revision = revision + 1 WHERE bet_id = ? AND revision = ?',
          [Number(input.settledWithLuke), betId, input.settlementRevision]);
        if (!result.affectedRows) throw conflict();
      }
      return { betId, settledWithLuke: input.settledWithLuke, settlementRevision: input.settlementRevision + 1 };
    },
    async close() { if (pool) await pool.end(); },
  };
}

module.exports = { createLukeOriginatorService };
