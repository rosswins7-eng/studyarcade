// StudyArcade SPA
const $ = (id) => document.getElementById(id);
let ME = null, GAMES = [], SUBJECTS = [];
const ICONS = {
  'Psychology 101': '🧠', 'Biology 101': '🧬', 'Chemistry 101': '⚗️',
  'Anatomy & Physiology': '🫀', 'Algebra 1': '➗', 'Pre-Algebra': '🔢', 'Geometry': '📐',
  'Physics Basics': '🚀', 'Computer Science Basics': '💻', 'CompTIA Security+ Prep': '🔒',
  'AP US History': '🏛️', 'World History': '🌍', 'English & Grammar': '✍️',
  'Spanish Basics': '🇪🇸', 'SAT Vocabulary': '📖', 'Nursing Fundamentals': '🩺',
  'Dental Fundamentals': '🦷', 'Financial Literacy': '💰',
  'Elementary Math': '🧮', 'Kids Science': '🔬', 'Kids Reading': '📖', 'Kids Geography': '🗺️',
};
const iconFor = (s) => ICONS[s] || '📚';
// Age bands for the Subjects page. Unmapped subjects fall into 'other'.
const BANDS = [
  { id: 'elementary', title: '🧒 Elementary School', subjects: ['Elementary Math', 'Kids Science', 'Kids Reading', 'Kids Geography'] },
  { id: 'teen', title: '🎒 Teen / High School', subjects: ['Algebra 1', 'Pre-Algebra', 'Geometry', 'Physics Basics', 'Computer Science Basics', 'AP US History', 'World History', 'English & Grammar', 'Spanish Basics', 'Financial Literacy', 'SAT Vocabulary'] },
  { id: 'college', title: '🎓 College & Career', subjects: ['Psychology 101', 'Biology 101', 'Chemistry 101', 'Anatomy & Physiology', 'Nursing Fundamentals', 'Dental Fundamentals', 'CompTIA Security+ Prep'] },
  { id: 'other', title: '📚 More Subjects', subjects: [] },
];
const bandFor = (name) => {
  const b = BANDS.find((x) => x.id !== 'other' && x.subjects.includes(name));
  return b ? b.id : 'other';
};

function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ---- levels (mirrors the backend curve) ----
function levelFor(xp){ xp = Math.max(0, xp || 0); return Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2)); }
function xpForLevel(n){ return 50 * n * (n - 1); }

async function api(method, url, body){
  const r = await fetch(url, {
    method, headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || data.error || 'Something went wrong.');
    err.status = r.status;
    err.code = data.error || null;
    throw err;
  }
  return data;
}

const isProRequired = (e) => e && (e.code === 'pro_required' || e.status === 402);
// Friendly Pro upsell for 402s: toast where one exists, then send them to the
// account page where the Go Pro card lives.
function proUpsell(e, toastId){
  const msg = (e && e.message) || 'This is a StudyClash Pro feature.';
  if (toastId && $(toastId)) toast(toastId, 'err', msg + ' Taking you to Go Pro…');
  setTimeout(() => { location.hash = '#/account'; }, 1200);
}

function showView(name){
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
  document.querySelectorAll('.navlink').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.nav; }));

function toast(id, kind, msg){
  const t = $(id);
  t.className = 'toast show ' + kind;
  t.textContent = msg;
}

// ---------- router ----------
function parseHash(){
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { segs, q };
}
async function route(){
  const { segs, q } = parseHash();
  const [page, arg] = segs;
  try {
    if (page === 'games') { showView('games'); await renderGames(); }
    else if (page === 'subjects') { showView('subjects'); await renderSubjects(q.game); }
    else if (page === 'subject' && arg) { showView('subject'); await renderSubject(decodeURIComponent(arg), q.game); }
    else if (page === 'module' && arg) { showView('module'); await renderModule(arg, q.game); }
    else if (page === 'community') { showView('community'); await renderCommunity(); }
    else if (page === 'create') { showView('create'); renderCreate(); }
    else if (page === 'account') { showView('account'); await renderAccount(q); }
    else { showView('home'); await renderHome(); }
  } catch(e){ console.error(e); }
}
window.addEventListener('hashchange', route);

// ---------- home ----------
async function renderHome(){
  const v = $('view-home');
  const games = GAMES.map(g => `
    <div class="card"><div class="icon">${g.icon}</div><h3>${esc(g.title)}</h3><p>${esc(g.desc)}</p>
    <a class="btn" href="#/subjects?game=${g.id}">Play ${esc(g.title)}</a></div>`).join('');
  v.innerHTML = `
    <div class="hero">
      <h1>Studying sucks.<br><span class="grad">Games don't.</span></h1>
      <p>Pick a subject, choose your modules, and turn them into games you actually want to play. Missed questions become your review list.</p>
      <div class="ctarow">
        <a class="btn" href="#/subjects">▶ Play now</a>
        <a class="btn ghost" href="#/create">✨ Create a set</a>
      </div>
    </div>
    <h2 class="section-title">The games</h2>
    <div class="cards">${games}</div>
    <h2 class="section-title">How it works</h2>
    <div class="steps">
      <div class="step"><div class="num">1</div><h3>Pick a subject</h3><p>Browse community-made modules — or build your own from your notes.</p></div>
      <div class="step"><div class="num">2</div><h3>Choose modules</h3><p>Drill one module or combine several into a mega-run.</p></div>
      <div class="step"><div class="num">3</div><h3>Play &amp; climb</h3><p>Destroy asteroids, flip matches, and land on the leaderboard.</p></div>
    </div>
    <h2 class="section-title">Pricing</h2>
    <div class="cards">
      <div class="card"><div class="icon">🆓</div><h3>Free</h3>
        <p>First 3 modules of every subject · create 1 set · AI generator 3×/month · full Community access.</p>
        <a class="btn ghost" href="#/subjects">Start free</a></div>
      <div class="card"><div class="icon">⭐</div><h3>StudyClash Pro — $3.99/mo</h3>
        <p>The full library unlocked · unlimited sets · unlimited AI generation · Pro badge.</p>
        <a class="btn" href="#/account">Go Pro — $3.99/mo</a>
        <p class="muted" style="margin-top:8px">Cancel anytime. 7-day money-back guarantee.</p></div>
    </div>
    <h2 class="section-title">Starter subjects</h2>
    <div class="subj-grid" id="home-subjects"><p class="muted">Loading…</p></div>`;
  try {
    SUBJECTS = await api('GET', '/api/subjects');
    $('home-subjects').innerHTML = SUBJECTS.map(s => `
      <div class="subj" onclick="location.hash='#/subject/${encodeURIComponent(s.subject)}'">
        <div class="icon">${iconFor(s.subject)}</div><h3>${esc(s.subject)}</h3>
        <div class="meta">${s.modules} module${s.modules === 1 ? '' : 's'} · ${s.questions} questions</div>
      </div>`).join('');
  } catch(e){ $('home-subjects').innerHTML = '<p class="muted">Could not load subjects.</p>'; }
}

// ---------- games ----------
async function renderGames(){
  $('view-games').innerHTML = `
    <h2 class="section-title" style="margin-top:0">Games</h2>
    <p class="muted" style="margin-bottom:18px">Every game plays any module. Pick a game, then choose your modules.</p>
    <div class="cards">${GAMES.map(g => `
      <div class="card"><div class="icon">${g.icon}</div><h3>${esc(g.title)}</h3><p>${esc(g.desc)}</p>
      <a class="btn" href="#/subjects?game=${g.id}">Choose modules</a></div>`).join('')}</div>`;
}

// ---------- subjects ----------
async function renderSubjects(gameFilter){
  const v = $('view-subjects');
  const g = GAMES.find(x => x.id === gameFilter);
  v.innerHTML = `
    <h2 class="section-title" style="margin-top:0">Subjects</h2>
    ${g ? `<p class="muted" style="margin-bottom:14px">Pick modules to play <b>${g.icon} ${esc(g.title)}</b> — or <a href="#/subjects">browse all</a>.</p>` : ''}
    <div class="subj-grid" id="subj-list"><p class="muted">Loading…</p></div>`;
  try {
    SUBJECTS = await api('GET', '/api/subjects');
    const byBand = {};
    SUBJECTS.forEach((s) => { const b = bandFor(s.subject); (byBand[b] = byBand[b] || []).push(s); });
    const card = (s) => `
      <div class="subj" onclick="location.hash='#/subject/${encodeURIComponent(s.subject)}${g ? '?game=' + g.id : ''}'">
        <div class="icon">${iconFor(s.subject)}</div><h3>${esc(s.subject)}</h3>
        <div class="meta">${s.modules} module${s.modules === 1 ? '' : 's'} · ${s.questions} questions · ${s.plays || 0} plays</div>
      </div>`;
    $('subj-list').innerHTML = BANDS.map((b) => {
      const items = byBand[b.id] || [];
      if (!items.length) return '';
      return `<h3 class="band-title" style="grid-column:1/-1;margin:18px 0 4px">${esc(b.title)}</h3>` +
        items.map(card).join('');
    }).join('') || '<p class="muted">No subjects yet — create the first one!</p>';
  } catch(e){ $('subj-list').innerHTML = '<p class="muted">Could not load subjects.</p>'; }
}

// ---------- subject detail: selectable modules ----------
let selModules = [];
async function renderSubject(subject, gameFilter){
  const v = $('view-subject');
  v.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const data = await api('GET', '/api/subjects/' + encodeURIComponent(subject));
    const mods = data.modules;
    selModules = mods.map(m => m.id);
    const g = GAMES.find(x => x.id === gameFilter);
    v.innerHTML = `
      <p class="muted"><a href="#/subjects">← Subjects</a></p>
      <h2 class="section-title" style="margin-top:8px">${iconFor(subject)} ${esc(subject)}</h2>
      <p class="muted" style="margin-bottom:16px">${mods.length} module${mods.length === 1 ? '' : 's'} · tick the ones you want, then pick a game.</p>
      <div id="modlist">${mods.map(m => `
        <div class="mod">
          <input type="checkbox" checked data-id="${m.id}" onchange="toggleMod(${m.id}, this.checked)">
          <div class="body">
            <h3><a href="#/module/${m.id}" style="color:#fff;text-decoration:none">${esc(m.module)}</a></h3>
            <div class="meta">${m.questionCount} questions · ${m.plays} plays · by ${esc(m.creator)}</div>
            <div class="actions">
              <a class="btn small ghost" href="#/module/${m.id}">Details</a>
            </div>
          </div>
        </div>`).join('')}</div>
      <div class="playbar">
        <span class="count" id="selcount">${mods.length} selected</span>
        ${GAMES.map(gm => `<a class="gamebtn" data-game="${gm.id}" onclick="playSelected('${gm.id}')">${gm.icon} ${esc(gm.title)}</a>`).join('')}
      </div>`;
    if (g) { /* preselect highlight could go here */ }
  } catch(e){ v.innerHTML = `<p class="muted">Subject not found. <a href="#/subjects">Back</a></p>`; }
}
function toggleMod(id, on){
  if (on && !selModules.includes(id)) selModules.push(id);
  if (!on) selModules = selModules.filter(x => x !== id);
  const c = $('selcount');
  if (c) c.textContent = `${selModules.length} selected`;
}
async function playSelected(gameId){
  if (!selModules.length) { alert('Select at least one module first.'); return; }
  try {
    await api('GET', '/api/sets/combined?ids=' + selModules.join(','));
  } catch(e){
    if (isProRequired(e)) { proUpsell(e); return; }
    // Other errors: let the game page surface them as before.
  }
  location.href = `/games/${gameId}.html?sets=` + selModules.join(',');
}

// ---------- module detail ----------
let lbGame = 'asteroid';
async function renderModule(id, game){
  if (game && GAMES.some((g) => g.id === game)) lbGame = game;
  const v = $('view-module');
  v.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const m = await api('GET', '/api/sets/' + id);
    v.innerHTML = `
      <p class="muted"><a href="#/subject/${encodeURIComponent(m.subject)}">← ${esc(m.subject)}</a></p>
      <h2 class="section-title" style="margin-top:8px">${esc(m.module)}</h2>
      <p class="muted" style="margin-bottom:16px">${esc(m.description)}<br>${m.questionCount} questions · ${m.plays} plays · by ${esc(m.creator)}</p>
      <div class="ctarow" style="justify-content:flex-start;margin-bottom:24px">
        ${GAMES.map(g => `<a class="gamebtn" href="/games/${g.id}.html?set=${m.id}">${g.icon} Play ${esc(g.title)}</a>`).join('')}
      </div>
      <h2 class="section-title">🏆 Leaderboard</h2>
      <div class="tabs" id="lbtabs">${GAMES.map(g => `<button class="tab${g.id === lbGame ? ' active' : ''}" onclick="setLbGame('${g.id}', ${m.id})">${g.icon} ${esc(g.title)}</button>`).join('')}</div>
      <div class="card" id="lbtable"><p class="muted">Loading…</p></div>`;
    await loadLb(m.id);
  } catch(e){
    if (isProRequired(e)) {
      v.innerHTML = `
        <div class="card"><div class="icon">⭐</div><h3>This module is Pro</h3>
        <p class="muted" style="margin:8px 0 14px">${esc(e.message)}</p>
        <a class="btn" href="#/account">Go Pro — $3.99/mo</a>
        <p class="muted" style="margin-top:8px">Cancel anytime. 7-day money-back guarantee.</p></div>
        <p class="muted" style="margin-top:14px"><a href="#/subjects">← Back to subjects</a></p>`;
    } else {
      v.innerHTML = `<p class="muted">Module not found. <a href="#/subjects">Back</a></p>`;
    }
  }
}
async function loadLb(id){
  try {
    const rows = await api('GET', `/api/sets/${id}/leaderboard?game=${lbGame}`);
    $('lbtable').innerHTML = rows.length ? `
      <table class="lb"><tr><th>#</th><th>Player</th><th>Best</th><th>Accuracy</th></tr>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${avatarHtml(r, 'avatar-sm')} ${r.user_id ? `<a href="javascript:void(0)" onclick="openProfile(${r.user_id})">${esc(r.name)}</a>` : esc(r.name)}<div class="ptitle">${esc(r.title || '')} · Lv ${r.level || 1}</div></td><td>${r.best}</td><td>${Math.round(r.acc)}%</td></tr>`).join('')}
      </table>` : '<p class="muted">No scores yet — be the first.</p>';
  } catch(e){ $('lbtable').innerHTML = '<p class="muted">Could not load leaderboard.</p>'; }
}
function setLbGame(g, id){ lbGame = g; renderModule(id); }

// ---------- community ----------
async function renderCommunity(){
  const v = $('view-community');
  v.innerHTML = `
    <h2 class="section-title" style="margin-top:0">👥 Community</h2>
    <p class="muted" style="margin-bottom:18px">Modules built by players like you — play any of them.</p>
    <div class="cards" id="com-list"><p class="muted">Loading…</p></div>`;
  try {
    const sets = await api('GET', '/api/community');
    $('com-list').innerHTML = sets.length ? sets.map(s => `
      <div class="card">
        <div class="icon">${iconFor(s.subject)}</div>
        <h3>${esc(s.title)}</h3>
        <p class="muted">${esc(s.subject)} · ${s.questions} question${s.questions === 1 ? '' : 's'} · ${s.plays || 0} plays · by ${esc(s.creator_name)}</p>
        <a class="btn" href="#/module/${s.id}">▶ Play</a>
      </div>`).join('')
      : '<p class="muted">No community modules yet — be the first! <a href="#/create">Create one</a>.</p>';
  } catch(e){ $('com-list').innerHTML = '<p class="muted">Could not load community modules.</p>'; }
}

// ---------- create ----------
let qCount = 0;
function renderCreate(){
  const v = $('view-create');
  if (!ME) {
    v.innerHTML = `<h2 class="section-title" style="margin-top:0">Create</h2>
      <div class="card"><p class="muted">Sign in to create question sets.</p>
      <a class="btn" href="#/account" style="margin-top:12px">Sign in</a></div>`;
    return;
  }
  v.innerHTML = `
    <h2 class="section-title" style="margin-top:0">Create a module</h2>
    <div class="tabs">
      <button class="tab active" id="ctab-manual" onclick="createTab('manual')">✍️ Build manually</button>
      <button class="tab" id="ctab-ai" onclick="createTab('ai')">✨ AI from notes</button>
    </div>
    <div id="cpane-manual">
      <div class="form">
        <label>Title</label><input type="text" id="ctitle" placeholder="e.g. Bio 101 — Cell Structure">
        <div class="row2">
          <div><label>Subject</label><input type="text" id="csubject" list="subjlist" placeholder="e.g. Biology 101"><datalist id="subjlist">${SUBJECTS.map(s => `<option value="${esc(s.subject)}">`).join('')}</datalist></div>
          <div><label>Module name</label><input type="text" id="cmodule" placeholder="e.g. Unit 2: Cells"></div>
        </div>
        <label>Description</label><textarea id="cdesc" style="min-height:70px" placeholder="What does this module cover?"></textarea>
        <label>Questions <span class="muted">(tick the correct answer)</span></label>
        <div id="qblocks"></div>
        <div class="ctarow" style="justify-content:flex-start;align-items:center;gap:12px">
          <button class="btn ghost" onclick="addQ()">+ Add question</button>
          <span class="muted" id="qcounter"></span>
        </div>
        <button class="btn" style="margin-top:14px" onclick="submitSet()">🚀 Publish module</button>
        <div class="toast" id="ctoast"></div>
      </div>
    </div>
    <div id="cpane-ai" class="hidden">
      <div class="form">
        <p class="muted" style="margin-bottom:10px">Paste your study notes — we turn them into a playable module <b>instantly</b>. Works best with one <b>Term: definition</b> per line (at least 4 terms).</p>
        <label>Subject</label><input type="text" id="gencubject" placeholder="e.g. Psychology 101">
        <label>Your notes</label><textarea id="gennotes" style="min-height:170px" placeholder="Paste your study guide, chapter notes, key terms…"></textarea>
        <button class="btn" style="margin-top:14px" onclick="submitGen()">✨ Generate my game</button>
        <div class="toast" id="gtoast"></div>
      </div>
    </div>`;
  qCount = 0; addQ(); addQ();
}
function createTab(t){
  $('ctab-manual').classList.toggle('active', t === 'manual');
  $('ctab-ai').classList.toggle('active', t === 'ai');
  $('cpane-manual').classList.toggle('hidden', t !== 'manual');
  $('cpane-ai').classList.toggle('hidden', t !== 'ai');
}
function addQ(){
  qCount++;
  const d = document.createElement('div');
  d.className = 'qblock'; d.id = 'q' + qCount;
  d.innerHTML = `<div class="qhead"><span>Question ${qCount}</span><button class="btn small danger" onclick="removeQ(this)">✕</button></div>
    <input type="text" class="qq" placeholder="Question text" style="margin-bottom:6px">
    ${[0,1,2,3].map(i => `<div class="optrow"><input type="radio" name="q${qCount}c" ${i === 0 ? 'checked' : ''}><input type="text" class="qo" placeholder="Option ${i + 1}"></div>`).join('')}
    <input type="text" class="qe" placeholder="Explanation (shown when reviewing)" style="margin-top:6px">`;
  $('qblocks').appendChild(d);
  updateQCount();
}
function removeQ(btn){
  if (document.querySelectorAll('.qblock').length <= 1) return; // keep at least 1 block
  btn.closest('.qblock').remove();
  updateQCount();
}
function updateQCount(){
  const n = document.querySelectorAll('.qblock').length;
  const el = $('qcounter');
  if (el) el.textContent = n + (n === 1 ? ' question' : ' questions');
}
async function submitSet(){
  try {
    const title = $('ctitle').value.trim();
    const subject = $('csubject').value.trim();
    const module = $('cmodule').value.trim();
    if (!title) return toast('ctoast', 'err', 'Give your module a title.');
    if (!subject) return toast('ctoast', 'err', 'Give your module a subject.');
    if (!module) return toast('ctoast', 'err', 'Give your module a name.');
    const questions = [];
    const blocks = [...document.querySelectorAll('.qblock')];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const q = b.querySelector('.qq').value.trim();
      const opts = [...b.querySelectorAll('.qo')].map(x => x.value.trim());
      const radios = [...b.querySelectorAll('input[type=radio]')];
      const answer = radios.findIndex(r => r.checked);
      const explain = b.querySelector('.qe').value.trim();
      const anyFilled = q || opts.some(o => o) || explain;
      if (!anyFilled) continue; // entirely empty block — skip silently
      if (!q || opts.some(o => !o) || answer < 0)
        return toast('ctoast', 'err', `Question ${i + 1}: fill in the question, all 4 options, and tick the correct answer.`);
      questions.push({ q, options: opts, answer, explain: explain || '—' });
    }
    if (!questions.length) return toast('ctoast', 'err', 'Add at least one complete question.');
    const set = await api('POST', '/api/sets', {
      title, subject, module, description: $('cdesc').value.trim(), questions,
    });
    toast('ctoast', 'ok', 'Published! Your module is live.');
    setTimeout(() => location.hash = '#/module/' + set.id, 900);
  } catch(e){ if (isProRequired(e)) proUpsell(e, 'ctoast'); else toast('ctoast', 'err', e.message); }
}
async function submitGen(){
  try {
    const r = await api('POST', '/api/generate', { subject: $('gencubject').value.trim(), notes: $('gennotes').value.trim() });
    toast('gtoast', 'ok', r.message);
    $('gennotes').value = '';
    if (r.id) setTimeout(() => location.hash = '#/module/' + r.id, 900);
  } catch(e){ if (isProRequired(e)) proUpsell(e, 'gtoast'); else toast('gtoast', 'err', e.message); }
}

// ---------- account ----------
let authTab = 'login';
async function goPro(){
  try {
    const r = await api('POST', '/api/billing/checkout');
    if (r.url) { location.href = r.url; return; }
    toast('billingtoast', 'err', 'Payments launching soon.');
  } catch(e){
    if (e.status === 503) toast('billingtoast', 'err', 'Payments launching soon — Pro checkout is not live yet.');
    else toast('billingtoast', 'err', e.message);
  }
}
async function manageBilling(){
  try {
    const r = await api('POST', '/api/billing/portal');
    if (r.url) { location.href = r.url; return; }
    toast('billingtoast', 'err', 'Could not open billing.');
  } catch(e){
    if (e.status === 503) toast('billingtoast', 'err', 'Payments launching soon — billing is not live yet.');
    else toast('billingtoast', 'err', e.message);
  }
}

// ---------- profile customization ----------
let CATALOG = null, draft = null;
function avatarHtml(c, cls){
  return `<span class="avatar-wrap frame-${esc(c.frame_id || 'none')} ${cls || ''}"><span class="avatar">${c.avatar || '😀'}</span></span>`;
}
async function renderCustomize(){
  const host = $('customize');
  if (!host || !ME) return;
  if (!CATALOG) { try { CATALOG = await api('GET', '/api/profile/catalog'); } catch(e){ host.innerHTML = ''; return; } }
  if (!draft) draft = { avatar_id: ME.avatar_id, frame_id: ME.frame_id, color_id: ME.color_id, title_id: ME.title_id };
  const lvl = ME.level || levelFor(ME.xp || 0);
  const av = CATALOG.avatars.find(a => a.id === draft.avatar_id) || CATALOG.avatars[0];
  const fr = CATALOG.frames.find(f => f.id === draft.frame_id) || CATALOG.frames[0];
  const co = CATALOG.colors.find(c => c.id === draft.color_id) || CATALOG.colors[0];
  const ti = CATALOG.titles.find(t => t.id === draft.title_id) || CATALOG.titles[0];
  const locked = (min) => lvl < min;
  const pickBtn = (kind, item, inner) => `<button class="pick${draft[kind] === item.id ? ' sel' : ''}${locked(item.min) ? ' locked' : ''}" title="${esc(item.name || item.text)}${locked(item.min) ? ' — unlocks at Lv ' + item.min : ''}" onclick="pickCosmetic('${kind}','${item.id}',${item.min})">${inner}${locked(item.min) ? `<span class="lock">🔒 Lv ${item.min}</span>` : ''}</button>`;
  host.innerHTML = `
  <div class="card" style="margin-bottom:24px">
    <h3 style="margin-bottom:6px">🎨 Your profile</h3>
    <p class="muted" style="margin-bottom:14px">This is how other players see you — on leaderboards and your public profile. Playing earns XP, XP earns levels, and levels unlock the good stuff… all the way to the ✨ Glimmering frame at Lv 1000.</p>
    <div class="profile-banner" style="background:${co.css}">
      ${avatarHtml({ avatar: av.e, frame_id: fr.id }, 'avatar-lg')}
      <div>
        <div class="pb-name">${esc(ME.name)} <span class="lvlbadge">Lv ${lvl}</span>${ME.is_pro ? ' <span class="lvlbadge">PRO</span>' : ''}</div>
        <div class="pb-title">${esc(ti.text)}</div>
        <div class="pb-bio">${esc(ME.bio || '')}</div>
      </div>
    </div>
    <h4 class="picklabel">Avatar</h4>
    <div class="picker-grid">${CATALOG.avatars.map(a => pickBtn('avatar_id', a, a.e)).join('')}</div>
    <h4 class="picklabel">Icon frame</h4>
    <div class="picker-grid frames">${CATALOG.frames.map(f => pickBtn('frame_id', f, avatarHtml({ avatar: av.e, frame_id: f.id }, 'avatar-sm'))).join('')}</div>
    <h4 class="picklabel">Banner color</h4>
    <div class="pickrow">${CATALOG.colors.map(c => `<button class="swatch${draft.color_id === c.id ? ' sel' : ''}${locked(c.min) ? ' locked' : ''}" style="background:${c.css}" title="${esc(c.name)}${locked(c.min) ? ' — unlocks at Lv ' + c.min : ''}" onclick="pickCosmetic('color_id','${c.id}',${c.min})">${locked(c.min) ? '🔒' : ''}</button>`).join('')}</div>
    <h4 class="picklabel">Title</h4>
    <div class="pickrow">${CATALOG.titles.map(t => `<button class="titlechip${draft.title_id === t.id ? ' sel' : ''}${locked(t.min) ? ' locked' : ''}" onclick="pickCosmetic('title_id','${t.id}',${t.min})">${esc(t.text)}${locked(t.min) ? ` <span class="lockinline">🔒 Lv ${t.min}</span>` : ''}</button>`).join('')}</div>
    <h4 class="picklabel">Display name &amp; bio</h4>
    <input id="pfname" class="pfinput" maxlength="30" value="${esc(ME.name)}">
    <textarea id="pfbio" class="pfinput" rows="2" maxlength="140" placeholder="A short bio other players can see (max 140 characters)">${esc(ME.bio || '')}</textarea>
    <button class="btn" onclick="saveProfile()">Save profile</button>
    <div class="toast" id="profiletoast"></div>
  </div>`;
}
function pickCosmetic(kind, id, min){
  const lvl = ME.level || levelFor(ME.xp || 0);
  if (lvl < min) { toast('profiletoast', 'err', '🔒 That unlocks at level ' + min + ' — you are level ' + lvl + '. Keep playing!'); return; }
  draft[kind] = id;
  renderCustomize();
}
async function saveProfile(){
  try {
    ME = await api('PATCH', '/api/auth/profile', { ...draft, name: $('pfname').value, bio: $('pfbio').value });
    draft = null;
    syncNav(); renderCustomize();
    toast('profiletoast', 'ok', '✅ Profile saved — looking sharp.');
  } catch(e){ toast('profiletoast', 'err', e.message); }
}
// ---------- public profiles ----------
function openProfile(id){
  let m = $('profilemodal');
  if (!m) {
    document.body.insertAdjacentHTML('beforeend', '<div id="profilemodal" class="pmodal-back hidden" onclick="if(event.target===this)closeProfile()"><div class="pmodal card" id="pmodalcard"></div></div>');
    m = $('profilemodal');
  }
  m.classList.remove('hidden');
  $('pmodalcard').innerHTML = '<p class="muted">Loading profile…</p>';
  api('GET', '/api/users/' + id).then(p => {
    $('pmodalcard').innerHTML = `
      <div class="profile-banner" style="background:${p.color_css}">
        ${avatarHtml(p, 'avatar-lg')}
        <div>
          <div class="pb-name">${esc(p.name)} <span class="lvlbadge">Lv ${p.level}</span>${p.is_pro ? ' <span class="lvlbadge">PRO</span>' : ''}</div>
          <div class="pb-title">${esc(p.title)}</div>
          <div class="pb-bio">${esc(p.bio || '')}</div>
        </div>
      </div>
      <div class="pstats">
        <div class="pstat"><div class="v">${p.xp}</div><div class="l">XP</div></div>
        <div class="pstat"><div class="v">${p.stats.games}</div><div class="l">GAMES PLAYED</div></div>
        <div class="pstat"><div class="v">${p.stats.best_score}</div><div class="l">BEST SCORE</div></div>
        <div class="pstat"><div class="v">${p.stats.sets_created}</div><div class="l">SETS CREATED</div></div>
      </div>
      <p class="muted" style="text-align:center">Playing since ${esc(String(p.created_at || '').slice(0, 10))}</p>
      <button class="btn" onclick="closeProfile()">Close</button>`;
  }).catch(() => { $('pmodalcard').innerHTML = '<p class="muted">Could not load that profile.</p><button class="btn" onclick="closeProfile()">Close</button>'; });
}
function closeProfile(){ const m = $('profilemodal'); if (m) m.classList.add('hidden'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(); });

async function renderAccount(q = {}){
  const v = $('view-account');
  if (!ME) {
    v.innerHTML = `
      <h2 class="section-title" style="margin-top:0">Account</h2>
      <div class="form" style="max-width:440px">
        <div class="tabs">
          <button class="tab${authTab === 'login' ? ' active' : ''}" onclick="authTab='login';renderAccount()">Sign in</button>
          <button class="tab${authTab === 'register' ? ' active' : ''}" onclick="authTab='register';renderAccount()">Create account</button>
        </div>
        ${authTab === 'register' ? '<label>Name</label><input type="text" id="aname" placeholder="Your name">' : ''}
        <label>Email</label><input type="email" id="aemail" placeholder="you@example.com">
        <label>Password</label><input type="password" id="apass" placeholder="••••••••">
        <button class="btn" style="margin-top:16px" onclick="doAuth()">${authTab === 'login' ? 'Sign in' : 'Create account'}</button>
        <div class="toast" id="atoast"></div>
      </div>`;
    return;
  }
  if (q && q.pro === 'success') {
    // Webhook may lag a few seconds — re-fetch /me so the badge is fresh.
    try { const fresh = await api('GET', '/api/auth/me'); if (fresh) { ME = fresh; syncNav(); } } catch(e){}
  }
  v.innerHTML = `
    <h2 class="section-title" style="margin-top:0">👤 ${esc(ME.name)}</h2>
    <p class="muted" style="margin-bottom:18px">${esc(ME.email)} ${ME.is_pro ? '· <b style="color:#ffd166">PRO</b>' : ''}</p>
    <div class="ctarow" style="justify-content:flex-start;margin-bottom:24px">
      <a class="btn small" href="#/create">✨ New module</a>
      <button class="btn small ghost" onclick="logout()">Sign out</button>
    </div>
    ${ME.is_pro ? `
    <div class="card" style="margin-bottom:24px"><div class="icon">⭐</div><h3>StudyClash Pro <span class="lvlbadge">PRO</span></h3>
      <p class="muted" style="margin:8px 0 12px">Everything unlocked — full library, unlimited sets, unlimited AI generation.</p>
      <button class="btn" onclick="manageBilling()">Manage billing</button>
      <div class="toast" id="billingtoast"></div></div>`
    : `
    <div class="card" style="margin-bottom:24px"><div class="icon">⭐</div><h3>Go Pro — $3.99/mo</h3>
      <p class="muted" style="margin:8px 0 12px">Unlock the full library (every module past the first 3 of each subject), unlimited set creation, and unlimited AI generation.</p>
      <button class="btn" onclick="goPro()">Go Pro — $3.99/mo</button>
      <p class="muted" style="margin-top:8px">Cancel anytime. 7-day money-back guarantee.</p>
      <div class="toast" id="billingtoast"></div></div>`}
    <div id="customize"><p class="muted">Loading profile studio…</p></div>
    <h2 class="section-title">My modules</h2><div id="mysets"><p class="muted">Loading…</p></div>
    <h2 class="section-title">My best scores</h2><div id="myscores"><p class="muted">Loading…</p></div>`;
  if (q && q.pro === 'success') {
    toast('billingtoast', 'ok', ME.is_pro
      ? '🎉 Welcome to Pro! Everything is unlocked.'
      : '🎉 Welcome to Pro! Payment received — if Pro does not show yet, give it a few seconds (confirmation can lag) and refresh.');
  } else if (q && q.pro === 'cancelled') {
    toast('billingtoast', 'err', 'Checkout cancelled — no charge was made.');
  }
  renderCustomize();
  api('GET', '/api/me/sets').then(sets => {
    const el = $('mysets'); if (!el) return;
    el.innerHTML = sets.length ? sets.map(s => `
      <div class="mod"><div class="body"><h3>${esc(s.module)}</h3>
      <div class="meta">${esc(s.subject)} · ${s.questionCount} questions · ${s.plays} plays</div>
      <div class="actions"><a class="btn small ghost" href="#/module/${s.id}">View</a>
      <button class="btn small danger" onclick="delSet(${s.id})">Delete</button></div></div></div>`).join('')
      : '<p class="muted">Nothing yet — <a href="#/create">create your first module</a>.</p>';
  }).catch((e) => {
    const el = $('mysets'); if (!el) return;
    el.innerHTML = `<p class="muted">Could not load your modules${e && e.message ? ' (' + esc(e.message) + ')' : ''} — the server may have been waking up. <button class="btn small ghost" onclick="renderAccount()">Retry</button></p>`;
  });
  api('GET', '/api/me/scores').then(rows => {
    const el = $('myscores'); if (!el) return;
    const gname = { quiz: '⚡ Quiz', asteroid: '☄️ Asteroid', galaga: '🚀 Defender', match: '🃏 Match', sort: '🏹 Slingshot', type: '⌨️ Type', pop: '🎈 Pop', speed: '🚀 Speed' };
    el.innerHTML = rows.length ? `
      <div class="card"><table class="lb"><tr><th>Module</th><th>Game</th><th>Best</th><th>Acc</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.module)}</td><td>${gname[r.game] || r.game}</td><td>${r.best}</td><td>${Math.round(r.acc)}%</td></tr>`).join('')}
      </table></div>` : '<p class="muted">Play a game to set your first score.</p>';
  }).catch((e) => {
    const el = $('myscores'); if (!el) return;
    el.innerHTML = `<p class="muted">Could not load your scores${e && e.message ? ' (' + esc(e.message) + ')' : ''} — the server may have been waking up. <button class="btn small ghost" onclick="renderAccount()">Retry</button></p>`;
  });
}
async function doAuth(){
  try {
    const email = $('aemail').value.trim(), password = $('apass').value;
    ME = authTab === 'login'
      ? await api('POST', '/api/auth/login', { email, password })
      : await api('POST', '/api/auth/register', { name: $('aname').value.trim(), email, password });
    syncNav(); renderAccount();
  } catch(e){ toast('atoast', 'err', e.message); }
}
async function logout(){ await api('POST', '/api/auth/logout'); ME = null; syncNav(); renderAccount(); }
async function delSet(id){
  if (!confirm('Delete this module?')) return;
  await api('DELETE', '/api/sets/' + id);
  renderAccount();
}
function syncNav(){
  const link = $('accountlink');
  if (!ME) { link.textContent = 'Sign in'; return; }
  const lvl = ME.level || levelFor(ME.xp || 0);
  const xp = ME.xp || 0;
  const cur = xpForLevel(lvl), next = xpForLevel(lvl + 1);
  const pct = next > cur ? Math.min(100, Math.max(0, (xp - cur) / (next - cur) * 100)) : 100;
  link.innerHTML = (ME.avatar || '👤') + ' ' + esc(ME.name.split(' ')[0]) +
    ' <span class="lvlbadge">Lv ' + lvl + '</span>' +
    '<span class="xpbar" title="' + xp + ' / ' + next + ' XP"><span style="width:' + Math.round(pct) + '%"></span></span>';
}

// ---------- boot ----------
(async function(){
  try { GAMES = await api('GET', '/api/games'); } catch(e){ GAMES = []; }
  try { ME = await api('GET', '/api/auth/me'); } catch(e){
    // Server may be waking (Render free tier) — retry once before
    // treating the user as signed out.
    await new Promise((r) => setTimeout(r, 2000));
    try { ME = await api('GET', '/api/auth/me'); } catch(e2){ ME = null; }
  }
  syncNav();
  if (!location.hash) location.hash = '#/';
  route();
})();
