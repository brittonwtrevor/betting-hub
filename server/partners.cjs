const { randomUUID } = require('node:crypto');
const { mysqlOptions } = require('./lol.cjs');
const { normalizeTelegramChannel } = require('../src/features/partners/telegram');
const { fullSplitBps, splitError, splitToBps } = require('../src/features/partners/split');
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, partnerSafe: true });
function normalize(input, requireId = false) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw invalid('Enter a partner name (maximum 200 characters).');
  if ((requireId || input.id !== undefined) && (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))) throw invalid('Invalid partner ID.');
  if (input.telegramChannel !== undefined && (typeof input.telegramChannel !== 'string' || input.telegramChannel.length > 200)) throw invalid('Enter a valid Telegram channel.');
  let telegramChannel;
  try { telegramChannel = normalizeTelegramChannel(input.telegramChannel || ''); }
  catch (error) { throw invalid(error.message); }
  const splitBps = input.splitPercent === undefined ? undefined : splitToBps(input.splitPercent);
  if (splitBps === null) throw invalid(splitError);
  return { id: input.id, name: input.name.trim(), telegramChannel, splitBps };
}
const record = row => ({ id: row.id, name: row.name, telegramChannel: row.telegram_channel,
  splitPercent: row.split_bps / 100,
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
const paymentRecord = row => ({ id: row.id, partnerId: row.partner_id, direction: row.direction,
  amount: row.amount_cents / 100, reference: row.reference, date: row.recorded_at, status: 'Complete' });

function normalizePayment(input) {
  const { id, partnerId, direction, amount, reference = '' } = input || {};
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw invalid('Invalid payment ID.');
  if (typeof partnerId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(partnerId)) throw invalid('Choose a saved partner.');
  if (!['Sent', 'Received'].includes(direction)) throw invalid('Choose who paid whom.');
  const dollars = typeof amount === 'string' ? Number(amount) : 0;
  if (typeof amount !== 'string' || !/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount) || dollars < 0.01 || dollars > 10000000) {
    throw invalid('Enter an amount from $0.01 to $10,000,000 with at most two decimal places.');
  }
  if (typeof reference !== 'string' || reference.length > 200) throw invalid('Enter a reference of up to 200 characters.');
  return { id, partner_id: partnerId, direction, amount_cents: Math.round(dollars * 100), reference: reference.trim() };
}

function createPartnersService({ env = process.env, createPool, now = () => new Date(), makeId = randomUUID } = {}) {
  let pool, schema, paymentsSchema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) schema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_partners (
      id VARCHAR(100) NOT NULL PRIMARY KEY, name VARCHAR(200) NOT NULL,
      name_key VARCHAR(200) NOT NULL, telegram_channel VARCHAR(200) NOT NULL DEFAULT '',
      split_bps SMALLINT UNSIGNED NOT NULL DEFAULT 10000,
      revision INT NOT NULL DEFAULT 1, created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL,
      UNIQUE KEY partner_names (name_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const [columns] = await pool.query("SHOW COLUMNS FROM hub_partners LIKE 'split_bps'");
      if (!columns.length) {
        try { await pool.query('ALTER TABLE hub_partners ADD COLUMN split_bps SMALLINT UNSIGNED NOT NULL DEFAULT 10000'); }
        catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
      }
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_partner_aliases (
        legacy_id VARCHAR(100) NOT NULL PRIMARY KEY, partner_id VARCHAR(100) NOT NULL,
        INDEX partner_aliases (partner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error => { schema = null; throw error; });
    await schema;
    return pool;
  }
  async function paymentsDatabase() {
    const db = await database();
    if (!paymentsSchema) paymentsSchema = db.query(`CREATE TABLE IF NOT EXISTS hub_partner_payments (
      id CHAR(36) NOT NULL PRIMARY KEY, partner_id VARCHAR(100) NOT NULL,
      direction ENUM('Sent', 'Received') NOT NULL, amount_cents INT UNSIGNED NOT NULL,
      reference VARCHAR(200) NOT NULL, recorded_at VARCHAR(24) NOT NULL,
      INDEX partner_payment_dates (partner_id, recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(error => {
      paymentsSchema = null;
      throw error;
    });
    await paymentsSchema;
    return db;
  }
  async function transaction(work) {
    const connection = await (await database()).getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') throw invalid('A partner with that name or ID already exists. Refresh partners before trying again.', 409);
      throw error;
    } finally { connection.release(); }
  }
  async function insert(db, partner) {
    const at = now().toISOString();
    const id = partner.id || makeId();
    const splitBps = partner.splitBps ?? fullSplitBps;
    await db.execute('INSERT INTO hub_partners (id, name, name_key, telegram_channel, split_bps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, partner.name, partner.name.toLowerCase(), partner.telegramChannel, splitBps, at, at]);
    return { id, name: partner.name, telegramChannel: partner.telegramChannel, splitPercent: splitBps / 100, revision: 1, createdAt: at, updatedAt: at };
  }
  return {
    async listPayments() {
      const db = await paymentsDatabase();
      const [rows] = await db.query('SELECT * FROM hub_partner_payments ORDER BY recorded_at DESC, id DESC');
      return rows.map(paymentRecord);
    },
    async addPayment(input) {
      const payment = normalizePayment(input);
      const db = await paymentsDatabase();
      const recordedAt = now().toISOString();
      try {
        const [result] = await db.execute(`INSERT INTO hub_partner_payments (id, partner_id, direction, amount_cents, reference, recorded_at)
          SELECT ?, id, ?, ?, ?, ? FROM hub_partners WHERE CAST(id AS BINARY) = CAST(? AS BINARY)`,
        [payment.id, payment.direction, payment.amount_cents, payment.reference, recordedAt, payment.partner_id]);
        if (!result.affectedRows) throw invalid('This partner was not found. Refresh partners.', 404);
        return paymentRecord({ ...payment, recorded_at: recordedAt });
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        // A retry after a lost response returns the original receipt.
        const [[saved]] = await db.execute('SELECT * FROM hub_partner_payments WHERE id = ?', [payment.id]);
        if (saved && Object.keys(payment).every(key => payment[key] === saved[key])) return paymentRecord(saved);
        throw invalid('This payment was already saved with different details. Refresh partners to review it.', 409);
      }
    },
    async list() {
      const db = await database();
      const [rows] = await db.query('SELECT * FROM hub_partners ORDER BY name, id');
      const [aliases] = await db.query('SELECT legacy_id, partner_id FROM hub_partner_aliases');
      return rows.map(row => ({ ...record(row), legacyIds: aliases.filter(alias => alias.partner_id === row.id).map(alias => alias.legacy_id) }));
    },
    async add(input) {
      const partner = normalize(input);
      return transaction(async db => {
        if (partner.id) {
          const [[existing]] = await db.execute('SELECT * FROM hub_partners WHERE id = ? FOR UPDATE', [partner.id]);
          // Retrying a completed create is safe; it never edits the existing row.
          if (existing) {
            if (existing.name !== partner.name || existing.telegram_channel !== partner.telegramChannel ||
                (partner.splitBps !== undefined && existing.split_bps !== partner.splitBps)) {
              throw invalid('This partner ID is already saved. Refresh partners before editing.', 409);
            }
            return record(existing);
          }
        }
        return insert(db, partner);
      });
    },
    async update(id, input) {
      const partner = normalize(input);
      if (!Number.isInteger(input.revision)) throw invalid('Refresh partners before saving.');
      return transaction(async db => {
        const [[existing]] = await db.execute('SELECT * FROM hub_partners WHERE id = ? FOR UPDATE', [id]);
        if (!existing) throw invalid('This partner was not found. Refresh partners.', 404);
        if (existing.revision !== input.revision) throw invalid('This partner changed on another screen. Refresh partners before saving.', 409);
        const at = now().toISOString();
        const splitBps = partner.splitBps ?? existing.split_bps;
        await db.execute('UPDATE hub_partners SET name = ?, name_key = ?, telegram_channel = ?, split_bps = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          [partner.name, partner.name.toLowerCase(), partner.telegramChannel, splitBps, at, id]);
        return { id, name: partner.name, telegramChannel: partner.telegramChannel, splitPercent: splitBps / 100,
          revision: existing.revision + 1, createdAt: existing.created_at, updatedAt: at };
      });
    },
    async importLegacy(input) {
      if (!Array.isArray(input?.partners) || input.partners.length > 100) throw invalid('Import up to 100 saved partners at a time.');
      const partners = input.partners.map(partner => normalize(partner, true));
      return transaction(async db => {
        for (const partner of partners) {
          const [[existing]] = await db.execute('SELECT * FROM hub_partners WHERE id = ? FOR UPDATE', [partner.id]);
          // Browser backups must not overwrite newer server-side channel edits.
          if (existing) continue;
          const [[alias]] = await db.execute('SELECT legacy_id, partner_id FROM hub_partner_aliases WHERE legacy_id = ? FOR UPDATE', [partner.id]);
          if (alias) continue;
          const [[sameName]] = await db.execute('SELECT * FROM hub_partners WHERE name_key = ? FOR UPDATE', [partner.name.toLowerCase()]);
          if (sameName) {
            // Another browser may have assigned a different ID to this name.
            // Keep the central record and retain the old ID for historical joins.
            await db.execute('INSERT INTO hub_partner_aliases (legacy_id, partner_id) VALUES (?, ?)', [partner.id, sameName.id]);
          } else await insert(db, partner);
        }
        return { imported: true };
      });
    },
    async close() { if (pool) await pool.end(); },
  };
}
module.exports = { createPartnersService };
