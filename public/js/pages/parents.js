import { html, mount, api, icon, $, on, loading, emptyState, modal, field, options, toast, confirmDialog, initials, formValues, timeAgo } from '../lib.js';
import { resetPw } from './students.js';

export default async function render(el) {
  let q = '';
  mount(el, html`
  <div class="page-head"><div><h1>Parents</h1><div class="sub">Parent accounts and the children linked to them. One parent can have multiple children.</div></div>
    <button class="btn primary" id="add">${icon('userPlus')} Add parent</button></div>
  <div class="card mb-16"><div class="card-body filters"><label class="field" style="flex:1"><span>Search</span><div class="search">${icon('search')}<input class="input" id="q" placeholder="Name, phone, email or user ID"></div></label></div></div>
  <div class="card" id="list">${loading()}</div>`);
  const listEl = $('#list', el);
  let timer;
  async function load() {
    const { rows } = await api('/api/admin/parents', { query: { q } });
    mount(listEl, rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Parent</th><th>Children</th><th class="hide-m">User ID</th><th class="hide-m">Last login</th><th></th></tr></thead><tbody>
      ${rows.map((p) => html`<tr><td><div class="row"><div class="avatar sm">${initials(p.full_name)}</div><div><div class="bold">${p.full_name}</div><div class="xs muted">${p.phone || ''}${p.email ? ' · ' + p.email : ''}</div></div></div></td>
        <td class="small">${p.children || html`<span class="muted">No children linked</span>`}${p.child_count > 1 ? html` <span class="badge b-blue">${p.child_count}</span>` : ''}</td>
        <td class="hide-m"><code class="small">${p.username || '—'}</code>${p.account_status === 'inactive' ? html` <span class="badge b-inactive">Inactive</span>` : ''}</td><td class="hide-m small muted">${p.last_login_at ? timeAgo(p.last_login_at) : 'Never'}</td>
        <td><div class="actions"><button class="btn xs" data-kids="${p.id}">${icon('link')} Children</button><button class="btn xs icon" data-edit="${p.id}" aria-label="Edit">${icon('edit')}</button><button class="btn xs icon" data-reset="${p.id}" aria-label="Reset password" title="Reset password">${icon('key')}</button><button class="btn xs icon danger" data-del="${p.id}" data-name="${p.full_name}" aria-label="Delete">${icon('trash')}</button></div></td></tr>`)}
      </tbody></table></div>` : emptyState('No parents found.', 'user'));
  }
  $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 300); };
  $('#add', el).onclick = () => parentForm(null, load);
  on(listEl, 'click', '[data-edit]', async (e, b) => parentForm(await api(`/api/admin/parents/${b.dataset.edit}`), load));
  on(listEl, 'click', '[data-kids]', (e, b) => children(Number(b.dataset.kids), load));
  on(listEl, 'click', '[data-reset]', (e, b) => resetPw(`/api/admin/parents/${b.dataset.reset}/reset-password`));
  on(listEl, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog(`Delete parent account for ${b.dataset.name}? Children will be unlinked.`, { okLabel: 'Delete' }))) return;
    await api(`/api/admin/parents/${b.dataset.del}`, { method: 'DELETE' }); toast('Parent deleted', 'success'); load();
  });
  await load();
}

function parentForm(p, done) {
  const v = p || {};
  modal({
    title: p ? `Edit ${p.full_name}` : 'Add parent', size: 'lg',
    body: html`<div class="form-grid">
      ${field('Full name', html`<input class="input" name="full_name" value="${v.full_name || ''}" required maxlength="100">`, { req: true })}
      ${field('Mobile number', html`<input class="input" name="phone" value="${v.phone || ''}" required inputmode="tel" placeholder="+91XXXXXXXXXX">`, { req: true })}
      ${field('Email', html`<input class="input" type="email" name="email" value="${v.email || ''}">`)}
      ${field('Occupation', html`<input class="input" name="occupation" value="${v.occupation || ''}" maxlength="80">`)}
      ${field('Login User ID', html`<input class="input" name="username" value="${v.username || ''}" maxlength="60" placeholder="Default: mobile number" autocapitalize="none">`)}
      ${p ? field('Account status', html`<select class="input" name="status">${options([['active', 'Active'], ['inactive', 'Inactive']], v.account_status || 'active')}</select>`) : field('Initial password', html`<input class="input" name="password" maxlength="128" placeholder="Default: Parent@123">`)}
      ${field('Address', html`<textarea class="input" name="address" rows="2" maxlength="500">${v.address || ''}</textarea>`, { span: true })}
    </div>`,
    onSubmit: async (form) => {
      const r = await api(p ? `/api/admin/parents/${p.id}` : '/api/admin/parents', { method: p ? 'PUT' : 'POST', body: formValues(form) });
      toast(p ? 'Parent updated' : 'Parent added', 'success'); done();
      if (!p) { modal({ title: 'Parent login created', size: 'sm', body: html`<div class="banner success">${icon('key')}<div>User ID: <b>${r.username}</b><br>Password: <b>${r.temporary_password || '(as entered)'}</b></div></div><p class="xs muted mt-12">Next: link their children using the <b>Children</b> button.</p>` }); }
    },
  });
}

async function children(parentId, done) {
  const m = modal({ title: 'Linked children', size: 'lg', body: loading() });
  let results = [];
  const draw = async () => {
    const p = await api(`/api/admin/parents/${parentId}`);
    $('.modal-head h2', m.el).textContent = `Children of ${p.full_name}`;
    $('.modal-body', m.el).innerHTML = String(html`
      ${p.children.length ? html`<div class="table-wrap mb-16"><table class="table"><tbody>${p.children.map((c) => html`<tr><td><div class="bold">${c.full_name}</div><div class="xs muted">${c.admission_no}</div></td><td>Class ${c.division_label || '—'}</td><td class="small">${c.relation}</td><td class="right"><button type="button" class="btn xs danger" data-unlink="${c.id}">Unlink</button></td></tr>`)}</tbody></table></div>` : html`<div class="mb-16">${emptyState('No children linked yet.')}</div>`}
      <h3 class="mb-12">Link a child</h3>
      <div class="row wrap"><div class="search grow">${icon('search')}<input class="input" id="sq" placeholder="Search student by name or admission no"></div><select class="input" id="rel" style="width:auto">${options([['mother', 'Mother'], ['father', 'Father'], ['guardian', 'Guardian']], 'mother')}</select></div>
      <div id="sres" class="mt-12"></div>`);
    let t;
    $('#sq', m.el).oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (e.target.value.trim().length < 2) { $('#sres', m.el).innerHTML = ''; return; }
        results = (await api('/api/admin/students', { query: { q: e.target.value, limit: 8 } })).rows;
        $('#sres', m.el).innerHTML = String(html`${results.map((s) => html`<div class="attach"><div class="grow"><div class="bold small">${s.full_name}</div><div class="xs muted">${s.admission_no} · Class ${s.division_label || '—'}</div></div><button type="button" class="btn xs primary" data-link="${s.id}">${icon('link')} Link</button></div>`)}`);
      }, 250);
    };
  };
  on(m.el, 'click', '[data-link]', async (e, b) => {
    try { await api(`/api/admin/parents/${parentId}/children`, { method: 'POST', body: { student_id: Number(b.dataset.link), relation: $('#rel', m.el).value } }); toast('Child linked', 'success'); draw(); done(); }
    catch (err) { toast(err.message, 'error'); }
  });
  on(m.el, 'click', '[data-unlink]', async (e, b) => { await api(`/api/admin/parents/${parentId}/children/${b.dataset.unlink}`, { method: 'DELETE' }); toast('Unlinked', 'success'); draw(); done(); });
  await draw();
}
