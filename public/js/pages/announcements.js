import { html, mount, api, icon, on, emptyState, modal, field, options, toast, confirmDialog, formValues, timeAgo, fmtDateTime } from '../lib.js';
import { store } from '../app.js';
import { divisionOptions } from './_ui.js';

export default async function render(el, { query }) {
  const { me } = store;
  const canPost = me.role === 'admin' || me.role === 'teacher';
  const { rows } = await api('/api/announcements', { query: { limit: 100 } });
  const AUD = { all: 'Everyone', teachers: 'Staff only', parents: 'Parents', students: 'Students' };
  mount(el, html`
  <div class="page-head"><div><h1>${canPost ? 'Announcements' : 'School notices'}</h1><div class="sub">${canPost ? 'Publish notices to the whole school or a single class. Recipients get an in-app notification.' : 'Latest notices from the school and your class teacher.'}</div></div>
    ${canPost ? html`<button class="btn primary" id="new">${icon('megaphone')} New announcement</button>` : ''}</div>
  <div class="card">${rows.length ? rows.map((a) => html`<div class="list-item" style="align-items:flex-start;padding:16px 18px">
    <div class="ni ${a.is_important ? 'tone-red' : 'tone-sky'}" style="width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex:none">${icon(a.is_important ? 'alert' : 'megaphone')}</div>
    <div class="grow"><div class="row wrap gap-4"><h3>${a.title}</h3>${a.is_important ? html`<span class="badge b-red">Important</span>` : ''}${a.division_label ? html`<span class="chip">Class ${a.division_label}</span>` : ''}${canPost ? html`<span class="badge b-gray">${AUD[a.audience]}</span>` : ''}</div>
      <div class="prose mt-8">${a.body}</div><div class="xs muted mt-8" title="${fmtDateTime(a.published_at)}">${a.author || 'School'} · ${timeAgo(a.published_at)}</div></div>
    ${canPost && (me.role === 'admin' || a.published_by === me.id) ? html`<div class="row gap-4"><button class="btn xs icon" data-edit="${a.id}" aria-label="Edit">${icon('edit')}</button><button class="btn xs icon danger" data-del="${a.id}" aria-label="Delete">${icon('trash')}</button></div>` : ''}</div>`) : emptyState('No announcements yet.', 'megaphone')}</div>`);

  const form = (a) => modal({
    title: a ? 'Edit announcement' : 'New announcement', size: 'lg',
    body: html`<div class="form-grid">
      ${field('Title', html`<input class="input" name="title" required maxlength="150" value="${a?.title || ''}">`, { req: true, span: true })}
      ${field('Message', html`<textarea class="input" name="body" rows="6" required maxlength="4000">${a?.body || ''}</textarea>`, { req: true, span: true })}
      ${field('Audience', html`<select class="input" name="audience">${options(me.role === 'admin' ? [['all', 'Everyone'], ['parents', 'Parents'], ['students', 'Students'], ['teachers', 'Staff only']] : [['all', 'Parents & students'], ['parents', 'Parents'], ['students', 'Students']], a?.audience || 'all')}</select>`)}
      ${field('Class', html`<select class="input" name="division_id" ${me.role === 'teacher' ? 'required' : ''}>${divisionOptions(a?.division_id, { placeholder: me.role === 'admin' ? 'Whole school' : 'Select class' })}</select>`, { req: me.role === 'teacher' })}
      <label class="check span-2"><input type="checkbox" name="is_important" ${a?.is_important ? 'checked' : ''}> Mark as important notice</label></div>`,
    submitLabel: a ? 'Save' : 'Publish',
    onSubmit: async (f) => {
      const body = formValues(f);
      await api(a ? `/api/announcements/${a.id}` : '/api/announcements', { method: a ? 'PUT' : 'POST', body });
      toast(a ? 'Announcement updated' : 'Announcement published', 'success'); render(el, { query: {} });
    },
  });
  if (canPost) {
    el.querySelector('#new').onclick = () => form();
    if (query.new) form();
  }
  on(el, 'click', '[data-edit]', (e, b) => form(rows.find((r) => r.id === Number(b.dataset.edit))));
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this announcement?', { okLabel: 'Delete' }))) return;
    await api(`/api/announcements/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted', 'success'); render(el, { query: {} });
  });
}
