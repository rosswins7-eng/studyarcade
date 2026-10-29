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
    is_pro INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT, stripe_sub_id TEXT,
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
  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)`,
];

async function init() {
  for (const s of SCHEMA) await run(s);
  try { await run('ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN stripe_sub_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN avatar_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN frame_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN color_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN title_id TEXT'); } catch (e) { /* already exists */ }
  try { await run('ALTER TABLE users ADD COLUMN bio TEXT'); } catch (e) { /* already exists */ }
  await seed();
  await applyProgression();
}

// Keep the official library's module order matching seed/progression.json
// (basics -> advanced learning path), even for sets seeded by earlier builds.
async function applyProgression() {
  try {
    const prog = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'progression.json'), 'utf8'));
    const sys = await get('SELECT id FROM users WHERE email = ?', ['system@studyarcade']);
    if (!sys) return;
    for (const [subject, titles] of Object.entries(prog)) {
      for (let i = 0; i < titles.length; i++) {
        await run('UPDATE sets SET module_order = ? WHERE creator_id = ? AND subject = ? AND module = ?',
          [i + 1, sys.id, subject, titles[i]]);
      }
    }
  } catch (e) { console.log('Progression order skipped:', e.message); }
}

async function seed() {
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'library.json'), 'utf8'));
  let sys = await get('SELECT id FROM users WHERE email = ?', ['system@studyarcade']);
  if (!sys) {
    const r = await run("INSERT INTO users (name, email, pass_hash) VALUES ('StudyArcade', 'system@studyarcade', 'seed') RETURNING id");
    sys = norm(r)[0];
  }
  await run("UPDATE users SET name = 'StudyClash' WHERE email = 'system@studyarcade'", []);
  // Retire legacy seed subjects superseded by the library (system-created only).
  await run(`DELETE FROM sets WHERE creator_id = ? AND subject IN ('SAT Prep', 'Spanish 101')`, [sys.id]);
  const have = new Set((await all('SELECT subject, module FROM sets')).map((r) => r.subject + '||' + r.module));
  const orderBySubject = {};
  let added = 0;
  for (const s of lib) {
    const modName = s.title; // library uses title as the display module name
    if (have.has(s.subject + '||' + modName)) continue;
    if (!(s.subject in orderBySubject)) {
      const r = await get('SELECT COALESCE(MAX(module_order),0) AS m FROM sets WHERE subject = ?', [s.subject]);
      orderBySubject[s.subject] = r ? r.m : 0;
    }
    const order = ++orderBySubject[s.subject];
    await run(
      `INSERT INTO sets (title, subject, module, module_order, description, questions_json, rounds_json, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.title, s.subject, modName, order, s.description || '',
       JSON.stringify(s.questions), JSON.stringify(s.rounds || null), sys.id]);
    added++;
    console.log('Seeded:', s.subject, '-', modName);
  }
  if (added) console.log('Library seed: added', added, 'modules.');
}

module.exports = {
  init,
  getUserByEmail: (email) => get('SELECT * FROM users WHERE email = ?', [email]),
  getUserById: (id) => get('SELECT id, name, email, is_pro, xp, stripe_customer_id, stripe_sub_id, avatar_id, frame_id, color_id, title_id, bio, created_at FROM users WHERE id = ?', [id]),
  getUserByStripeCustomer: (customerId) =>
    customerId ? get('SELECT * FROM users WHERE stripe_customer_id = ?', [customerId]) : Promise.resolve(undefined),
  setUserPro: async (userId, isPro, customerId, subId) => {
    await run('UPDATE users SET is_pro = ? WHERE id = ?', [isPro ? 1 : 0, userId]);
    if (customerId) await run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, userId]);
    if (subId) await run('UPDATE users SET stripe_sub_id = ? WHERE id = ?', [subId, userId]);
  },
  countUserSets: async (userId) => {
    const r = await get('SELECT COUNT(*) AS c FROM sets WHERE creator_id = ?', [userId]);
    return r ? r.c : 0;
  },
  countGenRequestsSince: async (userId, isoDate) => {
    const r = await get('SELECT COUNT(*) AS c FROM generation_requests WHERE user_id = ? AND created_at >= ?', [userId, isoDate]);
    return r ? r.c : 0;
  },
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
    SELECT s.*, u.name AS creator_name, u.email AS creator_email FROM sets s LEFT JOIN users u ON u.id = s.creator_id WHERE s.id = ?`, [id]),
  getSetsByIds: (ids) => ids.length ? all(`
    SELECT s.*, u.name AS creator_name, u.email AS creator_email FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id IN (${ids.map(() => '?').join(',')})`, ids) : [],
  listSets: () => all(`
    SELECT s.*, u.name AS creator_name FROM sets s LEFT JOIN users u ON u.id = s.creator_id
    ORDER BY s.subject, s.module_order, s.id`),
  // Community: real users' sets only — excludes the official library (system@studyarcade seed user).
  listCommunity: () => all(`
    SELECT sets.id, sets.title, sets.subject, sets.module, sets.description, sets.plays, sets.created_at,
           users.name AS creator_name, sets.questions_json
    FROM sets LEFT JOIN users ON users.id = sets.creator_id
    WHERE sets.creator_id IS NOT NULL AND users.email <> 'system@studyarcade'
    ORDER BY sets.created_at DESC LIMIT 100`),
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
  deleteSet: async (id) => {
    await run('DELETE FROM scores WHERE set_id = ?', [id]);
    await run('DELETE FROM sets WHERE id = ?', [id]);
  },
  bumpPlays: (id) => run('UPDATE sets SET plays = plays + 1 WHERE id = ?', [id]),
  addScore: (setId, userId, game, score, accuracy) =>
    run('INSERT INTO scores (set_id, user_id, game, score, accuracy) VALUES (?, ?, ?, ?, ?)',
        [setId, userId, game, score, accuracy]),
  // Persistent session store (survives server restarts, unlike MemoryStore).
  getSession: (sid) => get('SELECT sid, sess, expires FROM sessions WHERE sid = ?', [sid]),
  setSession: (sid, sess, expires) =>
    run(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        [sid, sess, expires]),
  destroySession: (sid) => run('DELETE FROM sessions WHERE sid = ?', [sid]),
  clearExpiredSessions: () => run('DELETE FROM sessions WHERE expires <= ?', [Date.now()]),
  getLeaderboard: (setId, game) => all(`
    SELECT u.id AS user_id, u.name, u.email, u.xp, u.avatar_id, u.frame_id, u.color_id, u.title_id, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE s.set_id = ? AND s.game = ? GROUP BY s.user_id ORDER BY best DESC LIMIT 20`, [setId, game]),
  updateProfile: async (userId, fields) => {
    const OK = ['name', 'bio', 'avatar_id', 'frame_id', 'color_id', 'title_id'];
    const keys = Object.keys(fields).filter((k) => OK.includes(k));
    if (!keys.length) return;
    await run('UPDATE users SET ' + keys.map((k) => k + ' = ?').join(', ') + ' WHERE id = ?', [...keys.map((k) => fields[k]), userId]);
  },
  getUserStats: async (userId) => {
    const g = await get('SELECT COUNT(*) AS games, MAX(score) AS best_score FROM scores WHERE user_id = ?', [userId]);
    const c = await get('SELECT COUNT(*) AS sets_created FROM sets WHERE creator_id = ?', [userId]);
    return { games: (g && g.games) || 0, best_score: (g && g.best_score) || 0, sets_created: (c && c.sets_created) || 0 };
  },
  getLevelLeaders: (limit) => all(
    'SELECT id AS user_id, name, email, xp, is_pro, avatar_id, frame_id, color_id, title_id FROM users ORDER BY xp DESC LIMIT ?', [limit]),
  getUserRank: async (userId) => {
    const me = await get('SELECT xp FROM users WHERE id = ?', [userId]);
    if (!me) return null;
    const c = await get('SELECT COUNT(*) AS ahead FROM users WHERE xp > ?', [me.xp]);
    return { user_id: userId, rank: ((c && c.ahead) || 0) + 1, xp: me.xp };
  },
  getUserScores: (userId) => all(`
    SELECT s.set_id, st.title, st.subject, st.module, s.game, MAX(s.score) AS best, MAX(s.accuracy) AS acc
    FROM scores s JOIN sets st ON st.id = s.set_id
    WHERE s.user_id = ? GROUP BY s.set_id, s.game ORDER BY s.created_at DESC`, [userId]),
  getUserSets: (userId) =>
    all('SELECT sets.*, users.name AS creator_name FROM sets LEFT JOIN users ON users.id = sets.creator_id WHERE sets.creator_id = ? ORDER BY sets.created_at DESC', [userId]),
  addGenRequest: async (userId, subject, notes) => {
    const r = await run('INSERT INTO generation_requests (user_id, subject, notes) VALUES (?, ?, ?) RETURNING id',
                        [userId, subject, notes]);
    return { id: norm(r)[0].id };
  },
  addXp: async (userId, amount) => {
    await run('UPDATE users SET xp = xp + ? WHERE id = ?', [amount, userId]);
    const r = await get('SELECT xp FROM users WHERE id = ?', [userId]);
    return r ? r.xp : 0;
  },
};
