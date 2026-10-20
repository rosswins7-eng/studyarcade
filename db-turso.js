// Turso (cloud SQLite) backend — used when TURSO_URL is set. Same async interface as db-sqlite.
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });

function norm(result) {
  return (result.rows || []).map((r) => {
    if (!Array.isArray(r)) return r;
    const o = {};
    (result.columns || []).forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}
async function get(sql, args = []) {
  const rows = norm(await client.execute({ sql, args }));
  return rows[0];
}
async function all(sql, args = []) {
  return norm(await client.execute({ sql, args }));
}
async function run(sql, args = []) {
  return client.execute({ sql, args });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
    is_pro INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, subject TEXT NOT NULL DEFAULT 'General',
    module TEXT NOT NULL DEFAULT 'Module 1', module_order INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '', questions_json TEXT NOT NULL, rounds_json TEXT,
    creator_id INTEGER, plays INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL, user_id INTEGER NOT NULL, game TEXT NOT NULL,
    score INTEGER NOT NULL, accuracy REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS generation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    subject TEXT NOT NULL, notes TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
];

async function init() {
  for (const s of SCHEMA) await run(s);
  const n = await get('SELECT COUNT(*) AS n FROM sets');
  if (!n || n.n === 0) await seed();
}

async function seed() {
  const seeds = ['psy361.json', 'sat-vocab.json', 'spanish101.json'];
  let sys = await get('SELECT id FROM users WHERE email = ?', ['system@studyarcade']);
  if (!sys) {
    const r = await run("INSERT INTO users (name, email, pass_hash) VALUES ('StudyArcade', 'system@studyarcade', 'seed') RETURNING id");
    sys = norm(r)[0];
  }
  let order = 0;
  for (const f of seeds) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', f), 'utf8'));
    await run(
      `INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.title, s.subject, s.module || 'Module 1', ++order, s.description || '',
       JSON.stringify(s.questions), JSON.stringify(s.rounds || null), sys.id]);
    console.log('Seeded:', s.subject, '-', s.module);
  }
}

module.exports = {
  init,
  getUserByEmail: (email) => get('SELECT * FROM users WHERE email = ?', [email]),
  getUserById: (id) => get('SELECT id, name, email, is_pro FROM users WHERE id = ?', [id]),
  createUser: async (name, email, hash) => {
    const r = await run('INSERT INTO users (name, email, pass_hash) VALUES (?, ?, ?) RETURNING id', [name, email, hash]);
    return { id: norm(r)[0].id };
  },
  listSubjects: () => all(`
    SELECT subject, COUNT(*) AS modules, SUM(json_array_length(questions_json)) AS questions, SUM(plays) AS plays
    FROM sets GROUP BY subject ORDER BY subject`),
  getSubjectModules: (subject) => all(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.subject = ? ORDER BY s.module_order, s.id`, [subject]),
  getSet: (id) => get(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id WHERE s.id = ?`, [id]),
  getSetsByIds: (ids) => ids.length ? all(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id IN (${ids.map(() => '?').join(',')})`, ids) : [],
  listSets: () => all(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    ORDER BY s.subject, s.module_order, s.id`),
  createSet: async (s) => {
    const r = await run(
      `INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [s.title, s.subject, s.module, s.module_order, s.description, s.questionsJson, s.roundsJson, s.creatorId]);
    return { id: norm(r)[0].id };
  },
  maxModuleOrder: async (subject) => {
    const r = await get('SELECT COALESCE(MAX(module_order),0) AS m FROM sets WHERE subject = ?', [subject]);
    return r ? r.m : 0;
  },
  deleteSet: (id) => run('DELETE FROM sets WHERE id = ?', [id]),
  bumpPlays: (id) => run('UPDATE sets SET plays = plays + 1 WHERE id = ?', [id]),
  addScore: (setId, userId, game, score, accuracy) =>
    run('INSERT INTO scores (set_id, user_id, game, score, accuracy) VALUES (?, ?, ?, ?, ?)',
        [setId, userId, game, score, accuracy]),
  getLeaderboard: (setId, game) => all(`
    SELECT u.name, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE s.set_id = ? AND s.game = ? GROUP BY s.user_id ORDER BY best DESC LIMIT 20`, [setId, game]),
  getUserScores: (userId) => all(`
    SELECT s.set_id, st.title, st.subject, st.module, s.game, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN sets st ON st.id = s.set_id
    WHERE s.user_id = ? GROUP BY s.set_id, s.game ORDER BY s.created_at DESC`, [userId]),
  getUserSets: (userId) =>
    all('SELECT * FROM sets WHERE creator_id = ? ORDER BY created_at DESC', [userId]),
  addGenRequest: async (userId, subject, notes) => {
    const r = await run('INSERT INTO generation_requests (user_id, subject, notes) VALUES (?, ?, ?) RETURNING id',
                        [userId, subject, notes]);
    return { id: norm(r)[0].id };
  },
};
