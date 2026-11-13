import { html, mount, api, icon, $, $$, withBusy } from '../lib.js';

const ROLES = [
  ['teacher', 'Class Teacher', 'users', 'e.g. priya.sharma'],
  ['parent', 'Parent', 'user', 'Registered mobile or user ID'],
  ['student', 'Student', 'cap', 'Admission number'],
  ['admin', 'Admin', 'settings', 'Admin user ID'],
];
const DEMO = { teacher: ['priya.sharma', 'Teacher@123'], parent: ['sunita.patil', 'Parent@123'], student: ['ADM260163', 'Student@123'], admin: ['admin', 'Admin@123'] };

export default function render(el, { onLogin }) {
  let role = 'teacher';
  mount(el, html`
  <div class="login">
    <section class="login-side">
      <div class="row"><div class="brand-logo" style="background:rgba(255,255,255,.16)">${icon('school')}</div><div><div class="bold" style="font-size:16px">Sunrise Public School</div><div class="small" style="opacity:.8">School Portal</div></div></div>
      <div style="position:relative;z-index:1">
        <h2>Attendance, homework and school updates — all in one place.</h2>
        <div class="feat"><div class="fi">${icon('attendance')}</div><div><div class="bold">Daily attendance in under a minute</div><div class="small" style="opacity:.8">Mark the whole class present with one tap, then change the few who are absent.</div></div></div>
        <div class="feat"><div class="fi">${icon('book')}</div><div><div class="bold">Homework with attachments</div><div class="small" style="opacity:.8">Share worksheets and PDFs; parents see them instantly.</div></div></div>
        <div class="feat"><div class="fi">${icon('bell')}</div><div><div class="bold">Parents stay informed</div><div class="small" style="opacity:.8">Absence alerts, notices and teacher remarks in real time.</div></div></div>
      </div>
      <div class="small" style="opacity:.7;position:relative;z-index:1">Secure, role-based access for administrators, teachers, parents and students.</div>
    </section>
    <section class="login-form">
      <div class="login-card">
        <h1 style="font-size:24px">Welcome back</h1>
        <p class="muted mt-8">Sign in with the User ID and password provided by the school.</p>
        <div class="role-tabs" role="tablist">${ROLES.map(([k, l, ic]) => html`<button type="button" role="tab" data-role="${k}" class="${k === role ? 'on' : ''}">${icon(ic)}${l}</button>`)}</div>
        <form id="loginForm" novalidate class="col gap-16">
          <div id="err"></div>
          <label class="field"><span>User ID</span><input class="input" name="username" id="username" autocomplete="username" required maxlength="80" placeholder="e.g. priya.sharma" autocapitalize="none" spellcheck="false"></label>
          <label class="field"><span>Password</span><div class="pw-wrap"><input class="input" type="password" name="password" id="password" autocomplete="current-password" required maxlength="128" placeholder="Enter your password"><button type="button" id="togglePw" aria-label="Show password">${icon('eye')}</button></div></label>
          <button class="btn primary block" type="submit" style="height:44px">${icon('lock')} Sign in</button>
        </form>
        <div class="demo-box">
          <div class="bold mb-12" style="margin-bottom:6px">Demo access</div>
          <div id="demoText"></div>
          <button type="button" class="btn sm mt-8" id="fillDemo">Use demo credentials</button>
        </div>
        <p class="xs muted mt-16 center">Forgot your password? Contact the school office to reset it.</p>
      </div>
    </section>
  </div>`);

  const demoText = () => { const [u, p] = DEMO[role]; $('#demoText', el).innerHTML = String(html`${ROLES.find((r) => r[0] === role)[1]}: <b>${u}</b> / <b>${p}</b>`); $('#username', el).placeholder = ROLES.find((r) => r[0] === role)[3]; };
  demoText();
  $$('.role-tabs button', el).forEach((b) => b.addEventListener('click', () => {
    role = b.dataset.role;
    $$('.role-tabs button', el).forEach((x) => x.classList.toggle('on', x === b));
    demoText();
    $('#username', el).focus();
  }));
  $('#fillDemo', el).onclick = () => { const [u, p] = DEMO[role]; $('#username', el).value = u; $('#password', el).value = p; };
  $('#togglePw', el).onclick = () => {
    const pw = $('#password', el); const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('#togglePw', el).innerHTML = String(icon(show ? 'eyeoff' : 'eye'));
  };
  $('#username', el).focus();
  $('#loginForm', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username', el).value.trim();
    const password = $('#password', el).value;
    const err = $('#err', el);
    err.innerHTML = '';
    if (!username || !password) { err.innerHTML = String(html`<div class="banner danger">${icon('alert')}<span>Please enter your User ID and password.</span></div>`); return; }
    await withBusy(e.submitter || $('button[type=submit]', el), async () => {
      try {
        await api('/api/auth/login', { method: 'POST', body: { username, password } });
        location.hash = '#/';
        onLogin();
      } catch (ex) {
        err.innerHTML = String(html`<div class="banner danger">${icon('alert')}<span>${ex.message}</span></div>`);
        $('#password', el).value = '';
        $('#password', el).focus();
      }
    });
  });
}
