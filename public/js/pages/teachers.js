import { html, mount, api, icon, $, on, loading, emptyState, modal, field, options, toast, confirmDialog, badge, initials, formValues, timeAgo } from '../lib.js';
import { store } from '../app.js';
import { resetPw } from './students.js';

export default async function render(el) {
  let q = '';
  mount(el, html`
  <div class="page-head"><div><h1>Teachers</h1><div class="sub">Manage teacher accounts, class teacher roles and subject assignments.</div></div>
    <button class="btn primary" id="add">${icon('userPlus')} Add teacher</button></div>
  <div class="card mb-16"><div class="card-body filters"><label class="field" style="flex:1"><span>Search</span><div class="search">${icon('search')}<input class="input" id="q" placeholder="Name, teacher ID, email or phone"></div></label></div></div>
  <div class="card" id="list">${loading()}</div>`);
  const listEl = $('#list', el);
  let timer;
  async function load() {
    const { rows } = await api('/api/admin/teachers', { query: { q } });
    mount(listEl, rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Teacher</th><th>Class teacher of</th><th class="hide-m">Subjects</th><th class="hide-m">User ID</th><th class="hide-m">Last login</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((t) => html`<tr><td><div class="row"><div class="avatar sm">${initials(t.full_name)}</div><div><div class="bold">${t.full_name}</div><div class="xs muted">${t.teacher_code} · ${t.phone || t.email || ''}</div></div></div></td>
        <td>${t.class_teacher_of ? html`<span class="badge b-blue">${t.class_teacher_of}</span>` : html`<span class="muted small">—</span>`}</td>
        <td class="hide-m small">${t.subjects || '—'}<div class="xs muted">${t.division_count} class(es)</div></td>
        <td class="hide-m"><code class="small">${t.username || '—'}</code></td><td class="hide-m small muted">${t.last_login_at ? timeAgo(t.last_login_at) : 'Never'}</td><td>${badge(t.status)}</td>
        <td><div class="actions"><button class="btn xs" data-assign="${t.id}">${icon('layers')} Assign</button><button class="btn xs icon" data-edit="${t.id}" aria-label="Edit">${icon('edit')}</button><button class="btn xs icon" data-reset="${t.id}" title="Reset password" aria-label="Reset password">${icon('key')}</button><button class="btn xs icon danger" data-del="${t.id}" data-name="${t.full_name}" aria-label="Delete">${icon('trash')}</button></div></td></tr>`)}
      </tbody></table></div>` : emptyState('No teachers found.', 'users'));
  }
  $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 300); };
  $('#add', el).onclick = () => teacherForm(null, load);
  on(listEl, 'click', '[data-edit]', async (e, b) => teacherForm(await api(`/api/admin/teachers/${b.dataset.edit}`), load));
  on(listEl, 'click', '[data-assign]', (e, b) => assignments(Number(b.dataset.assign), load));
  on(listEl, 'click', '[data-reset]', (e, b) => resetPw(`/api/admin/teachers/${b.dataset.reset}/reset-password`));
  on(listEl, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog(`Remove ${b.dataset.name}? Their login will be disabled and class assignments cleared.`, { okLabel: 'Remove' }))) return;
    await api(`/api/admin/teachers/${b.dataset.del}`, { method: 'DELETE' }); toast('Teacher removed', 'success'); load();
  });
  await load();
}

function teacherForm(t, done) {
  const v = t || { status: 'active' };
  modal({
    title: t ? `Edit ${t.full_name}` : 'Add teacher', size: 'lg',
    body: html`<div class="form-grid">
      ${field('Teacher ID', html`<input class="input" name="teacher_code" value="${v.teacher_code || ''}" required maxlength="20" placeholder="e.g. TCH120">`, { req: true })}
      ${field('Full name', html`<input class="input" name="full_name" value="${v.full_name || ''}" required maxlength="100">`, { req: true })}
      ${field('Email', html`<input class="input" type="email" name="email" value="${v.email || ''}">`)}
      ${field('Phone', html`<input class="input" name="phone" value="${v.phone || ''}" inputmode="tel" placeholder="+91XXXXXXXXXX">`)}
      ${field('Qualification', html`<input class="input" name="qualification" value="${v.qualification || ''}" maxlength="100">`)}
      ${field('Joining date', html`<input class="input" type="date" name="joining_date" value="${v.joining_date || ''}">`)}
      ${field('Login User ID', html`<input class="input" name="username" value="${v.username || ''}" maxlength="60" placeholder="Auto: firstname.lastname" autocapitalize="none">`, { hint: 'The teacher signs in with this ID' })}
      ${t ? field('Account status', html`<select class="input" name="status">${options([['active', 'Active'], ['inactive', 'Inactive']], v.status)}</select>`) : field('Initial password', html`<input class="input" name="password" maxlength="128" placeholder="Default: Teacher@123">`, { hint: 'Teacher will be asked to change it if left as default' })}
    </div>`,
    onSubmit: async (form) => {
      const r = await api(t ? `/api/admin/teachers/${t.id}` : '/api/admin/teachers', { method: t ? 'PUT' : 'POST', body: formValues(form) });
      toast(t ? 'Teacher updated' : 'Teacher added', 'success'); done();
      if (!t) modal({ title: 'Teacher login created', size: 'sm', body: html`<div class="banner success">${icon('key')}<div>User ID: <b>${r.username}</b><br>Password: <b>${r.temporary_password || '(as entered)'}</b></div></div><p class="xs muted mt-12">Next: click <b>Assign</b> to give this teacher a class and subjects.</p>` });
    },
  });
}

async function assignments(teacherId, done) {
  const m = modal({ title: 'Classes & subjects', size: 'lg', body: loading() });
  const draw = async () => {
    const t = await api(`/api/admin/teachers/${teacherId}`);
    $('.modal-head h2', m.el).textContent = `Assignments — ${t.full_name}`;
    $('.modal-body', m.el).innerHTML = String(html`
      <div class="banner info mb-16">${icon('users')}<span class="small">Class teacher of: <b>${t.class_teacher_of.map((c) => c.label).join(', ') || 'none'}</b>. Class teachers mark daily attendance. Change this under <a href="#/classes">Classes & Subjects</a>.</span></div>
      <div class="row wrap mb-16" id="addRow"><select class="input sm" id="aDiv" style="width:auto">${options(store.meta.divisions.map((d) => [d.id, `Class ${d.label}`]), '', { placeholder: 'Class' })}</select>
        <select class="input sm" id="aSub" style="width:auto">${options(store.meta.subjects.map((s) => [s.id, s.name]), '', { placeholder: 'Subject' })}</select><button type="button" class="btn sm primary" id="aAdd">${icon('plus')} Add</button></div>
      ${t.assignments.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Subject</th><th></th></tr></thead><tbody>${t.assignments.map((a) => html`<tr><td>${a.division_label}</td><td>${a.subject_name}</td><td class="right"><button type="button" class="btn xs danger" data-rm="${a.id}">${icon('trash')} Remove</button></td></tr>`)}</tbody></table></div>` : emptyState('No subject assignments yet.')}`);
    $('#aAdd', m.el).onclick = async () => {
      try { await api('/api/admin/assignments', { method: 'POST', body: { teacher_id: teacherId, division_id: $('#aDiv', m.el).value, subject_id: $('#aSub', m.el).value } }); toast('Assigned', 'success'); draw(); done(); }
      catch (e) { toast(e.message, 'error'); }
    };
  };
  on(m.el, 'click', '[data-rm]', async (e, b) => { await api(`/api/admin/assignments/${b.dataset.rm}`, { method: 'DELETE' }); toast('Removed', 'success'); draw(); done(); });
  await draw();
}
