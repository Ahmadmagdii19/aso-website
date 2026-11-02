// ASO Staff Portal — tasks for site staff. Data access is enforced by the database rules.
(() => {
'use strict';
const CFG = window.ASO_PORTAL || {};
const $ = (s, r = document) => r.querySelector(s);
const h = (t, a = {}, ...c) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v); } for (const x of c.flat()) { if (x == null || x === false) continue; e.append(x.nodeType ? x : document.createTextNode(String(x))); } return e; };
const LOGO = 'logo.png';
const ST = { todo: ['To do', 'todo'], prog: ['In progress', 'prog'], wait: ['Waiting for consultant', 'wait'], done: ['Done', 'done'] };
const SRC = { employee: ['Staff', 'e'], aso: ['ASO management', 'm'], consultant: ['Consultant', 'k'], client: ['Client', 'c'] };
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const fmt = (d) => d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
const days = (d) => d ? Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5) : 999;
const initials = (n) => String(n || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.k); toast.k = setTimeout(() => { t.style.display = 'none'; }, 2600); };
const randPw = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint32Array(12)); return [...r].map((x) => a[x % a.length]).join('') + (r[0] % 10) + '!'; };

// ---------- data layer (Supabase). Replaceable in tests via window.__ASO_API
const api = window.__ASO_API || (() => {
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage } });
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async signIn(u, p) { const r = await sb.auth.signInWithPassword({ email: `${u}@${CFG.domain}`, password: p }); if (r.error) throw new Error('Wrong username or password.'); return r.data.user; },
    async session() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    async signOut() { await sb.auth.signOut(); },
    async setPassword(p) { ok(await sb.auth.updateUser({ password: p, data: { must_change: false } })); },
    async me(id) { return ok(await sb.from('profiles').select('*').eq('id', id).maybeSingle()); },
    async profiles() { return ok(await sb.from('profiles').select('id,username,full_name,job_title,role,lead_id,active').order('full_name')); },
    async projects() { return ok(await sb.from('projects').select('id,code,name,location,active').order('code')); },
    async members() { return ok(await sb.from('project_members').select('project_id,user_id')); },
    async setMember(pid, uid, on) { if (on) ok(await sb.from('project_members').upsert({ project_id: pid, user_id: uid }, { ignoreDuplicates: true })); else ok(await sb.from('project_members').delete().eq('project_id', pid).eq('user_id', uid)); },
    async addProject(x) { return ok(await sb.from('projects').insert(x).select().single()); },
    async updateProject(id, x) { return ok(await sb.from('projects').update(x).eq('id', id).select().single()); },
    async tasks() { return ok(await sb.from('tasks').select('*, task_comments(count)').order('due_date', { ascending: true, nullsFirst: false })); },
    async addTask(t) { return ok(await sb.from('tasks').insert(t).select().single()); },
    async updateTask(id, patch) { return ok(await sb.from('tasks').update(patch).eq('id', id).select().single()); },
    async comments(id) { return ok(await sb.from('task_comments').select('*').eq('task_id', id).order('created_at')); },
    async addComment(c) { ok(await sb.from('task_comments').insert(c)); },
    async photos(id) { const rows = ok(await sb.from('task_photos').select('*').eq('task_id', id).order('created_at')); if (!rows.length) return []; const s = ok(await sb.storage.from('task-photos').createSignedUrls(rows.map((r) => r.path), 3600)); return rows.map((r, i) => ({ ...r, url: s[i] && s[i].signedUrl })); },
    async addPhoto(taskId, file) { const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, ''); const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`; ok(await sb.storage.from('task-photos').upload(path, file, { contentType: file.type })); ok(await sb.from('task_photos').insert({ task_id: taskId, path })); },
    async admin(body) { const r = await sb.functions.invoke('admin-users', { body }); if (r.error) { let m = r.error.message; try { m = (await r.error.context.json()).error || m; } catch (e) {} throw new Error(m); } return r.data; },
    async activity() { return ok(await sb.from('activity').select('*').order('at', { ascending: false }).limit(60)); },
  };
})();

let ME = null, PROF = [], PROJ = [], ALLPROJ = [], MEM = [], TASKS = [], VIEW = 'mine', FILTER = 'open', IDLE = null, PJ = 'all';
try { PJ = sessionStorage.getItem('aso_pj') || 'all'; } catch (e) {}
const pById = (id) => ALLPROJ.find((p) => p.id === id) || { code: '—', name: '—' };
const inPJ = (t) => PJ === 'all' || t.project_id === +PJ;
const memOf = (uid) => MEM.filter((m) => m.user_id === uid).map((m) => m.project_id);
const onProj = (uid, pid) => MEM.some((m) => m.user_id === uid && m.project_id === pid);
const setPJ = (v) => { PJ = v; try { sessionStorage.setItem('aso_pj', v); } catch (e) {} };
const RO = () => ME && ME.role === 'viewer';
const byId = (id) => PROF.find((p) => p.id === id) || { full_name: '—' };

// ---------- idle sign-out
const bumpIdle = () => { clearTimeout(IDLE); if (ME) IDLE = setTimeout(async () => { await api.signOut(); ME = null; closeD(); login('Signed out after inactivity.'); }, (CFG.idleMinutes || 30) * 60e3); };
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));

// ---------- sign in
function login(msg) {
  const a = $('#app'); const err = h('div', { class: 'err', role: 'alert' }, msg || '');
  const u = h('input', { class: 'inp', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'username' });
  const p = h('input', { class: 'inp', type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
  const btn = h('button', { class: 'btn pri', style: 'width:100%' }, 'Sign in');
  const go = async () => {
    const un = u.value.trim().toLowerCase(); if (!un || !p.value) { err.textContent = 'Enter your username and password.'; return; }
    btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
    try { const user = await api.signIn(un, p.value); await start(user); }
    catch (e) { err.textContent = e.message || 'Could not sign in.'; btn.disabled = false; btn.textContent = 'Sign in'; }
  };
  btn.addEventListener('click', go); p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); u.addEventListener('keydown', (e) => { if (e.key === 'Enter') p.focus(); });
  a.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'lcard glass' },
    h('img', { src: LOGO, alt: 'ASO Constructions' }), h('h2', {}, 'Staff sign in'), h('p', { class: 'sub' }, 'ASO Contracting · Project portal'),
    h('label', { class: 'fld' }, h('span', {}, 'Username'), u), h('label', { class: 'fld' }, h('span', {}, 'Password'), p), err, btn,
    h('div', { style: 'display:flex;justify-content:space-between;margin-top:14px;font-size:13px' },
      h('a', { href: '/', style: 'color:var(--blue2);text-decoration:none' }, '← Back to website'),
      h('button', { style: 'background:none;border:0;color:var(--tx2);padding:0', onclick: () => toast('Ask your ASO administrator to reset your password.') }, 'Forgot password?')),
    h('div', { class: 'secure' }, '🔒 Encrypted connection · accounts are created by ASO only'))));
  u.focus();
}

async function start(user) {
  const me = await api.me(user.id);
  if (!me || !me.active) { await api.signOut(); throw new Error('This account is not active. Contact your administrator.'); }
  ME = me; bumpIdle();
  if (user.user_metadata && user.user_metadata.must_change) return newPassword(true);
  await reload(); VIEW = ME.role === 'admin' || ME.role === 'viewer' ? 'team' : 'mine'; FILTER = 'open'; app();
}

function newPassword(first) {
  const a = $('#app'); const p1 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password' }), p2 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password' }); const err = h('div', { class: 'err', role: 'alert' });
  const save = async () => {
    if (p1.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
    if (!/[A-Za-z]/.test(p1.value) || !/[0-9]/.test(p1.value)) { err.textContent = 'Use letters and numbers.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'The two passwords do not match.'; return; }
    try { await api.setPassword(p1.value); toast('Password changed'); await reload(); VIEW = ME.role === 'admin' || ME.role === 'viewer' ? 'team' : 'mine'; app(); } catch (e) { err.textContent = e.message; }
  };
  a.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'lcard glass' }, h('img', { src: LOGO, alt: 'ASO Constructions' }),
    h('h2', {}, first ? 'Choose your password' : 'Change password'), h('p', { class: 'sub' }, first ? 'This is your first sign-in. Please replace the temporary password.' : 'At least 10 characters with letters and numbers.'),
    h('label', { class: 'fld' }, h('span', {}, 'New password'), p1), h('label', { class: 'fld' }, h('span', {}, 'Repeat new password'), p2), err,
    h('button', { class: 'btn pri', style: 'width:100%', onclick: save }, 'Save password'),
    first ? null : h('button', { class: 'btn', style: 'width:100%;margin-top:10px', onclick: () => app() }, 'Cancel'))));
  p1.focus();
}

async function reload() { [PROF, ALLPROJ, TASKS, MEM] = await Promise.all([api.profiles(), api.projects(), api.tasks(), api.members()]); PROJ = ALLPROJ.filter((p) => p.active); if (PJ !== 'all' && !PROJ.some((p) => p.id === +PJ)) setPJ(PROJ.length === 1 ? String(PROJ[0].id) : 'all'); if (PJ === 'all' && PROJ.length === 1) setPJ(String(PROJ[0].id)); }

// ---------- main shell
function app() {
  const a = $('#app');
  const tabs = ME.role === 'admin' ? [['team', 'Team'], ['all', 'All tasks'], ['projects', 'Projects'], ['users', 'Users']] : ME.role === 'viewer' ? [['team', 'Overview'], ['all', 'All tasks']] : ME.role === 'engineer' ? [['mine', 'My tasks'], ['teamv', 'My team']] : [];
  a.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'wrap' }, h('img', { src: LOGO, alt: 'ASO' }), projPick(),
      h('div', { class: 'me' }, h('div', { class: 'nm' }, h('b', {}, ME.full_name), h('span', {}, ME.job_title || ME.role)), h('div', { class: 'av', title: 'Change password', style: 'cursor:pointer', onclick: () => newPassword(false) }, initials(ME.full_name)),
        h('button', { class: 'btn sm', onclick: async () => { await api.signOut(); ME = null; closeD(); login(); } }, 'Sign out')))),
    h('main', { class: 'wrap' }, tabs.length ? h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: VIEW === k ? 'on' : null, onclick: () => { VIEW = k; app(); } }, l))) : null, h('div', { id: 'view' })));
  if (VIEW === 'users') users(); else if (VIEW === 'team') team(); else if (VIEW === 'projects') projects(); else tasks();
}
function projPick() {
  if (!PROJ.length) return h('div', { class: 'proj' }, h('b', {}, 'ASO projects'), h('span', {}, 'No project assigned yet'));
  if (PROJ.length === 1) return h('div', { class: 'proj' }, h('b', {}, PROJ[0].name), h('span', {}, PROJ[0].code + (PROJ[0].location ? ' · ' + PROJ[0].location : '')));
  const sel = h('select', { class: 'pjsel', 'aria-label': 'Project', onchange: (e) => { setPJ(e.target.value); app(); } }, h('option', { value: 'all', selected: PJ === 'all' }, `All projects (${PROJ.length})`), PROJ.map((p) => h('option', { value: String(p.id), selected: PJ === String(p.id) }, p.code + ' · ' + p.name)));
  const cur = PROJ.find((p) => String(p.id) === PJ);
  return h('div', { class: 'proj' }, sel, h('span', {}, cur ? cur.code + (cur.location ? ' · ' + cur.location : '') : 'Showing every project you are on'));
}

const mineList = () => { const T = TASKS.filter(inPJ); return VIEW === 'mine' ? T.filter((t) => t.owner_id === ME.id) : VIEW === 'teamv' ? T.filter((t) => t.owner_id !== ME.id) : T; };
function tasks() {
  const v = $('#view'); const T = mineList();
  const open = T.filter((t) => t.status !== 'done'), late = open.filter((t) => days(t.due_date) < 0), week = open.filter((t) => days(t.due_date) >= 0 && days(t.due_date) <= 7), done = T.filter((t) => t.status === 'done');
  const F = { open: ['Open', open], late: ['Overdue', late], wait: ['Waiting for consultant', T.filter((t) => t.status === 'wait')], done: ['Done', done], all: ['All', T] };
  const L = (F[FILTER] || F.open)[1];
  v.replaceChildren(
    h('div', { class: 'hd' }, h('div', {}, h('div', { class: 'lbl' }, RO() ? 'View only · everyone' : VIEW === 'all' ? 'Everyone' : VIEW === 'teamv' ? 'My team' : 'Hello, ' + ME.full_name.split(' ')[0]), h('h1', {}, VIEW === 'all' ? 'All tasks' : VIEW === 'teamv' ? 'Team tasks' : 'My tasks')),
      h('div', { style: 'display:flex;gap:10px;align-items:center' }, h('button', { class: 'refresh', onclick: async () => { await reload(); tasks(); toast('Updated'); } }, '↻ Refresh'), RO() ? null : h('button', { class: 'btn pri', onclick: () => newTask() }, '+ New task'))),
    h('div', { class: 'stats' }, h('div', { class: 'stat glass' }, h('span', { class: 'lbl' }, 'Open'), h('b', {}, String(open.length))), h('div', { class: 'stat glass warn' }, h('span', { class: 'lbl' }, 'Due this week'), h('b', {}, String(week.length))),
      h('div', { class: 'stat glass bad' }, h('span', { class: 'lbl' }, 'Overdue'), h('b', {}, String(late.length))), h('div', { class: 'stat glass ok' }, h('span', { class: 'lbl' }, 'Done'), h('b', {}, String(done.length)))),
    h('div', { class: 'filters' }, Object.entries(F).map(([k, [l, arr]]) => h('button', { class: 'chip' + (FILTER === k ? ' on' : ''), onclick: () => { FILTER = k; tasks(); } }, `${l} · ${arr.length}`))),
    h('div', { class: 'list' }, L.length ? L.map(card) : h('div', { class: 'empty glass' }, 'Nothing here yet.')));
}
function card(t) {
  const dd = days(t.due_date), late = t.status !== 'done' && dd < 0; const nC = (t.task_comments && t.task_comments[0] && t.task_comments[0].count) || 0;
  return h('button', { class: 'task', style: 'border-radius:var(--r)', onclick: () => openTask(t.id) },
    h('div', {}, h('h3', {}, t.title), h('div', { class: 'meta', style: 'margin-top:8px' }, PJ === 'all' && PROJ.length > 1 ? h('span', { class: 'pj' }, pById(t.project_id).code) : null, t.wbs_code ? h('span', { class: 'code' }, t.wbs_code) : null, t.area ? h('span', {}, t.area) : null,
      h('span', { class: late ? 'late' : null }, late ? `Overdue ${-dd}d · ${fmt(t.due_date)}` : `Due ${fmt(t.due_date)}`), t.owner_id !== ME.id ? h('span', {}, '👤 ' + byId(t.owner_id).full_name) : null, nC ? h('span', {}, '💬 ' + nC) : null)),
    h('div', { class: 'right' }, h('span', { class: 'pill ' + ST[t.status][1] }, ST[t.status][0]), h('div', { class: 'prog' }, h('div', { class: 'bar' + (t.status === 'done' ? ' done' : '') }, h('i', { style: `width:${t.progress}%` })), h('span', { style: 'font-size:13px;color:var(--tx2);width:38px;text-align:right' }, t.progress + '%'))));
}

// ---------- task panel
function closeD() { $('#drw').classList.remove('on'); $('#ov').classList.remove('on'); }
$('#ov').addEventListener('click', closeD);
async function save(t, patch) {
  try { const r = await api.updateTask(t.id, patch); Object.assign(t, r); refreshList(); openTask(t.id, true); toast('Saved'); } catch (e) { toast(e.message); }
}
function refreshList() { if (VIEW === 'team') team(); else if (VIEW !== 'users') tasks(); }
async function openTask(id, keep) {
  const t = TASKS.find((x) => x.id === id); if (!t) return; const d = $('#drw');
  if (!keep) { d.replaceChildren(h('div', { class: 'load' }, 'Loading…')); d.classList.add('on'); $('#ov').classList.add('on'); }
  let cm = [], ph = []; try { [cm, ph] = await Promise.all([api.comments(id), api.photos(id)]); } catch (e) { toast(e.message); }
  const lead = ME.role === 'admin' || ME.role === 'engineer'; const ro = RO();
  const rng = h('input', { type: 'range', min: 0, max: 100, step: 5, value: t.progress, 'aria-label': 'Progress' }); const pv = h('b', {}, t.progress + '%');
  rng.addEventListener('input', () => { pv.textContent = rng.value + '%'; });
  rng.addEventListener('change', () => { const p = +rng.value; save(t, { progress: p, status: p === 100 ? 'done' : t.status === 'todo' && p > 0 ? 'prog' : t.status }); });
  const txt = h('textarea', { class: 'inp', placeholder: 'Write a comment…', rows: 2, maxlength: 4000 });
  const srcSel = h('select', { class: 'inp', 'aria-label': 'Comment from' }, (lead ? ['aso', 'consultant', 'client', 'employee'] : ['employee', 'consultant', 'client']).map((k) => h('option', { value: k }, k === 'employee' ? 'Me' : SRC[k][0] + (lead || k === 'employee' ? '' : ' (said)'))));
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = fileIn.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) { toast('Photo is larger than 8 MB'); return; } toast('Uploading…'); try { await api.addPhoto(t.id, f); openTask(t.id, true); toast('Photo added'); } catch (e) { toast(e.message); } } });
  d.replaceChildren(
    h('div', { class: 'dh' }, h('div', {}, t.wbs_code ? h('span', { class: 'code' }, t.wbs_code) : null, h('h2', {}, t.title), h('div', { class: 'meta', style: 'margin-top:8px' }, h('span', { class: 'pj' }, pById(t.project_id).code + ' · ' + pById(t.project_id).name), t.area ? h('span', {}, t.area) : null, h('span', {}, 'Due ' + fmt(t.due_date)), h('span', {}, '👤 ' + byId(t.owner_id).full_name))), h('button', { class: 'x', onclick: closeD, 'aria-label': 'Close' }, '×')),
    h('div', { class: 'db' },
      h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Status'), ro ? h('span', { class: 'pill ' + ST[t.status][1] }, ST[t.status][0]) : h('div', { class: 'seg' }, Object.entries(ST).map(([k, [l]]) => h('button', { class: t.status === k ? 'on' : null, onclick: () => save(t, { status: k }) }, l)))),
      h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Progress'), ro ? h('div', { class: 'prog' }, h('div', { class: 'bar' }, h('i', { style: `width:${t.progress}%` })), h('b', {}, t.progress + '%')) : h('div', { style: 'display:flex;gap:14px;align-items:center' }, rng, pv)),
      t.details ? h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Details'), h('p', { style: 'margin:0;line-height:1.55;color:var(--tx2);white-space:pre-wrap' }, t.details)) : null,
      t.doc_ref ? h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Linked submittal'), h('div', { class: 'doc' }, '📄 ', h('span', {}, t.doc_ref), t.doc_code ? h('span', { class: 'cd' }, 'Code ' + t.doc_code) : null)) : null,
      h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Site photos'), h('div', { class: 'photos' }, ph.map((p) => h('a', { class: 'ph img', href: p.url, target: '_blank', rel: 'noopener' }, h('img', { src: p.url, alt: 'Site photo' }))), ro ? (ph.length ? null : h('span', { style: 'color:var(--tx3)' }, 'No photos yet.')) : h('label', { class: 'ph', style: 'cursor:pointer' }, '+ Add', fileIn))),
      h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, `Comments · ${cm.length}`), cm.length ? cm.map((c) => h('div', { class: 'cm' }, h('div', { class: 'who' }, h('span', { class: 'src ' + SRC[c.source][1] }, SRC[c.source][0]), byId(c.author_id).full_name, ' · ', fmt(c.created_at)), h('p', {}, c.body))) : h('p', { style: 'color:var(--tx3);margin:0' }, 'No comments yet.'),
        ro ? null : h('div', { class: 'addc' }, srcSel, txt), ro ? null : h('div', { style: 'display:flex;justify-content:flex-end;margin-top:8px' }, h('button', { class: 'btn sm pri', onclick: async () => { const b = txt.value.trim(); if (!b) return; try { await api.addComment({ task_id: t.id, body: b, source: srcSel.value, author_id: ME.id }); const r = TASKS.find((x) => x.id === t.id); if (r && r.task_comments && r.task_comments[0]) r.task_comments[0].count++; openTask(t.id, true); refreshList(); toast('Comment posted'); } catch (e) { toast(e.message); } } }, 'Post comment'))),
      lead ? h('div', { class: 'sec' }, h('h4', { class: 'lbl' }, 'Manage'), h('div', { class: 'row2' },
        h('label', { class: 'fld' }, h('span', {}, 'Assigned to'), h('select', { class: 'inp', onchange: (e) => save(t, { owner_id: e.target.value }) }, PROF.filter((p) => p.active && p.role !== 'admin' && p.role !== 'viewer' && (onProj(p.id, t.project_id) || p.id === t.owner_id) && (ME.role === 'admin' || p.id === ME.id || p.lead_id === ME.id)).map((p) => h('option', { value: p.id, selected: p.id === t.owner_id }, p.full_name)))),
        h('label', { class: 'fld' }, h('span', {}, 'Due date'), h('input', { class: 'inp', type: 'date', value: t.due_date || '', onchange: (e) => save(t, { due_date: e.target.value || null }) }))),
        h('div', { class: 'row2' }, h('label', { class: 'fld' }, h('span', {}, 'Linked MIR / RFI / MTS'), h('input', { class: 'inp', value: t.doc_ref, maxlength: 80, onchange: (e) => save(t, { doc_ref: e.target.value }) })),
          h('label', { class: 'fld' }, h('span', {}, 'Consultant code'), h('select', { class: 'inp', onchange: (e) => save(t, { doc_code: e.target.value }) }, ['', 'A', 'B', 'C', 'D'].map((c) => h('option', { value: c, selected: c === t.doc_code }, c || '—')))))) : null));
  if (!keep) { d.classList.add('on'); $('#ov').classList.add('on'); }
}

// ---------- new task
function newTask() {
  const m = $('#mbox');
  const f = { title: h('input', { class: 'inp', maxlength: 200, placeholder: 'e.g. Blockwork Level 2, Zone B' }), wbs: h('input', { class: 'inp', maxlength: 20, placeholder: 'e.g. CIV.BLK-01', list: 'wbs-dl' }), area: h('input', { class: 'inp', maxlength: 120, placeholder: 'e.g. Level 2 · Zone B' }), due: h('input', { class: 'inp', type: 'date' }), details: h('textarea', { class: 'inp', maxlength: 4000, placeholder: 'What needs to be done' }) };
  const dl = h('datalist', { id: 'wbs-dl' }, ['CIV.BLK-01', 'CIV.PLS-01', 'CIV.WPF-01', 'CIV.DEM-01', 'GEN.LAB-01'].map((x) => h('option', { value: x })));
  const base = ME.role === 'admin' ? PROF.filter((p) => p.active && p.role !== 'admin' && p.role !== 'viewer') : ME.role === 'engineer' ? PROF.filter((p) => p.active && (p.id === ME.id || p.lead_id === ME.id)) : [];
  const proj = PROJ.length > 1 ? h('select', { class: 'inp' }, PROJ.map((p) => h('option', { value: p.id, selected: String(p.id) === PJ }, p.code + ' · ' + p.name))) : null;
  const pid = () => proj ? +proj.value : (PROJ[0] || {}).id;
  const own = base.length ? h('select', { class: 'inp' }) : null;
  const fillOwn = () => { if (!own) return; const L = base.filter((p) => onProj(p.id, pid())); own.replaceChildren(...(L.length ? L.map((p) => h('option', { value: p.id, selected: p.id === ME.id }, p.full_name)) : [h('option', { value: '' }, '— nobody is assigned to this project —')])); };
  if (proj) proj.addEventListener('change', fillOwn); fillOwn();
  const err = h('div', { class: 'err' });
  m.replaceChildren(dl, h('h2', {}, 'New task'), h('label', { class: 'fld' }, h('span', {}, 'Title'), f.title), h('div', { class: 'row2' }, h('label', { class: 'fld' }, h('span', {}, 'WBS code'), f.wbs), h('label', { class: 'fld' }, h('span', {}, 'Due date'), f.due)),
    h('label', { class: 'fld' }, h('span', {}, 'Area / location'), f.area), proj ? h('label', { class: 'fld' }, h('span', {}, 'Project'), proj) : null, own ? h('label', { class: 'fld' }, h('span', {}, 'Assign to'), own) : null, h('label', { class: 'fld' }, h('span', {}, 'Details'), f.details), err,
    h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => $('#modal').classList.remove('on') }, 'Cancel'),
      h('button', { class: 'btn pri', onclick: async () => {
        if (f.title.value.trim().length < 3) { err.textContent = 'Add a title (at least 3 characters).'; f.title.focus(); return; }
        if (!PROJ.length) { err.textContent = 'You are not assigned to a project yet. Ask ASO to add you.'; return; }
        if (own && !own.value) { err.textContent = 'Assign people to this project first (Projects tab).'; return; }
        try { const r = await api.addTask({ project_id: pid(), owner_id: own ? own.value : ME.id, title: f.title.value.trim(), wbs_code: f.wbs.value.trim().toUpperCase(), area: f.area.value.trim(), due_date: f.due.value || null, details: f.details.value.trim() });
          TASKS.push({ ...r, task_comments: [{ count: 0 }] }); $('#modal').classList.remove('on'); FILTER = 'open'; if (VIEW === 'team' || VIEW === 'users') VIEW = 'all'; app(); toast('Task added'); } catch (e) { err.textContent = e.message; }
      } }, 'Add task')));
  $('#modal').classList.add('on'); f.title.focus();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.classList.remove('on'); });

// ---------- admin: team overview
function team() {
  const v = $('#view'); const staff = PROF.filter((p) => p.role !== 'admin' && p.role !== 'viewer' && (PJ === 'all' || onProj(p.id, +PJ))); const TT = TASKS.filter(inPJ);
  const open = TT.filter((t) => t.status !== 'done'), late = open.filter((t) => days(t.due_date) < 0);
  v.replaceChildren(h('div', { class: 'hd' }, h('div', {}, h('div', { class: 'lbl' }, RO() ? 'View only' : 'Admin'), h('h1', {}, 'Team overview')), h('div', { style: 'display:flex;gap:10px;align-items:center' }, h('button', { class: 'refresh', onclick: async () => { await reload(); team(); toast('Updated'); } }, '↻ Refresh'), RO() ? null : h('button', { class: 'btn pri', onclick: () => newTask() }, '+ New task'))),
    h('div', { class: 'stats' }, h('div', { class: 'stat glass' }, h('span', { class: 'lbl' }, 'Active staff'), h('b', {}, String(staff.filter((p) => p.active).length))), h('div', { class: 'stat glass' }, h('span', { class: 'lbl' }, 'Open tasks'), h('b', {}, String(open.length))), h('div', { class: 'stat glass bad' }, h('span', { class: 'lbl' }, 'Overdue'), h('b', {}, String(late.length))), h('div', { class: 'stat glass warn' }, h('span', { class: 'lbl' }, 'Waiting consultant'), h('b', {}, String(TASKS.filter((t) => t.status === 'wait').length)))),
    staff.length ? h('div', { class: 'team' }, staff.map((x) => { const T = TT.filter((t) => t.owner_id === x.id), o = T.filter((t) => t.status !== 'done'), l = o.filter((t) => days(t.due_date) < 0), avg = T.length ? Math.round(T.reduce((s, t) => s + t.progress, 0) / T.length) : 0;
      return h('div', { class: 'mem glass' + (x.active ? '' : ' off') }, h('div', { class: 't' }, h('div', { class: 'av' }, initials(x.full_name)), h('div', {}, h('b', {}, x.full_name), h('div', { style: 'font-size:12.5px;color:var(--tx3)' }, (x.job_title || x.role) + (x.active ? '' : ' · disabled')))),
        h('div', { class: 'n' }, h('div', {}, h('b', {}, String(o.length)), 'open'), h('div', { class: 'bad' }, h('b', {}, String(l.length)), 'overdue'), h('div', {}, h('b', {}, avg + '%'), 'avg progress')), h('div', { class: 'bar' }, h('i', { style: `width:${avg}%` }))); })) : h('div', { class: 'empty glass' }, PJ === 'all' ? 'No staff yet — add them under Users.' : 'Nobody is assigned to this project yet — use the Projects tab.'),
    h('h3', { class: 'lbl', style: 'margin:8px 0 12px' }, 'Needs attention'),
    h('div', { class: 'list' }, (() => { const L = TT.filter((t) => t.status !== 'done' && (days(t.due_date) < 0 || t.status === 'wait')); return L.length ? L.map(card) : h('div', { class: 'empty glass' }, 'Nothing overdue or waiting.'); })()));
}

// ---------- admin: projects
function projects() {
  const v = $('#view'); const staff = PROF.filter((p) => p.role !== 'admin' && p.role !== 'viewer');
  const tog = async (pid, uid, on) => { try { await api.setMember(pid, uid, on); await reload(); projects(); toast(on ? 'Added to project' : 'Removed from project'); } catch (e) { toast(e.message); } };
  v.replaceChildren(h('div', { class: 'hd' }, h('div', {}, h('div', { class: 'lbl' }, 'Admin only'), h('h1', {}, 'Projects')), h('button', { class: 'btn pri', onclick: () => editProject() }, '+ Add project')),
    h('p', { style: 'color:var(--tx3);font-size:13.5px;line-height:1.6;max-width:760px;margin:-6px 0 18px' }, 'Tick who works on each project. Staff only see the projects they are ticked on, and tasks can only be given to people on that project.'),
    ALLPROJ.length ? h('div', { class: 'pjs' }, ALLPROJ.map((p) => { const n = TASKS.filter((t) => t.project_id === p.id && t.status !== 'done').length;
      return h('div', { class: 'pjc glass' + (p.active ? '' : ' off') }, h('div', { class: 'pjh' }, h('div', {}, h('span', { class: 'pj' }, p.code), h('h3', {}, p.name), h('div', { class: 'sub' }, (p.location || '') + (p.location ? ' · ' : '') + n + ' open tasks' + (p.active ? '' : ' · closed'))),
          h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn sm', onclick: () => editProject(p) }, 'Edit'), h('button', { class: 'btn sm', onclick: async () => { try { await api.updateProject(p.id, { active: !p.active }); await reload(); app(); toast(p.active ? 'Project closed' : 'Project reopened'); } catch (e) { toast(e.message); } } }, p.active ? 'Close' : 'Reopen'))),
        staff.length ? h('div', { class: 'chk' }, staff.map((x) => h('label', { class: x.active ? null : 'off' }, h('input', { type: 'checkbox', checked: onProj(x.id, p.id), onchange: (e) => tog(p.id, x.id, e.target.checked) }), ' ' + x.full_name + (x.job_title ? ' · ' + x.job_title : '')))) : h('div', { class: 'sub' }, 'No staff yet — add them under Users.')); })) : h('div', { class: 'empty glass' }, 'No projects yet.'));
}
function editProject(p) {
  const m = $('#mbox'); const c = h('input', { class: 'inp', maxlength: 20, placeholder: 'e.g. ASO-J26-005', value: p ? p.code : '' }), n = h('input', { class: 'inp', maxlength: 120, placeholder: 'Project name', value: p ? p.name : '' }), l = h('input', { class: 'inp', maxlength: 120, placeholder: 'e.g. Jeddah Airport', value: p ? p.location : '' }); const err = h('div', { class: 'err' });
  m.replaceChildren(h('h2', {}, p ? 'Edit project' : 'Add project'), h('div', { class: 'row2' }, h('label', { class: 'fld' }, h('span', {}, 'Job code'), c), h('label', { class: 'fld' }, h('span', {}, 'Location'), l)), h('label', { class: 'fld' }, h('span', {}, 'Project name'), n), err,
    h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => $('#modal').classList.remove('on') }, 'Cancel'),
      h('button', { class: 'btn pri', onclick: async () => { const x = { code: c.value.trim().toUpperCase(), name: n.value.trim(), location: l.value.trim() }; if (!x.code || !x.name) { err.textContent = 'Enter a job code and a name.'; return; }
        try { if (p) await api.updateProject(p.id, x); else await api.addProject(x); $('#modal').classList.remove('on'); await reload(); app(); toast(p ? 'Project saved' : 'Project added'); } catch (e) { err.textContent = /duplicate/i.test(e.message) ? 'That job code already exists.' : e.message; } } }, p ? 'Save' : 'Add project')));
  $('#modal').classList.add('on'); (p ? n : c).focus();
}

// ---------- admin: users
function users() {
  const v = $('#view'); const tb = h('tbody'); const leads = PROF.filter((p) => p.role === 'engineer' && p.active);
  const act = async (body, msg) => { try { await api.admin(body); await reload(); users(); toast(msg); } catch (e) { toast(e.message); } };
  PROF.forEach((x) => tb.append(h('tr', { class: x.active ? null : 'off' }, h('td', {}, h('b', {}, x.full_name)), h('td', {}, x.username), h('td', {}, x.job_title), h('td', {}, x.role === 'admin' ? 'Admin' : x.role === 'viewer' ? 'Viewer (sees everything, read-only)' : x.role === 'engineer' ? 'Engineer (sees team)' : 'Employee (own tasks)'),
    h('td', {}, x.lead_id ? byId(x.lead_id).full_name : '—'), h('td', {}, x.role === 'admin' || x.role === 'viewer' ? 'All' : (memOf(x.id).map((id) => pById(id).code).join(', ') || '—')), h('td', {}, x.active ? 'Active' : 'Disabled'),
    h('td', { style: 'white-space:nowrap' }, x.role === 'admin' ? '—' : [h('button', { class: 'btn sm', onclick: () => resetPw(x) }, 'Reset password'), ' ', h('button', { class: 'btn sm', onclick: () => act({ action: x.active ? 'disable' : 'enable', id: x.id }, x.active ? 'Account disabled – sign-in blocked' : 'Account enabled') }, x.active ? 'Disable' : 'Enable')]))));
  v.replaceChildren(h('div', { class: 'hd' }, h('div', {}, h('div', { class: 'lbl' }, 'Admin only'), h('h1', {}, 'Users')), h('button', { class: 'btn pri', onclick: () => addUser(leads) }, '+ Add user')),
    h('div', { class: 'tbl glass' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Username', 'Job title', 'Access', 'Reports to', 'Projects', 'Status', ''].map((x) => h('th', {}, x)))), tb)),
    h('p', { style: 'color:var(--tx3);font-size:13.5px;line-height:1.6;max-width:760px' }, 'Only you can create accounts. A disabled account is blocked at sign-in immediately. Each person only ever receives the tasks the database rules allow.'));
}
function showPw(title, who, pw) {
  const m = $('#mbox'); m.replaceChildren(h('h2', {}, title), h('p', { style: 'color:var(--tx2);line-height:1.6' }, `Give these sign-in details to ${who} in person or by WhatsApp. They must choose their own password the first time they sign in.`), h('div', { class: 'pw' }, pw), h('div', { style: 'display:flex;justify-content:flex-end;margin-top:16px' }, h('button', { class: 'btn pri', onclick: () => $('#modal').classList.remove('on') }, 'Done')));
  $('#modal').classList.add('on');
}
async function resetPw(x) { const pw = randPw(); try { await api.admin({ action: 'reset', id: x.id, password: pw }); showPw('Password reset', x.full_name, `Username: ${x.username}\nTemporary password: ${pw}`); } catch (e) { toast(e.message); } }
function addUser(leads) {
  const m = $('#mbox'); const n = h('input', { class: 'inp', maxlength: 80, placeholder: 'Full name' }), u = h('input', { class: 'inp', maxlength: 40, autocapitalize: 'none', placeholder: 'e.g. m.hassan' }), r = h('input', { class: 'inp', maxlength: 80, placeholder: 'e.g. Plaster Foreman' });
  const ro = h('select', { class: 'inp' }, h('option', { value: 'employee' }, 'Employee – own tasks only'), h('option', { value: 'engineer' }, 'Engineer – own + team tasks'), h('option', { value: 'viewer' }, 'Viewer – sees all projects & tasks, read-only'));
  const ld = h('select', { class: 'inp' }, h('option', { value: '' }, '— none —'), leads.map((p) => h('option', { value: p.id }, p.full_name))); const err = h('div', { class: 'err' });
  const pc = PROJ.map((p) => ({ p, c: h('input', { type: 'checkbox', checked: PJ === String(p.id) || PROJ.length === 1 }) }));
  m.replaceChildren(h('h2', {}, 'Add user'), h('label', { class: 'fld' }, h('span', {}, 'Full name'), n), h('div', { class: 'row2' }, h('label', { class: 'fld' }, h('span', {}, 'Username'), u), h('label', { class: 'fld' }, h('span', {}, 'Job title'), r)),
    h('div', { class: 'row2' }, h('label', { class: 'fld' }, h('span', {}, 'Access'), ro), h('label', { class: 'fld' }, h('span', {}, 'Reports to (engineer)'), ld)),
    h('div', { class: 'fld', id: 'pjf' }, h('span', {}, 'Projects'), h('div', { class: 'chk' }, pc.map(({ p, c }) => h('label', {}, c, ' ' + p.code + ' · ' + p.name)))), err,
    h('div', { style: 'display:flex;gap:10px;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => $('#modal').classList.remove('on') }, 'Cancel'),
      h('button', { class: 'btn pri', onclick: async () => {
        const un = u.value.trim().toLowerCase(); if (!n.value.trim() || !/^[a-z0-9._-]{2,40}$/.test(un)) { err.textContent = 'Enter a name and a username (letters, numbers, dot, dash).'; return; }
        const pw = randPw();
        if (ro.value !== 'viewer' && !pc.some(({ c }) => c.checked)) { err.textContent = 'Tick at least one project.'; return; }
        try { const res = await api.admin({ action: 'create', username: un, full_name: n.value.trim(), job_title: r.value.trim(), role: ro.value, lead_id: ld.value || null, password: pw }); if (ro.value !== 'viewer') for (const { p, c } of pc) if (c.checked) await api.setMember(p.id, res.id, true); await reload(); users(); showPw('User created', n.value.trim(), `Username: ${un}\nTemporary password: ${pw}`); } catch (e) { err.textContent = e.message; }
      } }, 'Create user')));
  ro.addEventListener('change', () => { const f = $('#pjf'); if (f) f.style.display = ro.value === 'viewer' ? 'none' : ''; });
  $('#modal').classList.add('on'); n.focus();
}

// ---------- boot
(async () => {
  if (!window.__ASO_API && (!CFG.url || CFG.url.startsWith('__'))) { $('#app').replaceChildren(h('div', { class: 'load' }, 'Portal is not connected yet.')); return; }
  try { const u = await api.session(); if (u) await start(u); else login(); } catch (e) { login(e.message); }
})();
})();
