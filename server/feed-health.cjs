const { mysqlOptions } = require('./lol.cjs');

const table = 'hub_feed_health';
const fields = ['status', 'duration_ms', 'records_seen', 'gaps', 'unit'];

function createFeedHealthService({ env = process.env, createPool, options } = {}) {
  let pool;
  let schema;
  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(options || mysqlOptions(env));
    if (!schema) {
      schema = pool.query({ sql: `CREATE TABLE IF NOT EXISTS ${table} (
        feed_id VARCHAR(64) PRIMARY KEY,
        last_run_at CHAR(24) NOT NULL, last_success_at CHAR(24) NOT NULL, last_data_at CHAR(24) NOT NULL,
        status VARCHAR(16) NOT NULL, duration_ms INT UNSIGNED NULL,
        records_seen INT UNSIGNED NULL, gaps INT UNSIGNED NULL, unit VARCHAR(24) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, timeout: 10000 }).catch(error => { schema = null; throw error; });
    }
    await schema;
    return pool;
  }
  return {
    async list() {
      const db = await database();
      const [rows] = await db.query({ sql: `SELECT * FROM ${table}`, timeout: 10000 });
      return rows.map(row => ({ id: row.feed_id, lastRunAt: row.last_run_at, lastSuccessAt: row.last_success_at || null,
        lastDataAt: row.last_data_at || null, status: row.status, durationMs: row.duration_ms,
        records: row.records_seen, gaps: row.gaps, unit: row.unit }));
    },
    async record(events) {
      if (!events.length) return;
      const db = await database();
      // Stable lock order for overlapping scraper/model writes. Replaying older
      // odds logs preserves a newer attempt and can recover its prior success.
      const values = [...events].sort((a, b) => a.id.localeCompare(b.id) || a.at.localeCompare(b.at)).map(event => [
        event.id, event.at, ['success', 'no_change'].includes(event.status) ? event.at : '', event.dataAt || '',
        event.status, event.durationMs ?? null, event.records ?? null, event.gaps ?? null, event.unit ?? null,
      ]);
      const update = fields.map(field => `${field} = IF(VALUES(last_run_at) >= last_run_at, VALUES(${field}), ${field})`).join(', ');
      await db.query({ sql: `INSERT INTO ${table} (feed_id, last_run_at, last_success_at, last_data_at, ${fields.join(', ')}) VALUES ?
        ON DUPLICATE KEY UPDATE last_success_at = GREATEST(last_success_at, VALUES(last_success_at)),
        last_data_at = GREATEST(last_data_at, VALUES(last_data_at)), ${update},
        last_run_at = GREATEST(last_run_at, VALUES(last_run_at))`, timeout: 10000 }, [values]);
    },
    async close() { if (pool) await pool.end(); },
  };
}
module.exports = { createFeedHealthService };
