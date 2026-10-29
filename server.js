// StudyArcade backend — Express. DB: Turso cloud when TURSO_URL set, else local SQLite.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ---------- Stripe (lazy — boot never crashes without keys) ----------
// Keys come ONLY from env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
// STRIPE_WEBHOOK_SECRET, PUBLIC_URL. Never hardcode them.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    if (!getStripe._client) getStripe._client = require('stripe')(key);
    return getStripe._client;
  } catch (e) { console.error('Stripe init failed:', e.message); return null; }
}
const paymentsNotLive = (res) => res.status(503).json({ error: 'Payments are not live yet.' });

// Owner comp: these accounts always have Pro, regardless of subscription
// state. Stripe webhooks must never revoke them (see setProSafe below).
const LIFETIME_PRO_EMAILS = new Set(['rosswins7@gmail.com', 'rosswins77@gmail.com']);
const userIsPro = (u) => !!(u && (u.is_pro || LIFETIME_PRO_EMAILS.has((u.email || '').toLowerCase())));
const setProSafe = (db, target, val, customerId, subId) =>
  db.setUserPro(target.id, LIFETIME_PRO_EMAILS.has((target.email || '').toLowerCase()) ? true : val, customerId, subId);

// Stripe webhook MUST see the raw body for signature verification, so this
// route (with express.raw) is registered BEFORE express.json() below.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // Without keys/secret a signature can never verify — reject like a bad signature.
  if (!stripe || !secret) return res.status(400).json({ error: 'Webhook is not configured.' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.error('Stripe webhook signature failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  try {
    const obj = event.data.object || {};
    if (event.type === 'checkout.session.completed') {
      const userId = parseInt(obj.client_reference_id || (obj.metadata && obj.metadata.userId) || '');
      const customerId = obj.customer || null;
      const subId = obj.subscription || null;
      let target = userId ? await db.getUserById(userId) : null;
      if (!target && customerId) target = await db.getUserByStripeCustomer(customerId);
      if (target) {
        let isPro = true; // a completed subscription checkout = paid
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            isPro = sub.status === 'active' || sub.status === 'trialing';
          } catch (e) { /* keep completed-checkout default */ }
        }
        await setProSafe(db, target, isPro, customerId, subId);
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const isPro = obj.status === 'active' || obj.status === 'trialing';
      const target = await db.getUserByStripeCustomer(obj.customer);
      if (target) await setProSafe(db, target, isPro, obj.customer, obj.id);
    } else if (event.type === 'customer.subscription.deleted') {
      const target = await db.getUserByStripeCustomer(obj.customer);
      if (target) await setProSafe(db, target, false, obj.customer, obj.id);
    }
  } catch (e) { console.error('Stripe webhook handling failed:', e); return res.status(500).json({ error: 'Webhook handling failed.' }); }
  res.json({ received: true });
});
// Game registry: subjects null = available everywhere; otherwise list of subject names.
const GAMES = [
  { id: 'quiz', subjects: null },
  { id: 'asteroid', subjects: null },
  { id: 'galaga', subjects: null },
  { id: 'match', subjects: null },
  { id: 'sort', subjects: null },
  { id: 'type', subjects: null },
  { id: 'pop', subjects: null },
  { id: 'speed', subjects: null },
];
const GAME_IDS = GAMES.map((g) => g.id);

// Level curve: reaching level n needs 50*n*(n-1) total XP.
const levelFor = (xp) => Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * (xp || 0))) / 2));
const xpForLevel = (n) => 50 * n * (n - 1);

app.use(express.json({ limit: '2mb' }));
// DB-backed session store: sessions survive server restarts (Render redeploys,
// free-tier sleep/wake cycles) instead of dying with the in-memory store.
class DbSessionStore extends session.Store {
  get(sid, cb) {
    db.getSession(sid).then((row) => {
      if (!row || row.expires <= Date.now()) return cb(null, null);
      try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); }
    }).catch(cb);
  }
  set(sid, sess, cb) {
    const expires = (sess.cookie && sess.cookie.expires)
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 30 * 24 * 3600 * 1000;
    db.setSession(sid, JSON.stringify(sess), expires).then(() => cb && cb()).catch(cb);
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb) { db.destroySession(sid).then(() => cb && cb()).catch(cb); }
}
app.use(session({
  store: new DbSessionStore(db),
  secret: process.env.SESSION_SECRET || 'studyarcade-dev-secret-change-me',
  resave: false, saveUninitialized: false,
  cookie: {
    httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));
// Sweep expired sessions hourly so the table doesn't grow forever.
setInterval(() => db.clearExpiredSessions().catch(() => {}), 3600 * 1000);

const authed = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in required.' });
  next();
};
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Pro gating ----------
// Official library = seeded by the system user (system@studyarcade) or legacy
// creator_id NULL. A user's own sets and community sets are NEVER gated.
const isOfficialSet = (row) => !row.creator_id || row.creator_email === 'system@studyarcade';
const proRequired = (res, message) => res.status(402).json({
  error: 'pro_required',
  message: message || 'This is a StudyClash Pro feature. Go Pro for $3.99/mo to unlock it.',
});
async function viewerIsPro(req) {
  if (!req.session.userId) return false;
  const u = await db.getUserById(req.session.userId);
  return userIsPro(u);
}
function monthStartIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-01 00:00:00`;
}

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
  res.json({ id: u.id, name: name.trim(), email: email.toLowerCase(), xp: 0, level: 1, is_pro: false });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await db.getUserByEmail((email || '').toLowerCase());
  if (!u || u.pass_hash === 'seed' || !bcrypt.compareSync(password || '', u.pass_hash))
    return res.status(401).json({ error: 'Wrong email or password.' });
  req.session.userId = u.id;
  res.json({ id: u.id, name: u.name, email: u.email, is_pro: userIsPro(u), xp: u.xp || 0, level: levelFor(u.xp) });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', ah(async (req, res) => {
  if (!req.session.userId) return res.json(null);
  const u = await db.getUserById(req.session.userId);
  // Explicit shape (never leaks stripe ids): same fields login/register return.
  res.json(u ? { id: u.id, name: u.name, email: u.email, is_pro: userIsPro(u), xp: u.xp || 0, level: levelFor(u.xp) } : null);
}));

// ---------- billing ----------
app.post('/api/billing/checkout', authed, ah(async (req, res) => {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!stripe || !priceId) return paymentsNotLive(res);
  const u = await db.getUserById(req.session.userId);
  if (!u) return res.status(401).json({ error: 'Sign in required.' });
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  try {
    const params = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: base + '/#/account?pro=success',
      cancel_url: base + '/#/account?pro=cancelled',
      client_reference_id: String(u.id),
      metadata: { userId: String(u.id) },
      subscription_data: { metadata: { userId: String(u.id) } },
    };
    if (u.stripe_customer_id) params.customer = u.stripe_customer_id;
    else params.customer_email = u.email;
    const s = await stripe.checkout.sessions.create(params);
    res.json({ url: s.url, id: s.id });
  } catch (e) { console.error('Stripe checkout failed:', e.message); res.status(500).json({ error: 'Could not start checkout.' }); }
}));

app.post('/api/billing/portal', authed, ah(async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return paymentsNotLive(res);
  const u = await db.getUserById(req.session.userId);
  if (!u) return res.status(401).json({ error: 'Sign in required.' });
  if (!u.stripe_customer_id) return res.status(400).json({ error: 'No billing account yet — go Pro first.' });
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  try {
    const s = await stripe.billingPortal.sessions.create({
      customer: u.stripe_customer_id,
      return_url: base + '/#/account',
    });
    res.json({ url: s.url });
  } catch (e) { console.error('Stripe portal failed:', e.message); res.status(500).json({ error: 'Could not open billing portal.' }); }
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
  // Library-depth gate: any gated official module in the combo blocks non-Pro.
  if (rows.some((r) => isOfficialSet(r) && (r.module_order || 0) > 3) && !(await viewerIsPro(req)))
    return proRequired(res, 'Modules past the first 3 of a subject are Pro. Go Pro for $3.99/mo to play the full library.');
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

// ---------- community ----------
app.get('/api/community', ah(async (req, res) => {
  const rows = await db.listCommunity();
  res.json(rows.map((r) => ({
    id: r.id, title: r.title, subject: r.subject, module: r.module,
    description: r.description, plays: r.plays, created_at: r.created_at,
    creator_name: r.creator_name || 'Unknown',
    questions: JSON.parse(r.questions_json).length,
  })));
}));

app.get('/api/sets/:id', ah(async (req, res) => {
  const row = await db.getSet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Set not found.' });
  // Library-depth gate (official sets only; own + community sets exempt).
  if (isOfficialSet(row) && (row.module_order || 0) > 3 && !(await viewerIsPro(req)))
    return proRequired(res, 'Modules past the first 3 of a subject are Pro. Go Pro for $3.99/mo to play the full library.');
  await db.bumpPlays(req.params.id);
  const full = db.fullSet(row);
  full.combinedIds = [row.id];
  res.json(full);
}));

app.post('/api/sets', authed, ah(async (req, res) => {
  // Free tier: 1 created set. Pro: unlimited.
  if (!(await viewerIsPro(req)) && (await db.countUserSets(req.session.userId)) >= 1)
    return proRequired(res, 'Free accounts can create 1 set. Go Pro for $3.99/mo for unlimited sets.');
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
// Deterministic notes → question-set generator. Parses term/definition lines
// ("Term: definition") and definitional sentences ("X is ..."), then builds
// forward + reverse MCQs with shuffled distractors. Instant, no API key needed.
const GEN_STOP = new Set(['this','that','it','they','we','you','he','she','the','a','an','there','here','these','those','my','our','their','its']);
const GEN_CODE_TERM = /^[A-Za-z]{1,5}\d+[A-Za-z0-9]*$/; // LO5, CH8, Q12 — labels, not concepts
const GEN_LABEL_TERM = /^(lo|obj|objective|chapter|ch|module|mod|unit|topic|section|sec|part|page|fig|figure|table|slide|week|day|learning objectives?|key terms?|notes?|vocabulary|definitions?|summary|overview|introduction)$/i;
function genIsJunkTerm(term) {
  const t = term.trim();
  if (GEN_CODE_TERM.test(t)) return true;
  if (GEN_LABEL_TERM.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}
function genExtractPairs(notes) {
  const pairs = [], seen = new Set();
  const push = (term, def) => {
    term = (term || '').replace(/^[*#\-–—\d.)\s]+/, '').trim();
    def = (def || '').trim();
    if (!term || !def) return;
    if (term.length < 3 || term.length > 60 || def.length < 15 || def.length > 400) return;
    if (term.split(/\s+/).length > 8) return;
    if (genIsJunkTerm(term)) return;
    if (GEN_STOP.has(term.toLowerCase().split(/\s+/)[0])) return;
    const k = term.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ term, def });
  };
  for (const line of notes.split(/\r?\n/)) {
    const m = line.match(/^(.{1,60}?)\s*[:\u2014\u2013-]\s+(.{15,400})$/);
    if (m) push(m[1], m[2]);
  }
  for (const s of notes.replace(/\r?\n/g, ' ').split(/(?<=[.!?])\s+/)) {
    const m = s.match(/^([A-Z][\w\s,'()/-]{2,50}?)\s+(is|are|refers to|means)\s+(.{15,400})$/);
    if (m) push(m[1], m[3]);
  }
  return pairs;
}
function genShort(s, n = 140) { s = s.trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function genShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function genBuildQuestions(pairs) {
  pairs = pairs.filter((p) => !genIsJunkTerm(p.term));
  const qs = [];
  const defs = pairs.map((p) => genShort(p.def));
  const terms = pairs.map((p) => p.term);
  pairs.forEach((p, i) => {
    const dOthers = genShuffle(defs.map((d, j) => j)
      .filter((j) => j !== i && defs[j].toLowerCase() !== defs[i].toLowerCase())).slice(0, 3);
    if (dOthers.length === 3) {
      const opts = genShuffle([defs[i], ...dOthers.map((j) => defs[j])]);
      qs.push({ q: `What is ${p.term}?`, options: opts, answer: opts.indexOf(defs[i]),
                explain: `${p.term}: ${p.def}` });
    }
    if (i % 2 === 0) {
      const tOthers = genShuffle(terms.map((t, j) => j)
        .filter((j) => j !== i && terms[j].toLowerCase() !== terms[i].toLowerCase())).slice(0, 3);
      if (tOthers.length === 3) {
        const opts = genShuffle([terms[i], ...tOthers.map((j) => terms[j])]);
        qs.push({ q: `"${genShort(p.def, 120)}" — this describes:`, options: opts,
                  answer: opts.indexOf(terms[i]), explain: `${p.term}: ${p.def}` });
      }
    }
  });
  return genShuffle(qs).slice(0, 60);
}

app.post('/api/generate', authed, ah(async (req, res) => {
  // Free tier: 3 AI generations per calendar month. Pro: unlimited.
  if (!(await viewerIsPro(req)) &&
      (await db.countGenRequestsSince(req.session.userId, monthStartIso())) >= 3)
    return proRequired(res, 'Free accounts get 3 AI generations a month. Go Pro for $3.99/mo for unlimited generation.');
  const { subject, notes } = req.body || {};
  if (!subject || !notes || notes.trim().length < 50)
    return res.status(400).json({ error: 'Add a subject and paste at least a few sentences of notes.' });
  await db.addGenRequest(req.session.userId, subject.trim(), notes.trim());
  const pairs = genExtractPairs(notes);
  if (pairs.length < 4)
    return res.status(400).json({ error: `I found only ${pairs.length} clear term(s) in your notes. Try one "Term: definition" per line — paste at least 4.` });
  const questions = genBuildQuestions(pairs);
  const title = `From notes: ${subject.trim()}`;
  const order = await db.maxModuleOrder(subject.trim());
  const r = await db.createSet({
    title, subject: subject.trim(), module: title, module_order: order + 1,
    description: `Auto-generated from your notes (${pairs.length} terms). Skim the questions and edit anything that looks off.`,
    questionsJson: JSON.stringify(questions),
    roundsJson: JSON.stringify([{ tag: title, title, desc: 'Generated from notes', count: questions.length, boss: false }]),
    creatorId: req.session.userId,
  });
  res.json({ ok: true, id: r.id, message: `Built ${questions.length} questions from ${pairs.length} terms — your module is live!` });
}));

// ---------- games registry ----------
app.get('/api/games', (req, res) => {
  res.json([
    { id: 'asteroid', title: 'Asteroid Destroyer', icon: '☄️', subjects: null,
      desc: 'Answers drift through space. Drag the correct one into the black hole to blow it up.' },
    { id: 'galaga', title: 'Star Defender', icon: '🚀', subjects: null,
      desc: 'Galaga-style shooter. Waves of enemy ships carry the answers — blast the correct one, dodge their fire.' },
    { id: 'quiz', title: 'Quiz Boss Battle', icon: '⚡', subjects: null,
      desc: 'Rapid-fire quiz combat. 20 seconds a question, streaks multiply your score.' },
    { id: 'match', title: 'Match Pairs', icon: '🃏', subjects: null,
      desc: 'Flip the cards and match each term to its definition. Clear the board fast for big points.' },
    { id: 'sort', title: 'Slingshot Smash', icon: '🏹', subjects: null,
      desc: 'Drag the slingshot, aim, and smash the correct answer brick on the wall — wrong answers bounce back and cost a life.' },
    { id: 'type', title: 'Type Attack', icon: '⌨️', subjects: null,
      desc: 'No multiple choice. Type the answer from memory before the clock runs out.' },
    { id: 'pop', title: 'Balloon Pop', icon: '🎈', subjects: null,
      desc: 'Guess the hidden answer letter by letter — every wrong guess pops a balloon.' },
    { id: 'speed', title: 'Speed Type', icon: '🚀', subjects: null,
      desc: 'Type out real study material as fast as you can — WPM and accuracy tracked.' },
  ]);
});

// ---------- static frontend + PWA ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error.' }); });

db.init().then(() => {
  app.listen(PORT, () => console.log(`StudyClash running on http://localhost:${PORT}`));
}).catch((e) => { console.error('DB init failed:', e.message); process.exit(1); });
