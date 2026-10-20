// StudyArcade SPA
const $ = (id) => document.getElementById(id);
let ME = null, GAMES = [], SUBJECTS = [];
const ICONS = { 'Psychology 101': '🧠', 'SAT Prep': '📝', 'Spanish 101': '🇪🇸', 'Biology 101': '🧬', 'Chemistry 101': '⚗️' };
const iconFor = (s) => ICONS[s] || '📚';

function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function api(method, url, body){
  const r = await fetch(url, {
    method, headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
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
    else if (page === 'module' && arg) { showView('module'); await renderModule(arg); }
    else if (page === 'create') { showView('create'); renderCreate(); }
    else if (page === 'account') { showView('account'); renderAccount(); }
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
    $('subj-list').innerHTML = SUBJECTS.map(s => `
      <div class="subj" onclick="location.hash='#/subject/${encodeURIComponent(s.subject)}${g ? '?game=' + g.id : ''}'">
        <div class="icon">${iconFor(s.subject)}</div><h3>${esc(s.subject)}</h3>
        <div class="meta">${s.modules} module${s.modules === 1 ? '' : 's'} · ${s.questions} questions · ${s.plays || 0} plays</div>
      </div>`).join('') || '<p class="muted">No subjects yet — create the first one!</p>';
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
function playSelected(gameId){
  if (!selModules.length) { alert('Select at least one module first.'); return; }
  location.href = `/games/${gameId}.html?sets=` + selModules.join(',');
}

// ---------- module detail ----------
let lbGame = 'asteroid';
async function renderModule(id){
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
  } catch(e){ v.innerHTML = `<p class="muted">Module not found. <a href="#/subjects">Back</a></p>`; }
}
async function loadLb(id){
  try {
    const rows = await api('GET', `/api/sets/${id}/leaderboard?game=${lbGame}`);
    $('lbtable').innerHTML = rows.length ? `
      <table class="lb"><tr><th>#</th><th>Player</th><th>Best</th><th>Accuracy</th></tr>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.best}</td><td>${Math.round(r.acc)}%</td></tr>`).join('')}
      </table>` : '<p class="muted">No scores yet — be the first.</p>';
  } catch(e){ $('lbtable').innerHTML = '<p class="muted">Could not load leaderboard.</p>'; }
}
function setLbGame(g, id){ lbGame = g; renderModule(id); }

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
        <button class="btn ghost" onclick="addQ()">+ Add question</button>
        <button class="btn" style="margin-top:14px" onclick="submitSet()">🚀 Publish module</button>
        <div class="toast" id="ctoast"></div>
      </div>
    </div>
    <div id="cpane-ai" class="hidden">
      <div class="form">
        <p class="muted" style="margin-bottom:10px">Paste your study notes — our AI turns them into a playable module. Requests are reviewed and published to the library.</p>
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
  d.innerHTML = `<div class="qhead"><span>Question ${qCount}</span><button class="btn small danger" onclick="this.closest('.qblock').remove()">✕</button></div>
    <input type="text" class="qq" placeholder="Question text" style="margin-bottom:6px">
    ${[0,1,2,3].map(i => `<div class="optrow"><input type="radio" name="q${qCount}c" ${i === 0 ? 'checked' : ''}><input type="text" class="qo" placeholder="Option ${i + 1}"></div>`).join('')}
    <input type="text" class="qe" placeholder="Explanation (shown when reviewing)" style="margin-top:6px">`;
  $('qblocks').appendChild(d);
}
async function submitSet(){
  try {
    const questions = [];
    document.querySelectorAll('.qblock').forEach(b => {
      const q = b.querySelector('.qq').value.trim();
      const opts = [...b.querySelectorAll('.qo')].map(i => i.value.trim());
      const radios = [...b.querySelectorAll('input[type=radio]')];
      const answer = radios.findIndex(r => r.checked);
      const explain = b.querySelector('.qe').value.trim() || '—';
      if (q && opts.every(o => o)) questions.push({ q, options: opts, answer, explain });
    });
    const set = await api('POST', '/api/sets', {
      title: $('ctitle').value.trim(), subject: $('csubject').value.trim(),
      module: $('cmodule').value.trim(), description: $('cdesc').value.trim(),
      questions,
    });
    toast('ctoast', 'ok', 'Published! Your module is live.');
    setTimeout(() => location.hash = '#/module/' + set.id, 900);
  } catch(e){ toast('ctoast', 'err', e.message); }
}
async function submitGen(){
  try {
    const r = await api('POST', '/api/generate', { subject: $('gencubject').value.trim(), notes: $('gennotes').value.trim() });
    toast('gtoast', 'ok', r.message);
    $('gennotes').value = '';
  } catch(e){ toast('gtoast', 'err', e.message); }
}

// ---------- account ----------
let authTab = 'login';
function renderAccount(){
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
  v.innerHTML = `
    <h2 class="section-title" style="margin-top:0">👤 ${esc(ME.name)}</h2>
    <p class="muted" style="margin-bottom:18px">${esc(ME.email)} ${ME.is_pro ? '· <b style="color:#ffd166">PRO</b>' : ''}</p>
    <div class="ctarow" style="justify-content:flex-start;margin-bottom:24px">
      <a class="btn small" href="#/create">✨ New module</a>
      <button class="btn small ghost" onclick="logout()">Sign out</button>
    </div>
    <h2 class="section-title">My modules</h2><div id="mysets"><p class="muted">Loading…</p></div>
    <h2 class="section-title">My best scores</h2><div id="myscores"><p class="muted">Loading…</p></div>`;
  api('GET', '/api/me/sets').then(sets => {
    $('mysets').innerHTML = sets.length ? sets.map(s => `
      <div class="mod"><div class="body"><h3>${esc(s.module)}</h3>
      <div class="meta">${esc(s.subject)} · ${s.questionCount} questions · ${s.plays} plays</div>
      <div class="actions"><a class="btn small ghost" href="#/module/${s.id}">View</a>
      <button class="btn small danger" onclick="delSet(${s.id})">Delete</button></div></div></div>`).join('')
      : '<p class="muted">Nothing yet — <a href="#/create">create your first module</a>.</p>';
  }).catch(() => {});
  api('GET', '/api/me/scores').then(rows => {
    const gname = { quiz: '⚡ Quiz', asteroid: '☄️ Asteroid', match: '🃏 Match' };
    $('myscores').innerHTML = rows.length ? `
      <div class="card"><table class="lb"><tr><th>Module</th><th>Game</th><th>Best</th><th>Acc</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.module)}</td><td>${gname[r.game] || r.game}</td><td>${r.best}</td><td>${Math.round(r.acc)}%</td></tr>`).join('')}
      </table></div>` : '<p class="muted">Play a game to set your first score.</p>';
  }).catch(() => {});
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
function syncNav(){ $('accountlink').textContent = ME ? '👤 ' + ME.name.split(' ')[0] : 'Sign in'; }

// ---------- boot ----------
(async function(){
  try { GAMES = await api('GET', '/api/games'); } catch(e){ GAMES = []; }
  try { ME = await api('GET', '/api/auth/me'); } catch(e){}
  syncNav();
  if (!location.hash) location.hash = '#/';
  route();
})();
