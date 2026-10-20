// StudyArcade backend — Express. DB: Turso cloud when TURSO_URL set, else local SQLite.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
// Game registry: subjects null = available everywhere; otherwise list of subject names.
const GAMES = [
  { id: 'quiz', subjects: null },
  { id: 'asteroid', subjects: null },
  { id: 'match', subjects: null },
  { id: 'sort', subjects: null },
  { id: 'type', subjects: null },
  { id: 'memory', subjects: null },
];
const GAME_IDS = GAMES.map((g) => g.id);

// Level curve: reaching level n needs 50*n*(n-1) total XP.
const levelFor = (xp) => Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * (xp || 0))) / 2));
const xpForLevel = (n) => 50 * n * (n - 1);

app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'studyarcade-dev-secret-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

const authed = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in required.' });
  next();
};
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateQuestions(qs) {
  if (!Array.isArray(qs) || qs.length === 0 || qs.length > 500) return 'Add 1–500 questions.';
  for (const q of qs) {
    if (!q.q || !Array.isArray(q.options) || q.options.length !== 4 ||
        typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || !q.explain)
      return 'Each question needs text, 4 options, an answer index (0–3), and an explanation.';
  }
  return null;
}

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- auth ----------
app.post('/api/auth/register', ah(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (await db.getUserByEmail(email.toLowerCase()))
    return res.status(409).json({ error: 'That email is already registered. Try signing in.' });
  const u = await db.createUser(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10));
  req.session.userId = u.id;
  res.json({ id: u.id, name: name.trim(), email: email.toLowerCase() });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await db.getUserByEmail((email || '').toLowerCase());
  if (!u || u.pass_hash === 'seed' || !bcrypt.compareSync(password || '', u.pass_hash))
    return res.status(401).json({ error: 'Wrong email or password.' });
  req.session.userId = u.id;
  res.json({ id: u.id, name: u.name, email: u.email, is_pro: !!u.is_pro });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', ah(async (req, res) => {
  if (!req.session.userId) return res.json(null);
  const u = await db.getUserById(req.session.userId);
  res.json(u ? { ...u, is_pro: !!u.is_pro, level: levelFor(u.xp) } : null);
}));

// ---------- subjects & modules ----------
app.get('/api/subjects', ah(async (req, res) => res.json(await db.listSubjects())));

app.get('/api/subjects/:subject', ah(async (req, res) => {
  const rows = await db.getSubjectModules(req.params.subject);
  if (!rows.length) return res.status(404).json({ error: 'Subject not found.' });
  res.json({ subject: req.params.subject, modules: rows.map(db.publicSet) });
}));

app.get('/api/sets/combined', ah(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x)).filter(Boolean).slice(0, 20);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one module.' });
  const rows = await db.getSetsByIds(ids);
  if (!rows.length) return res.status(404).json({ error: 'No modules found.' });
  const questions = [], rounds = [], titles = [];
  for (const r of rows) {
    titles.push(r.module || r.title);
    const qs = JSON.parse(r.questions_json);
    const rr = r.rounds_json ? JSON.parse(r.rounds_json) : null;
    if (rr && rr.length) {
      for (const rnd of rr) rounds.push({ ...rnd, title: `${r.module || r.title} — ${rnd.title}` });
    } else {
      rounds.push({ tag: r.module || 'Module', title: r.title, desc: r.description || '', count: qs.length, boss: false });
    }
    questions.push(...qs);
  }
  res.json({ id: 'combined', title: titles.join(' + '), subject: rows[0].subject,
             module: titles.join(' + '), description: `Combined set: ${titles.join(', ')}`,
             questionCount: questions.length, rounds, questions, combinedIds: ids });
}));

app.get('/api/sets', ah(async (req, res) => res.json((await db.listSets()).map(db.publicSet))));

app.get('/api/sets/:id', ah(async (req, res) => {
  const row = await db.getSet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Set not found.' });
  await db.bumpPlays(req.params.id);
  const full = db.fullSet(row);
  full.combinedIds = [row.id];
  res.json(full);
}));

app.post('/api/sets', authed, ah(async (req, res) => {
  const { title, subject, module, description, questions, rounds } = req.body || {};
  if (!title || !subject) return res.status(400).json({ error: 'Title and subject are required.' });
  const err = validateQuestions(questions);
  if (err) return res.status(400).json({ error: err });
  let roundsJson = null;
  if (rounds && rounds.length) {
    const total = rounds.reduce((n, r) => n + (r.count || 0), 0);
    if (total !== questions.length) return res.status(400).json({ error: 'Round question counts must add up to the total.' });
    roundsJson = JSON.stringify(rounds);
  }
  const order = await db.maxModuleOrder(subject.trim());
  const r = await db.createSet({
    title: title.trim(), subject: subject.trim(), module: (module || 'Module 1').trim(),
    module_order: order + 1, description: description || '',
    questionsJson: JSON.stringify(questions), roundsJson, creatorId: req.session.userId,
  });
  res.json({ id: r.id });
}));

app.delete('/api/sets/:id', authed, ah(async (req, res) => {
  const row = await db.getSet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Set not found.' });
  if (row.creator_id !== req.session.userId) return res.status(403).json({ error: 'Only the creator can delete this.' });
  await db.deleteSet(req.params.id);
  res.json({ ok: true });
}));

// ---------- scores & leaderboards ----------
app.post('/api/sets/:id/scores', authed, ah(async (req, res) => {
  const { game, score, accuracy, setIds } = req.body || {};
  if (!GAME_IDS.includes(game)) return res.status(400).json({ error: 'Unknown game.' });
  const ids = (Array.isArray(setIds) && setIds.length ? setIds : [parseInt(req.params.id)])
    .map(Number).filter(Boolean).slice(0, 20);
  for (const id of ids) await db.addScore(id, req.session.userId, game, score | 0, +accuracy || 0);
  // XP + levels: 1 XP per 10 score points + 25 for finishing.
  const before = await db.getUserById(req.session.userId);
  const xpEarned = Math.floor((score | 0) / 10) + 25;
  const xp = await db.addXp(req.session.userId, xpEarned);
  const levelBefore = levelFor(before.xp), level = levelFor(xp);
  res.json({ ok: true, xp_earned: xpEarned, xp, level, leveled_up: level > levelBefore,
             xp_next: xpForLevel(level + 1) });
}));

app.get('/api/sets/:id/leaderboard', ah(async (req, res) => {
  const game = GAME_IDS.includes(req.query.game) ? req.query.game : 'asteroid';
  const rows = await db.getLeaderboard(req.params.id, game);
  res.json(rows.map((r) => ({ ...r, level: levelFor(r.xp) })));
}));

app.get('/api/me/scores', authed, ah(async (req, res) => res.json(await db.getUserScores(req.session.userId))));
app.get('/api/me/sets', authed, ah(async (req, res) => res.json((await db.getUserSets(req.session.userId)).map(db.publicSet))));

// ---------- AI generation requests ----------
app.post('/api/generate', authed, ah(async (req, res) => {
  const { subject, notes } = req.body || {};
  if (!subject || !notes || notes.trim().length < 50)
    return res.status(400).json({ error: 'Add a subject and paste at least a few sentences of notes.' });
  const r = await db.addGenRequest(req.session.userId, subject.trim(), notes.trim());
  res.json({ ok: true, id: r.id,
    message: 'Request saved! AI game generation is coming online soon — your set will appear in the library.' });
}));

// ---------- games registry ----------
app.get('/api/games', (req, res) => {
  res.json([
    { id: 'asteroid', title: 'Asteroid Destroyer', icon: '☄️', subjects: null,
      desc: 'Answers drift through space. Drag the correct one into the black hole to blow it up.' },
    { id: 'quiz', title: 'Quiz Boss Battle', icon: '⚡', subjects: null,
      desc: 'Rapid-fire quiz combat. 20 seconds a question, streaks multiply your score.' },
    { id: 'match', title: 'Match Pairs', icon: '🃏', subjects: null,
      desc: 'Flip the cards and match each term to its definition. Clear the board fast for big points.' },
    { id: 'sort', title: 'Sort Sprint', icon: '🗂️', subjects: null,
      desc: 'Items drop in — fling each one into the right category bin before time runs out. Made for the dental teeth set.' },
    { id: 'type', title: 'Type Attack', icon: '⌨️', subjects: null,
      desc: 'No multiple choice. Type the answer from memory before the clock runs out.' },
    { id: 'memory', title: 'Memory Match', icon: '🧩', subjects: null,
      desc: 'Flip the cards and clear the board by matching questions to their answers.' },
  ]);
});

// ---------- static frontend + PWA ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error.' }); });

db.init().then(() => {
  app.listen(PORT, () => console.log(`StudyArcade running on http://localhost:${PORT}`));
}).catch((e) => { console.error('DB init failed:', e.message); process.exit(1); });
