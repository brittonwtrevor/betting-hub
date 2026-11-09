const { mysqlOptions } = require('./lol.cjs');

const levels = ['Low', 'Medium', 'High'];
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, taskSafe: true });

function requiredText(value, label, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > limit) throw invalid(`Enter a ${label} of up to ${limit} characters.`);
  return text;
}

function normalizeTask(input) {
  const id = input?.id;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) {
    throw invalid('Invalid task ID.');
  }
  if (!levels.includes(input.importance)) throw invalid('Select an importance level.');
  if (!levels.includes(input.effort)) throw invalid('Select an effort level.');
  return {
    id,
    category: requiredText(input.category, 'category', 80),
    importance: input.importance,
    taskName: requiredText(input.taskName, 'task name', 200),
    sport: requiredText(input.sport, 'sport', 80),
    effort: input.effort,
  };
}

const taskColumns = 'id, category, importance, task_name AS taskName, sport, effort';

function createProjectTasksService({ env = process.env, createPool } = {}) {
  let pool, schema;

  async function database() {
    if (!pool) pool = (createPool || require('mysql2/promise').createPool)(mysqlOptions(env));
    if (!schema) {
      schema = pool.query(`CREATE TABLE IF NOT EXISTS hub_project_tasks (
        id CHAR(36) NOT NULL PRIMARY KEY,
        category VARCHAR(80) NOT NULL,
        importance VARCHAR(6) NOT NULL,
        task_name VARCHAR(200) NOT NULL,
        sport VARCHAR(80) NOT NULL,
        effort VARCHAR(6) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(error => {
        schema = null;
        throw error;
      });
    }
    await schema;
    return pool;
  }

  return {
    async list() {
      const db = await database();
      const [rows] = await db.query(`SELECT ${taskColumns} FROM hub_project_tasks ORDER BY created_at DESC, id DESC`);
      return rows;
    },
    async add(input) {
      const task = normalizeTask(input);
      const db = await database();
      try {
        await db.execute(
          'INSERT INTO hub_project_tasks (id, category, importance, task_name, sport, effort) VALUES (?, ?, ?, ?, ?, ?)',
          [task.id, task.category, task.importance, task.taskName, task.sport, task.effort],
        );
        return task;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        // A retry after a lost response must leave the original task intact.
        const [[saved]] = await db.execute(`SELECT ${taskColumns} FROM hub_project_tasks WHERE id = ?`, [task.id]);
        if (saved && Object.keys(task).every(key => task[key] === saved[key])) return saved;
        throw invalid('This task ID has already been saved. Refresh tasks and try again.', 409);
      }
    },
    async close() { if (pool) await pool.end(); },
  };
}

module.exports = { createProjectTasksService };
