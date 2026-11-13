import { html, mount, api, icon, $, $$, on, initials, timeAgo, toast, loading, errorState, modal, field, formValues } from './lib.js';

export const store = { me: null, meta: null, childId: null, children: [] };

const NAV = {
  admin: [
    ['Overview', [['', 'Dashboard', 'dashboard'], ['attendance', 'Mark Attendance', 'attendance'], ['attendance-reports', 'Attendance Records', 'history'], ['homework', 'Homework', 'book']]],
    ['Management', [['students', 'Students', 'cap'], ['teachers', 'Teachers', 'users'], ['parents', 'Parents', 'user'], ['classes', 'Classes & Subjects', 'layers']]],
    ['Communication', [['announcements', 'Announcements', 'megaphone'], ['calendar', 'School Calendar', 'calendar'], ['reports', 'Reports', 'chart']]],
    ['System', [['settings', 'Settings', 'settings']]],
  ],
  teacher: [
    ['My Work', [['', 'Dashboard', 'dashboard'], ['attendance', 'Mark Attendance', 'attendance'], ['attendance-reports', 'Attendance Records', 'history'], ['homework', 'Homework', 'book'], ['my-students', 'My Students', 'cap']]],
    ['Communication', [['announcements', 'Announcements', 'megaphone'], ['calendar', 'Calendar', 'calendar'], ['reports', 'Reports', 'chart']]],
  ],
  parent: [
    ['My Children', [['', 'Dashboard', 'home'], ['attendance', 'Attendance', 'attendance'], ['homework', 'Homework', 'book'], ['remarks', 'Teacher Remarks', 'message']]],
    ['School', [['announcements', 'Notices', 'megaphone'], ['calendar', 'Calendar', 'calendar']]],
  ],
  student: [
    ['My School', [['', 'Dashboard', 'home'], ['attendance', 'My Attendance', 'attendance'], ['homework', 'Homework', 'book'], ['remarks', 'Remarks', 'message']]],
    ['School', [['announcements', 'Notices', 'megaphone'], ['calendar', 'Calendar', 'calendar']]],
  ],
};
const BOTTOM = {
  admin: [['', 'Home', 'dashboard'], ['attendance', 'Attendance', 'attendance'], ['students', 'Students', 'cap'], ['reports', 'Reports', 'chart']],
  teacher: [['', 'Home', 'dashboard'], ['attendance', 'Attendance', 'attendance'], ['homework', 'Homework', 'book'], ['my-students', 'Students', 'cap']],
  parent: [['', 'Home', 'home'], ['attendance', 'Attendance', 'attendance'], ['homework', 'Homework', 'book'], ['announcements', 'Notices', 'megaphone']],
  student: [['', 'Home', 'home'], ['attendance', 'Attendance', 'attendance'], ['homework', 'Homework', 'book'], ['announcements', 'Notices', 'megaphone']],
};
const ROLE_LABEL = { admin: 'School Admin', teacher: 'Teacher', parent: 'Parent', student: 'Student' };

// route table: pattern → [module, title]
const ROUTES = {
  admin: { '': ['admin-dashboard', 'Dashboard'], attendance: ['attendance', 'Mark Attendance'], 'attendance-reports': ['attendance-records', 'Attendance Records'], homework: ['homework', 'Homework'], 'homework/new': ['homework', 'New Homework'], 'homework/:id': ['homework', 'Homework'], 'homework/:id/edit': ['homework', 'Edit Homework'], students: ['students', 'Students'], 'students/:id': ['student-profile', 'Student Profile'], teachers: ['teachers', 'Teachers'], parents: ['parents', 'Parents'], classes: ['classes', 'Classes & Subjects'], reports: ['reports', 'Reports'], announcements: ['announcements', 'Announcements'], calendar: ['calendar', 'School Calendar'], notifications: ['notifications', 'Notifications'], settings: ['settings', 'Settings'], profile: ['profile', 'My Profile'] },
  teacher: { '': ['teacher-dashboard', 'Dashboard'], attendance: ['attendance', 'Mark Attendance'], 'attendance-reports': ['attendance-records', 'Attendance Records'], homework: ['homework', 'Homework'], 'homework/new': ['homework', 'New Homework'], 'homework/:id': ['homework', 'Homework'], 'homework/:id/edit': ['homework', 'Edit Homework'], 'my-students': ['my-students', 'My Students'], 'students/:id': ['student-profile', 'Student Profile'], reports: ['reports', 'Reports'], announcements: ['announcements', 'Announcements'], calendar: ['calendar', 'Calendar'], notifications: ['notifications', 'Notifications'], profile: ['profile', 'My Profile'] },
  parent: { '': ['family-dashboard', 'Dashboard'], attendance: ['family-attendance', 'Attendance'], homework: ['family-homework', 'Homework'], 'homework/:id': ['family-homework', 'Homework'], remarks: ['family-remarks', 'Teacher Remarks'], announcements: ['announcements', 'School Notices'], calendar: ['calendar', 'Calendar'], notifications: ['notifications', 'Notifications'], profile: ['profile', 'My Profile'] },
  student: { '': ['family-dashboard', 'Dashboard'], attendance: ['family-attendance', 'My Attendance'], homework: ['family-homework', 'Homework'], 'homework/:id': ['family-homework', 'Homework'], remarks: ['family-remarks', 'Remarks'], announcements: ['announcements', 'School Notices'], calendar: ['calendar', 'Calendar'], notifications: ['notifications', 'Notifications'], profile: ['profile', 'My Profile'] },
};

function resolve(path) {
  const table = ROUTES[store.me.role];
  const segs = path.split('/').filter(Boolean);
  for (const [pat, def] of Object.entries(table)) {
    const ps = pat.split('/').filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params = {};
    if (ps.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(segs[i])), /^\d+$/.test(segs[i])) : p === segs[i]))) return { mod: def[0], title: def[1], params, pattern: pat };
  }
  return null;
}

export const navigate = (path) => { location.hash = '#/' + path.replace(/^#?\/?/, ''); };
export function currentPath() { return location.hash.replace(/^#\/?/, '').split('?')[0]; }
export function hashQuery() { return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')); }
export function setQuery(q) {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v != null)).toString();
  history.replaceState(null, '', `#/${currentPath()}${s ? '?' + s : ''}`);
}

// ---------- boot ----------
async function boot() {
  try { store.me = await api('/api/auth/me'); } catch { store.me = null; }
  if (!store.me) return showLogin();
  try {
    store.meta = await api('/api/meta');
    if (store.me.role === 'parent') {
      store.children = (await api('/api/parent/children')).rows;
      let saved = null; try { saved = Number(localStorage.getItem('childId')); } catch { /* storage unavailable */ }
      store.childId = store.children.find((c) => c.id === saved)?.id || store.children[0]?.id || null;
    }
    if (store.me.role === 'student') store.childId = store.me.student_id;
  } catch (e) { return errorState(document.getElementById('app'), e, boot); }
  renderShell();
  window.addEventListener('hashchange', route);
  route();
  if (store.me.must_change_password) promptPasswordChange();
  setInterval(refreshBell, 60000);
}
async function showLogin() {
  const { default: render } = await import('./pages/login.js');
  render(document.getElementById('app'), { onLogin: () => location.reload() });
}
window.addEventListener('unauthorized', () => { if (store.me) { store.me = null; toast('Your session has ended. Please sign in again.', 'error'); setTimeout(() => location.replace('/'), 800); } });

export function setChild(id) {
  store.childId = Number(id);
  try { localStorage.setItem('childId', String(id)); } catch { /* ignore */ }
  route();
}

// ---------- shell ----------
function renderShell() {
  const { me, meta } = store;
  const groups = NAV[me.role];
  const sub = me.role === 'teacher' && me.class_teacher_of?.length ? `Class Teacher · ${me.class_teacher_of.map((c) => c.label).join(', ')}` : ROLE_LABEL[me.role];
  mount(document.getElementById('app'), html`
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-logo">${icon('school')}</div><div class="grow"><div class="brand-name truncate">${meta.school?.name}</div><div class="brand-sub">${meta.current_year ? `Academic Year ${meta.current_year.name}` : ''}</div></div></div>
      <nav class="nav" id="nav">${groups.map(([label, items]) => html`<div class="nav-label">${label}</div>${items.map(([path, text, ic]) => html`<a href="#/${path}" data-path="${path}">${icon(ic)}<span>${text}</span></a>`)}`)}</nav>
      <div class="sidebar-foot">
        <div class="row"><div class="avatar">${initials(me.full_name)}</div><div class="grow"><div class="bold truncate">${me.full_name}</div><div class="xs muted truncate">${sub}</div></div>
        <button class="btn ghost icon" id="logout2" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div>
      </div>
    </aside>
    <div class="scrim hidden" id="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu">${icon('menu')}</button>
        <h1 id="pageTitle" class="grow truncate">Dashboard</h1>
        <div style="position:relative"><button class="icon-btn" id="bell" aria-label="Notifications">${icon('bell')}<span class="dot ${meta.unread ? '' : 'hidden'}" id="bellDot">${meta.unread > 99 ? '99+' : meta.unread}</span></button><div id="bellPanel"></div></div>
        <div style="position:relative">
          <button class="user-chip" id="userMenuBtn" aria-haspopup="true"><div class="avatar sm">${initials(me.full_name)}</div><div class="who hide-m"><div class="bold small">${me.full_name}</div><div class="xs muted">${ROLE_LABEL[me.role]}</div></div></button>
          <div class="dropdown hidden" id="userMenu">
            <div class="small muted" style="padding:8px 10px">Signed in as <b class="text-2">${me.username}</b></div>
            <a href="#/profile">${icon('user')} My profile</a>
            <a href="#/notifications">${icon('bell')} Notifications</a>
            <button class="item" id="logout">${icon('logout')} Sign out</button>
          </div>
        </div>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav">${BOTTOM[me.role].map(([p, t, ic]) => html`<a href="#/${p}" data-path="${p}">${icon(ic)}<span>${t}</span></a>`)}</nav>
  </div>`);

  const sidebar = $('#sidebar'), scrim = $('#scrim');
  const closeMenu = () => { sidebar.classList.remove('open'); scrim.classList.add('hidden'); };
  $('#menuBtn').onclick = () => { sidebar.classList.add('open'); scrim.classList.remove('hidden'); };
  scrim.onclick = closeMenu;
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  const um = $('#userMenu');
  $('#userMenuBtn').onclick = (e) => { e.stopPropagation(); um.classList.toggle('hidden'); $('#bellPanel').innerHTML = ''; };
  document.addEventListener('click', (e) => { if (!e.target.closest('#userMenu')) um.classList.add('hidden'); if (!e.target.closest('#bellPanel') && !e.target.closest('#bell')) $('#bellPanel').innerHTML = ''; });
  um.addEventListener('click', (e) => { if (e.target.closest('a')) um.classList.add('hidden'); });
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.replace('/'); };
  $('#logout').onclick = logout; $('#logout2').onclick = logout;
  $('#bell').onclick = (e) => { e.stopPropagation(); um.classList.add('hidden'); toggleBell(); };
}

async function refreshBell() {
  try { const r = await api('/api/notifications', { query: { limit: 1 } }); setBell(r.unread); } catch { /* ignore */ }
}
export function setBell(n) {
  const d = $('#bellDot'); if (!d) return;
  d.textContent = n > 99 ? '99+' : n; d.classList.toggle('hidden', !n);
}
const NI = { attendance: ['attendance', 'tone-red'], homework: ['book', 'tone-blue'], deadline: ['clock', 'tone-amber'], announcement: ['megaphone', 'tone-sky'], notice: ['alert', 'tone-red'], remark: ['message', 'tone-violet'] };
export const notifIcon = (type) => { const [ic, tone] = NI[type] || ['bell', 'tone-blue']; return html`<div class="ni ${tone}">${icon(ic)}</div>`; };
async function toggleBell() {
  const panel = $('#bellPanel');
  if (panel.innerHTML) { panel.innerHTML = ''; return; }
  mount(panel, html`<div class="dropdown notif-panel">${loading()}</div>`);
  try {
    const r = await api('/api/notifications', { query: { limit: 12 } });
    setBell(r.unread);
    mount(panel, html`<div class="dropdown notif-panel">
      <div class="row between" style="padding:12px 14px;border-bottom:1px solid var(--border)"><h3>Notifications</h3>${r.unread ? html`<button class="btn xs ghost" id="readAll">Mark all read</button>` : ''}</div>
      ${r.rows.length ? r.rows.map((n) => html`<div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">${notifIcon(n.type)}<div class="grow"><div class="bold small">${n.title}</div>${n.body ? html`<div class="xs muted">${n.body}</div>` : ''}<div class="xs muted mt-8">${timeAgo(n.created_at)}</div></div></div>`) : html`<div class="empty">${icon('bell')}<div>You're all caught up</div></div>`}
      <a href="#/notifications" class="center small bold" style="display:block;padding:12px">View all</a></div>`);
    $('#readAll', panel)?.addEventListener('click', async (e) => { e.stopPropagation(); await api('/api/notifications/read-all', { method: 'POST' }); setBell(0); panel.innerHTML = ''; });
    on(panel, 'click', '.notif-item', async (e, el) => {
      api(`/api/notifications/${el.dataset.id}/read`, { method: 'POST' }).then(refreshBell);
      panel.innerHTML = '';
      if (el.dataset.link) location.hash = el.dataset.link;
    });
    on(panel, 'click', 'a', () => { panel.innerHTML = ''; });
  } catch (err) { mount(panel, html`<div class="dropdown notif-panel"><div class="empty">${err.message}</div></div>`); }
}

let routeToken = 0;
async function route() {
  const path = currentPath();
  const r = resolve(path);
  const view = $('#view');
  $$('#nav a, #bottomNav a').forEach((a) => {
    const p = a.dataset.path;
    a.classList.toggle('active', p === '' ? path === '' : path === p || path.startsWith(p + '/') || (p === 'my-students' && path.startsWith('students/')) || (p === 'students' && path.startsWith('students/')));
  });
  if (!r) { $('#pageTitle').textContent = 'Not found'; mount(view, html`<div class="card">${html`<div class="empty">${icon('alert')}<div>Page not found. <a href="#/">Go to dashboard</a></div></div>`}</div>`); return; }
  $('#pageTitle').textContent = r.title;
  document.title = `${r.title} · ${store.meta.school?.name || 'School Portal'}`;
  const token = ++routeToken;
  mount(view, loading());
  try {
    const mod = await import(`./pages/${r.mod}.js`);
    if (token !== routeToken) return;
    view.scrollTop = 0; window.scrollTo(0, 0);
    await mod.default(view, { params: r.params, pattern: r.pattern, query: hashQuery(), setTitle: (t) => { $('#pageTitle').textContent = t; }, isCurrent: () => token === routeToken });
  } catch (err) {
    if (token === routeToken) errorState(view, err, route);
  }
}
export const rerender = () => route();

function promptPasswordChange() {
  modal({
    title: 'Set a new password',
    body: html`<div class="banner info mb-16">${icon('lock')}<span>For your security, please replace the temporary password given by the school.</span></div>
      <div class="col gap-16">${field('Current (temporary) password', html`<input class="input" type="password" name="current_password" autocomplete="current-password" required>`, { req: true })}
      ${field('New password', html`<input class="input" type="password" name="new_password" autocomplete="new-password" required minlength="8">`, { req: true, hint: 'At least 8 characters with letters and numbers' })}</div>`,
    submitLabel: 'Update password', cancelLabel: 'Later',
    onSubmit: async (form) => { await api('/api/auth/change-password', { method: 'POST', body: formValues(form) }); toast('Password updated', 'success'); store.me.must_change_password = false; },
  });
}

boot();
