import { html, mount, api, icon, $, on, loading, emptyState, modal, field, options, toast, confirmDialog, badge, initials, formValues, download, esc } from '../lib.js';
import { store, navigate, setQuery } from '../app.js';
import { divisionOptions } from './_ui.js';

export default async function render(el, { query }) {
  const f = { q: query.q || '', division_id: query.division_id || '', status: query.status || 'active', page: Number(query.page) || 1 };
  mount(el, html`
  <div class="page-head"><div><h1>Students</h1><div class="sub">Add, edit and manage student records and logins.</div></div>
    <div class="row wrap"><button class="btn" id="import">${icon('upload')} Bulk import</button><button class="btn primary" id="add">${icon('userPlus')} Add student</button></div></div>
  <div class="card mb-16"><div class="card-body filters" id="filters">
    <label class="field" style="flex:2 1 240px"><span>Search</span><div class="search">${icon('search')}<input class="input" name="q" value="${f.q}" placeholder="Name, admission no, parent name or phone"></div></label>
    <label class="field"><span>Class</span><select class="input" name="division_id">${divisionOptions(f.division_id, { placeholder: 'All classes' })}</select></label>
    <label class="field"><span>Status</span><select class="input" name="status">${options([['active', 'Active'], ['inactive', 'Inactive'], ['transferred', 'Transferred'], ['alumni', 'Alumni']], f.status, { placeholder: 'All' })}</select></label>
  </div></div>
  <div class="card" id="list">${loading()}</div>`);
  const listEl = $('#list', el);
  let timer;
  async function load() {
    setQuery(f);
    mount(listEl, loading());
    const r = await api('/api/admin/students', { query: { ...f, limit: 25 } });
    const pages = Math.max(1, Math.ceil(r.total / r.limit));
    mount(listEl, r.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Class</th><th class="hide-m">Roll</th><th class="hide-m">Parent</th><th class="hide-m">Login</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.rows.map((s) => html`<tr><td><a class="row" href="#/students/${s.id}" style="color:inherit;text-decoration:none"><div class="avatar sm">${initials(s.full_name)}</div><div><div class="bold">${s.full_name}</div><div class="xs muted">${s.admission_no}</div></div></a></td>
        <td class="nowrap">${s.division_label || html`<span class="muted">—</span>`}</td><td class="hide-m">${s.roll_no ?? '—'}</td>
        <td class="hide-m small">${s.parent_name || '—'}<div class="xs muted">${s.parent_phone || ''}</div></td>
        <td class="hide-m small">${s.username ? html`<code>${s.username}</code>` : html`<span class="muted">None</span>`}</td><td>${badge(s.status)}</td>
        <td><div class="actions"><button class="btn xs icon" data-edit="${s.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>${s.username ? html`<button class="btn xs icon" data-reset="${s.id}" title="Reset password" aria-label="Reset password">${icon('key')}</button>` : ''}<button class="btn xs icon danger" data-del="${s.id}" data-name="${s.full_name}" title="Delete" aria-label="Delete">${icon('trash')}</button></div></td></tr>`)}
      </tbody></table></div>
      <div class="pager"><span class="small muted">${r.total} student(s)</span><div class="row"><button class="btn sm" data-page="${f.page - 1}" ${f.page <= 1 ? 'disabled' : ''}>${icon('left')}</button><span class="small">Page ${f.page} of ${pages}</span><button class="btn sm" data-page="${f.page + 1}" ${f.page >= pages ? 'disabled' : ''}>${icon('right')}</button></div></div>`
      : emptyState('No students found.', 'cap'));
  }
  $('#filters', el).addEventListener('input', (e) => { if (!e.target.name) return; f[e.target.name] = e.target.value; f.page = 1; clearTimeout(timer); timer = setTimeout(load, e.target.name === 'q' ? 300 : 0); });
  on(listEl, 'click', '[data-page]', (e, b) => { f.page = Number(b.dataset.page); load(); });
  on(listEl, 'click', '[data-edit]', async (e, b) => studentForm(await api(`/api/admin/students/${b.dataset.edit}`), load));
  on(listEl, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog(`Delete ${b.dataset.name}? The record is archived (soft delete) and their login is disabled.`, { okLabel: 'Delete' }))) return;
    await api(`/api/admin/students/${b.dataset.del}`, { method: 'DELETE' }); toast('Student deleted', 'success'); load();
  });
  on(listEl, 'click', '[data-reset]', (e, b) => resetPw(`/api/admin/students/${b.dataset.reset}/reset-password`));
  $('#add', el).onclick = () => studentForm(null, load);
  $('#import', el).onclick = () => importDialog(load);
  if (query.new) studentForm(null, load);
  await load();
}

export function resetPw(url) {
  modal({
    title: 'Reset password', size: 'sm',
    body: html`<p class="small text-2 mb-12">Leave blank to generate a temporary password. The user will be asked to change it at next login.</p>${field('New password (optional)', html`<input class="input" name="password" type="text" maxlength="128" placeholder="Auto-generate">`)}`,
    submitLabel: 'Reset password',
    onSubmit: async (form) => {
      const r = await api(url, { method: 'POST', body: { password: form.password.value || undefined } });
      modal({ title: 'New credentials', size: 'sm', body: html`<div class="banner success">${icon('key')}<div>User ID: <b>${r.username}</b><br>Password: <b>${r.password}</b></div></div><p class="xs muted mt-12">Share these securely with the user.</p>` });
    },
  });
}

function credentialsNote(r) {
  const parts = [];
  if (r.student_login) parts.push(html`<div>Student login — User ID: <b>${r.student_login.username}</b> · Password: <b>${r.student_login.password}</b></div>`);
  if (r.parent_login) parts.push(html`<div>Parent login — User ID: <b>${r.parent_login.username}</b> · Password: <b>${r.parent_login.password}</b></div>`);
  if (parts.length) modal({ title: 'Login accounts created', body: html`<div class="banner success col" style="align-items:flex-start">${parts}</div><p class="xs muted mt-12">Users will be asked to change their password at first login.</p>` });
}

function studentForm(s, done) {
  const v = s || { status: 'active', create_login: true, create_parent_login: true };
  modal({
    title: s ? `Edit ${s.full_name}` : 'Add student', size: 'lg',
    body: html`<div class="form-grid">
      ${field('Admission number', html`<input class="input" name="admission_no" value="${v.admission_no || ''}" required maxlength="30">`, { req: true })}
      ${field('Full name', html`<input class="input" name="full_name" value="${v.full_name || ''}" required maxlength="100">`, { req: true })}
      ${field('Class & division', html`<select class="input" name="division_id">${divisionOptions(v.division_id, { placeholder: 'Not assigned' })}</select>`)}
      ${field('Roll number', html`<input class="input" name="roll_no" type="number" min="1" max="999" value="${v.roll_no ?? ''}">`)}
      ${field('Date of birth', html`<input class="input" name="dob" type="date" value="${v.dob || ''}">`)}
      ${field('Gender', html`<select class="input" name="gender">${options([['M', 'Male'], ['F', 'Female'], ['O', 'Other']], v.gender, { placeholder: 'Select' })}</select>`)}
      ${field('Parent name', html`<input class="input" name="parent_name" value="${v.parent_name || ''}" maxlength="100">`)}
      ${field('Parent phone', html`<input class="input" name="parent_phone" value="${v.parent_phone || ''}" inputmode="tel" placeholder="+91XXXXXXXXXX">`)}
      ${field('Parent email', html`<input class="input" name="parent_email" type="email" value="${v.parent_email || ''}">`)}
      ${field('Admission date', html`<input class="input" name="admission_date" type="date" value="${v.admission_date || ''}">`)}
      ${field('Blood group', html`<input class="input" name="blood_group" value="${v.blood_group || ''}" maxlength="5">`)}
      ${field('Status', html`<select class="input" name="status">${options([['active', 'Active'], ['inactive', 'Inactive'], ['transferred', 'Transferred'], ['alumni', 'Alumni']], v.status)}</select>`)}
      ${field('Address', html`<textarea class="input" name="address" rows="2" maxlength="500">${v.address || ''}</textarea>`, { span: true })}
      <div class="span-2 col gap-4">
        ${s?.username ? html`<span class="small muted">Student login: <b>${s.username}</b></span>` : html`<label class="check"><input type="checkbox" name="create_login" ${v.create_login ? 'checked' : ''}> Create student login (User ID = admission number)</label>`}
        <label class="check"><input type="checkbox" name="create_parent_login" ${!s ? 'checked' : ''}> ${s ? 'Link / create parent account from parent phone' : 'Create or link parent login using parent phone'}</label>
      </div></div>`,
    onSubmit: async (form) => {
      const body = formValues(form);
      const r = await api(s ? `/api/admin/students/${s.id}` : '/api/admin/students', { method: s ? 'PUT' : 'POST', body });
      toast(s ? 'Student updated' : 'Student added', 'success');
      done(); credentialsNote(r);
    },
  });
}

function importDialog(done) {
  const m = modal({
    title: 'Bulk import students', size: 'lg', submitLabel: 'Import',
    body: html`<div class="col gap-16">
      <div class="banner info">${icon('file')}<div class="small">Upload a <b>CSV</b> or <b>Excel (.xlsx)</b> file with a header row. Required columns: <code>admission_no, full_name</code>. Optional: <code>class, division, roll_no, gender, dob, parent_name, parent_phone, parent_email, address, admission_date</code>. Student and parent logins are created automatically.</div></div>
      <div class="row wrap"><button type="button" class="btn sm" id="tpl">${icon('download')} Download template</button></div>
      <input type="file" class="input" name="file" accept=".csv,.xlsx" style="padding:7px" required>
      <label class="check"><input type="checkbox" name="dry_run" checked> Preview first (validate without saving)</label>
      <div id="result"></div></div>`,
    onSubmit: async (form) => {
      const file = form.file.files[0];
      if (!file) { const e = new Error('Choose a file to import'); e.details = { file: 'Choose a file' }; throw e; }
      const fd = new FormData(); fd.append('file', file); fd.append('dry_run', form.dry_run.checked ? '1' : '0');
      const r = await api('/api/admin/students-import', { method: 'POST', form: fd });
      const fails = r.results.filter((x) => !x.ok);
      $('#result', m.el).innerHTML = String(html`<div class="banner ${fails.length ? 'warn' : 'success'}">${icon(fails.length ? 'alert' : 'checkCircle')}<span>${r.dry_run ? `Preview: ${r.total - r.failed} of ${r.total} rows are valid.` : `Imported ${r.created} of ${r.total} rows.`} ${fails.length ? `${fails.length} row(s) have errors.` : ''}${r.dry_run && !fails.length ? ' Untick "Preview first" and click Import to save.' : ''}</span></div>
        ${fails.length ? html`<div class="table-wrap mt-12" style="max-height:220px;overflow:auto"><table class="table"><thead><tr><th>Row</th><th>Admission no</th><th>Error</th></tr></thead><tbody>${fails.map((x) => html`<tr><td>${x.line}</td><td>${x.admission_no}</td><td class="small" style="color:var(--red)">${x.error}</td></tr>`)}</tbody></table></div>` : ''}`);
      if (!r.dry_run && r.created) { toast(`${r.created} students imported`, 'success'); done(); }
      if (r.dry_run && !fails.length) form.dry_run.checked = false;
      return false; // keep dialog open to show results
    },
  });
  $('#tpl', m.el).onclick = () => download('/api/admin/students-import/template');
}
export { esc };
