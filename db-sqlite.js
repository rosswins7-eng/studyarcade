// Local SQLite backend (node:sqlite) — used when TURSO_URL is not set.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'studyarcade.db');
const db = new DatabaseSync(DB_PATH);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  is_pro INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General',
  module TEXT NOT NULL DEFAULT 'Module 1',
  module_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  questions_json TEXT NOT NULL,
  rounds_json TEXT,
  creator_id INTEGER,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creator_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (set_id) REFERENCES sets(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  subject TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;

async function init() {
  db.exec(SCHEMA);
  const n = db.prepare('SELECT COUNT(*) AS n FROM sets').get().n;
  if (n === 0) await seed();
}

async function seed() {
  const seeds = ['psy361.json', 'sat-vocab.json', 'spanish101.json'];
  let sys = db.prepare('SELECT id FROM users WHERE email = ?').get('system@studyarcade');
  if (!sys) {
    db.prepare("INSERT INTO users (name, email, pass_hash) VALUES ('StudyArcade', 'system@studyarcade', 'seed')").run();
    sys = db.prepare('SELECT id FROM users WHERE email = ?').get('system@studyarcade');
  }
  const ins = db.prepare(`INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let order = 0;
  for (const f of seeds) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', f), 'utf8'));
    ins.run(s.title, s.subject, s.module || 'Module 1', ++order, s.description || '',
            JSON.stringify(s.questions), JSON.stringify(s.rounds || null), sys.id);
    console.log('Seeded:', s.subject, '-', s.module);
  }
}

const q = {
  getUserByEmail: async (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  getUserById: async (id) => db.prepare('SELECT id, name, email, is_pro FROM users WHERE id = ?').get(id),
  createUser: async (name, email, hash) =>
    ({ id: db.prepare('INSERT INTO users (name, email, pass_hash) VALUES (?, ?, ?)').run(name, email, hash).lastInsertRowid }),
  listSubjects: async () => db.prepare(`
    SELECT subject, COUNT(*) AS modules, SUM(json_array_length(questions_json)) AS questions, SUM(plays) AS plays
    FROM sets GROUP BY subject ORDER BY subject`).all(),
  getSubjectModules: async (subject) => db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.subject = ? ORDER BY s.module_order, s.id`).all(subject),
  getSet: async (id) => db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id WHERE s.id = ?`).get(id),
  getSetsByIds: async (ids) => ids.length ? db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [],
  listSets: async () => db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    ORDER BY s.subject, s.module_order, s.id`).all(),
  createSet: async (s) => ({
    id: db.prepare(`INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.title, s.subject, s.module, s.module_order, s.description, s.questionsJson, s.roundsJson, s.creatorId).lastInsertRowid }),
  maxModuleOrder: async (subject) =>
    db.prepare('SELECT COALESCE(MAX(module_order),0) AS m FROM sets WHERE subject = ?').get(subject).m,
  deleteSet: async (id) => { db.prepare('DELETE FROM sets WHERE id = ?').run(id); },
  bumpPlays: async (id) => { db.prepare('UPDATE sets SET plays = plays + 1 WHERE id = ?').run(id); },
  addScore: async (setId, userId, game, score, accuracy) => {
    db.prepare('INSERT INTO scores (set_id, user_id, game, score, accuracy) VALUES (?, ?, ?, ?, ?)')
      .run(setId, userId, game, score, accuracy);
  },
  getLeaderboard: async (setId, game) => db.prepare(`
    SELECT u.name, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE s.set_id = ? AND s.game = ? GROUP BY s.user_id ORDER BY best DESC LIMIT 20`).all(setId, game),
  getUserScores: async (userId) => db.prepare(`
    SELECT s.set_id, st.title, st.subject, st.module, s.game, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN sets st ON st.id = s.set_id
    WHERE s.user_id = ? GROUP BY s.set_id, s.game ORDER BY s.created_at DESC`).all(userId),
  getUserSets: async (userId) =>
    db.prepare('SELECT * FROM sets WHERE creator_id = ? ORDER BY created_at DESC').all(userId),
  addGenRequest: async (userId, subject, notes) => ({
    id: db.prepare('INSERT INTO generation_requests (user_id, subject, notes) VALUES (?, ?, ?)')
      .run(userId, subject, notes).lastInsertRowid }),
};

module.exports = { init, ...q };
