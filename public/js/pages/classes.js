import { html, mount, api, icon, $, on, loading, emptyState, modal, field, options, toast, confirmDialog, formValues } from '../lib.js';
import { store } from '../app.js';

export default async function render(el) {
  mount(el, html`
  <div class="page-head"><div><h1>Classes & Subjects</h1><div class="sub">Create classes and divisions for ${store.meta.current_year?.name || 'the current year'}, and assign class teachers.</div></div>
    <div class="row"><button class="btn" id="addSub">${icon('plus')} Add subject</button><button class="btn primary" id="addClass">${icon('plus')} Add class</button></div></div>
  <div class="grid g-main"><div class="card" id="classes">${loading()}</div><div class="card" id="subjects">${loading()}</div></div>`);
  let teachers = [];
  const refreshMeta = async () => { store.meta = await api('/api/meta'); };

  async function loadClasses() {
    const [{ rows }, t] = await Promise.all([api('/api/admin/classes'), api('/api/admin/teachers', { query: { status: 'active' } })]);
    teachers = t.rows;
    mount($('#classes', el), html`<div class="card-head"><h2>Classes & divisions</h2><span class="small muted">${rows.length} classes</span></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Division</th><th>Class teacher</th><th>Students</th><th class="hide-m">Room</th><th></th></tr></thead><tbody>
      ${rows.map((c) => html`${c.divisions.map((d, i) => html`<tr>
          ${i === 0 ? html`<td rowspan="${c.divisions.length}" style="vertical-align:top"><div class="bold">Class ${c.name}</div><div class="row gap-4 mt-8"><button class="btn xs" data-adddiv="${c.id}" data-name="${c.name}">${icon('plus')} Division</button><button class="btn xs icon" data-editclass="${c.id}" data-name="${c.name}" data-sort="${c.sort_order}" aria-label="Edit class">${icon('edit')}</button><button class="btn xs icon danger" data-delclass="${c.id}" data-name="${c.name}" aria-label="Delete class">${icon('trash')}</button></div></td>` : ''}
          <td class="bold">${c.name}-${d.name}</td>
          <td><select class="input sm" data-ct="${d.id}" style="min-width:170px">${options(teachers.map((t) => [t.id, t.full_name]), d.class_teacher_id, { placeholder: '— Not assigned —' })}</select></td>
          <td>${d.student_count}</td><td class="hide-m small">${d.room || '—'}</td>
          <td><div class="actions"><button class="btn xs icon" data-editdiv="${d.id}" data-name="${d.name}" data-room="${d.room || ''}" data-capacity="${d.capacity || ''}" aria-label="Edit division">${icon('edit')}</button><button class="btn xs icon danger" data-deldiv="${d.id}" data-name="${c.name}-${d.name}" aria-label="Delete division">${icon('trash')}</button></div></td></tr>`)}
          ${!c.divisions.length ? html`<tr><td class="bold">Class ${c.name}</td><td colspan="5"><button class="btn xs" data-adddiv="${c.id}" data-name="${c.name}">${icon('plus')} Add division</button> <button class="btn xs danger" data-delclass="${c.id}" data-name="${c.name}">Delete class</button></td></tr>` : ''}`)}
      </tbody></table></div>` : emptyState('No classes yet. Click "Add class" to create one.', 'layers')}`);
  }
  async function loadSubjects() {
    const { rows } = await api('/api/admin/subjects');
    mount($('#subjects', el), html`<div class="card-head"><h2>Subjects</h2><span class="small muted">${rows.length}</span></div>
      ${rows.map((s) => html`<div class="list-item"><span class="badge b-blue">${s.code}</span><div class="grow"><div class="bold small">${s.name}</div><div class="xs muted">${s.assignments} teacher assignment(s)</div></div>
        <button class="btn xs icon" data-editsub="${s.id}" data-name="${s.name}" data-code="${s.code}" aria-label="Edit">${icon('edit')}</button><button class="btn xs icon danger" data-delsub="${s.id}" data-name="${s.name}" aria-label="Delete">${icon('trash')}</button></div>`)}
      ${!rows.length ? emptyState('No subjects') : ''}`);
  }
  const reload = async () => { await Promise.all([loadClasses(), loadSubjects()]); refreshMeta(); };

  $('#addClass', el).onclick = () => modal({
    title: 'Add class', size: 'sm',
    body: html`<div class="col gap-16">${field('Class name', html`<input class="input" name="name" required maxlength="40" placeholder="e.g. 4 or Nursery">`, { req: true })}
      ${field('Divisions', html`<input class="input" name="divisions" value="A, B" maxlength="100">`, { hint: 'Comma separated, e.g. A, B, C' })}
      ${field('Display order', html`<input class="input" type="number" name="sort_order" min="0" max="999" value="0">`)}</div>`,
    onSubmit: async (form) => { await api('/api/admin/classes', { method: 'POST', body: formValues(form) }); toast('Class created', 'success'); reload(); },
  });
  $('#addSub', el).onclick = () => subjectForm();
  const subjectForm = (s) => modal({
    title: s ? 'Edit subject' : 'Add subject', size: 'sm',
    body: html`<div class="col gap-16">${field('Subject name', html`<input class="input" name="name" required maxlength="60" value="${s?.name || ''}">`, { req: true })}${field('Code', html`<input class="input" name="code" required maxlength="12" value="${s?.code || ''}" placeholder="e.g. EVS">`, { req: true })}</div>`,
    onSubmit: async (form) => { await api(s ? `/api/admin/subjects/${s.id}` : '/api/admin/subjects', { method: s ? 'PUT' : 'POST', body: formValues(form) }); toast('Subject saved', 'success'); reload(); },
  });
  on(el, 'change', '[data-ct]', async (e, sel) => {
    try { await api(`/api/admin/divisions/${sel.dataset.ct}`, { method: 'PUT', body: { class_teacher_id: sel.value || null } }); toast('Class teacher updated', 'success'); refreshMeta(); }
    catch (err) { toast(err.message, 'error'); }
  });
  on(el, 'click', '[data-adddiv]', (e, b) => modal({
    title: `Add division to Class ${b.dataset.name}`, size: 'sm',
    body: html`<div class="col gap-16">${field('Division', html`<input class="input" name="name" required maxlength="10" placeholder="e.g. C">`, { req: true })}
      ${field('Class teacher', html`<select class="input" name="class_teacher_id">${options(teachers.map((t) => [t.id, t.full_name]), '', { placeholder: '— None —' })}</select>`)}
      ${field('Room', html`<input class="input" name="room" maxlength="30">`)}</div>`,
    onSubmit: async (form) => { await api('/api/admin/divisions', { method: 'POST', body: { ...formValues(form), class_id: b.dataset.adddiv } }); toast('Division added', 'success'); reload(); },
  }));
  on(el, 'click', '[data-editdiv]', (e, b) => modal({
    title: 'Edit division', size: 'sm',
    body: html`<div class="col gap-16">${field('Division', html`<input class="input" name="name" required maxlength="10" value="${b.dataset.name}">`, { req: true })}${field('Room', html`<input class="input" name="room" maxlength="30" value="${b.dataset.room}">`)}${field('Capacity', html`<input class="input" type="number" name="capacity" min="1" max="200" value="${b.dataset.capacity}">`)}</div>`,
    onSubmit: async (form) => { await api(`/api/admin/divisions/${b.dataset.editdiv}`, { method: 'PUT', body: formValues(form) }); toast('Division updated', 'success'); reload(); },
  }));
  on(el, 'click', '[data-editclass]', (e, b) => modal({
    title: 'Edit class', size: 'sm',
    body: html`<div class="col gap-16">${field('Class name', html`<input class="input" name="name" required value="${b.dataset.name}">`, { req: true })}${field('Display order', html`<input class="input" type="number" name="sort_order" value="${b.dataset.sort}">`)}</div>`,
    onSubmit: async (form) => { await api(`/api/admin/classes/${b.dataset.editclass}`, { method: 'PUT', body: formValues(form) }); toast('Class updated', 'success'); reload(); },
  }));
  const del = (url, msg) => async () => { if (!(await confirmDialog(msg, { okLabel: 'Delete' }))) return; try { await api(url, { method: 'DELETE' }); toast('Deleted', 'success'); reload(); } catch (err) { toast(err.message, 'error'); } };
  on(el, 'click', '[data-delclass]', (e, b) => del(`/api/admin/classes/${b.dataset.delclass}`, `Delete Class ${b.dataset.name} and all its divisions?`)());
  on(el, 'click', '[data-deldiv]', (e, b) => del(`/api/admin/divisions/${b.dataset.deldiv}`, `Delete division ${b.dataset.name}?`)());
  on(el, 'click', '[data-delsub]', (e, b) => del(`/api/admin/subjects/${b.dataset.delsub}`, `Delete subject ${b.dataset.name}? Teacher assignments for it will be removed.`)());
  on(el, 'click', '[data-editsub]', (e, b) => subjectForm({ id: b.dataset.editsub, name: b.dataset.name, code: b.dataset.code }));
  await reload();
}
