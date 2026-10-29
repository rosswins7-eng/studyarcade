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
  xp INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_sub_id TEXT,
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
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);`;

async function init() {
  db.exec(SCHEMA);
  try { db.exec('ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN stripe_sub_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN avatar_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN frame_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN color_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN title_id TEXT'); } catch (e) { /* column already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN bio TEXT'); } catch (e) { /* column already exists */ }
  await seed();
  applyProgression();
}

// Keep the official library's module order matching seed/progression.json
// (basics -> advanced learning path), even for sets seeded by earlier builds.
function applyProgression() {
  try {
    const prog = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'progression.json'), 'utf8'));
    const sys = db.prepare('SELECT id FROM users WHERE email = ?').get('system@studyarcade');
    if (!sys) return;
    const upd = db.prepare('UPDATE sets SET module_order = ? WHERE creator_id = ? AND subject = ? AND module = ?');
    for (const [subject, titles] of Object.entries(prog)) {
      titles.forEach((t, i) => upd.run(i + 1, sys.id, subject, t));
    }
  } catch (e) { console.log('Progression order skipped:', e.message); }
}

async function seed() {
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'library.json'), 'utf8'));
  let sys = db.prepare('SELECT id FROM users WHERE email = ?').get('system@studyarcade');
  if (!sys) {
    db.prepare("INSERT INTO users (name, email, pass_hash) VALUES ('StudyArcade', 'system@studyarcade', 'seed')").run();
    sys = db.prepare('SELECT id FROM users WHERE email = ?').get('system@studyarcade');
  }
  db.prepare("UPDATE users SET name = 'StudyClash' WHERE email = 'system@studyarcade'").run();
  // Retire legacy seed subjects superseded by the library (system-created only).
  db.prepare(`DELETE FROM sets WHERE creator_id = ? AND subject IN ('SAT Prep', 'Spanish 101')`).run(sys.id);
  const have = new Set(db.prepare('SELECT subject, module FROM sets').all()
    .map((r) => r.subject + '||' + r.module));
  const orderBySubject = {};
  const ins = db.prepare(`INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  for (const s of lib) {
    const modName = s.title; // library uses title as the display module name
    if (have.has(s.subject + '||' + modName)) continue;
    if (!(s.subject in orderBySubject)) {
      orderBySubject[s.subject] = db.prepare('SELECT COALESCE(MAX(module_order),0) AS m FROM sets WHERE subject = ?').get(s.subject).m;
    }
    const order = ++orderBySubject[s.subject];
    ins.run(s.title, s.subject, modName, order, s.description || '',
            JSON.stringify(s.questions), JSON.stringify(s.rounds || null), sys.id);
    added++;
    console.log('Seeded:', s.subject, '-', modName);
  }
  if (added) console.log('Library seed: added', added, 'modules.');
}

const q = {
  getUserByEmail: async (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  getUserById: async (id) => db.prepare('SELECT id, name, email, is_pro, xp, stripe_customer_id, stripe_sub_id, avatar_id, frame_id, color_id, title_id, bio, created_at FROM users WHERE id = ?').get(id),
  getUserByStripeCustomer: async (customerId) =>
    customerId ? db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId) : undefined,
  setUserPro: async (userId, isPro, customerId, subId) => {
    db.prepare('UPDATE users SET is_pro = ? WHERE id = ?').run(isPro ? 1 : 0, userId);
    if (customerId) db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
    if (subId) db.prepare('UPDATE users SET stripe_sub_id = ? WHERE id = ?').run(subId, userId);
  },
  countUserSets: async (userId) =>
    db.prepare('SELECT COUNT(*) AS c FROM sets WHERE creator_id = ?').get(userId).c,
  countGenRequestsSince: async (userId, isoDate) =>
    db.prepare('SELECT COUNT(*) AS c FROM generation_requests WHERE user_id = ? AND created_at >= ?').get(userId, isoDate).c,
  createUser: async (name, email, hash) =>
    ({ id: db.prepare('INSERT INTO users (name, email, pass_hash) VALUES (?, ?, ?)').run(name, email, hash).lastInsertRowid }),
  listSubjects: async () => db.prepare(`
    SELECT subject, COUNT(*) AS modules, SUM(json_array_length(questions_json)) AS questions, SUM(plays) AS plays
    FROM sets GROUP BY subject ORDER BY subject`).all(),
  getSubjectModules: async (subject) => db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.subject = ? ORDER BY s.module_order, s.id`).all(subject),
  getSet: async (id) => db.prepare(`
    SELECT s.*, u.name AS creator_name, u.email AS creator_email FROM sets s LEFT JOIN users u ON u.id = s.creator_id WHERE s.id = ?`).get(id),
  getSetsByIds: async (ids) => ids.length ? db.prepare(`
    SELECT s.*, u.name AS creator_name, u.email AS creator_email FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [],
  listSets: async () => db.prepare(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    ORDER BY s.subject, s.module_order, s.id`).all(),
  // Community: real users' sets only — excludes the official library (system@studyarcade seed user).
  listCommunity: async () => db.prepare(`
    SELECT sets.id, sets.title, sets.subject, sets.module, sets.description, sets.plays, sets.created_at,
           users.name AS creator_name, sets.questions_json
    FROM sets LEFT JOIN users ON users.id = sets.creator_id
    WHERE sets.creator_id IS NOT NULL AND users.email <> 'system@studyarcade'
    ORDER BY sets.created_at DESC LIMIT 100`).all(),
  createSet: async (s) => ({
    id: db.prepare(`INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.title, s.subject, s.module, s.module_order, s.description, s.questionsJson, s.roundsJson, s.creatorId).lastInsertRowid }),
  maxModuleOrder: async (subject) =>
    db.prepare('SELECT COALESCE(MAX(module_order),0) AS m FROM sets WHERE subject = ?').get(subject).m,
  deleteSet: async (id) => {
    db.prepare('DELETE FROM scores WHERE set_id = ?').run(id);
    db.prepare('DELETE FROM sets WHERE id = ?').run(id);
  },
  bumpPlays: async (id) => { db.prepare('UPDATE sets SET plays = plays + 1 WHERE id = ?').run(id); },
  addScore: async (setId, userId, game, score, accuracy) => {
    db.prepare('INSERT INTO scores (set_id, user_id, game, score, accuracy) VALUES (?, ?, ?, ?, ?)')
      .run(setId, userId, game, score, accuracy);
  },
  // Persistent session store (survives server restarts, unlike MemoryStore).
  getSession: async (sid) => db.prepare('SELECT sid, sess, expires FROM sessions WHERE sid = ?').get(sid),
  setSession: async (sid, sess, expires) =>
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)').run(sid, sess, expires),
  destroySession: async (sid) => { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); },
  clearExpiredSessions: async () => { db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now()); },
  getLeaderboard: async (setId, game) => db.prepare(`
    SELECT u.id AS user_id, u.name, u.xp, u.avatar_id, u.frame_id, u.color_id, u.title_id, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE s.set_id = ? AND s.game = ? GROUP BY s.user_id ORDER BY best DESC LIMIT 20`).all(setId, game),
  updateProfile: async (userId, fields) => {
    const OK = ['name', 'bio', 'avatar_id', 'frame_id', 'color_id', 'title_id'];
    const keys = Object.keys(fields).filter((k) => OK.includes(k));
    if (!keys.length) return;
    db.prepare('UPDATE users SET ' + keys.map((k) => k + ' = ?').join(', ') + ' WHERE id = ?')
      .run(...keys.map((k) => fields[k]), userId);
  },
  getUserStats: async (userId) => {
    const g = db.prepare('SELECT COUNT(*) AS games, MAX(score) AS best_score FROM scores WHERE user_id = ?').get(userId);
    const c = db.prepare('SELECT COUNT(*) AS sets_created FROM sets WHERE creator_id = ?').get(userId);
    return { games: g.games || 0, best_score: g.best_score || 0, sets_created: c.sets_created || 0 };
  },
  getUserScores: async (userId) => db.prepare(`
    SELECT s.set_id, st.title, st.subject, st.module, s.game, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN sets st ON st.id = s.set_id
    WHERE s.user_id = ? GROUP BY s.set_id, s.game ORDER BY s.created_at DESC`).all(userId),
  getUserSets: async (userId) =>
    db.prepare('SELECT sets.*, users.name AS creator_name FROM sets LEFT JOIN users ON users.id = sets.creator_id WHERE sets.creator_id = ? ORDER BY sets.created_at DESC').all(userId),
  addGenRequest: async (userId, subject, notes) => ({
    id: db.prepare('INSERT INTO generation_requests (user_id, subject, notes) VALUES (?, ?, ?)')
      .run(userId, subject, notes).lastInsertRowid }),
  addXp: async (userId, amount) => {
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
    return db.prepare('SELECT xp FROM users WHERE id = ?').get(userId).xp;
  },
};

module.exports = { init, ...q };
