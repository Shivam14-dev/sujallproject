import { html, mount, api, icon, $, $$, on, toast, fmtDate, addDays, loading, emptyState, modal, field, confirmDialog, withBusy, fileSize, badge, subjectTone, fmtDateTime, showErrors, clearErrors, options } from '../lib.js';
import { store, navigate, setQuery } from '../app.js';
import { divisionOptions, subjectOptions } from './_ui.js';
import { progress, pctColor } from '../charts.js';

export default async function render(el, ctx) {
  if (ctx.pattern === 'homework/new') return form(el, null, ctx);
  if (ctx.pattern === 'homework/:id/edit') return form(el, Number(ctx.params.id), ctx);
  if (ctx.pattern === 'homework/:id') return detail(el, Number(ctx.params.id), ctx);
  return list(el, ctx);
}

// ---------- list ----------
async function list(el, { query }) {
  const { meta, me } = store;
  const f = { division_id: query.division_id || '', subject_id: query.subject_id || '', from: query.from || addDays(meta.today, -14), to: query.to || '', q: query.q || '', mine: query.mine ?? (me.role === 'teacher' ? '1' : '') };
  mount(el, html`
  <div class="page-head"><div><h1>Homework</h1><div class="sub">Daily homework given to classes, with submission tracking.</div></div>
    <a class="btn primary" href="#/homework/new">${icon('plus')} Give homework</a></div>
  <div class="card mb-16"><div class="card-body filters" id="filters">
    <label class="field"><span>Class</span><select class="input" name="division_id">${divisionOptions(f.division_id, { placeholder: 'All classes' })}</select></label>
    <label class="field"><span>Subject</span><select class="input" name="subject_id">${options(meta.subjects.map((s) => [s.id, s.name]), f.subject_id, { placeholder: 'All subjects' })}</select></label>
    <label class="field"><span>From</span><input type="date" class="input" name="from" value="${f.from}"></label>
    <label class="field"><span>To</span><input type="date" class="input" name="to" value="${f.to}"></label>
    <label class="field" style="flex:1 1 200px"><span>Search</span><div class="search">${icon('search')}<input class="input" name="q" placeholder="Title or instructions" value="${f.q}"></div></label>
    ${me.role === 'teacher' ? html`<label class="check" style="align-self:center;margin-top:20px"><input type="checkbox" name="mine" ${f.mine === '1' ? 'checked' : ''}> Only mine</label>` : ''}
  </div></div>
  <div class="card" id="list">${loading()}</div>`);
  const listEl = $('#list', el);
  let timer;
  async function load() {
    setQuery(f);
    mount(listEl, loading());
    try {
      const { rows } = await api('/api/homework', { query: f });
      if (!rows.length) { mount(listEl, emptyState('No homework found for these filters.', 'book')); return; }
      mount(listEl, html`<div class="table-wrap"><table class="table"><thead><tr><th>Homework</th><th>Class</th><th class="hide-m">Given</th><th>Due</th><th style="min-width:150px" class="hide-m">Submissions</th><th></th></tr></thead><tbody>
        ${rows.map((h) => { const p = h.assigned ? Math.round((h.submitted / h.assigned) * 100) : 0; return html`<tr class="link" data-id="${h.id}" style="cursor:pointer">
          <td><div class="row"><div class="subj-ic ${subjectTone(h.subject_name)}">${h.subject_code.slice(0, 4)}</div><div class="grow" style="min-width:0"><div class="bold truncate" style="max-width:340px">${h.title}</div>
            <div class="xs muted">${h.subject_name}${h.teacher_name ? ' · ' + h.teacher_name : ''}${h.attachment_count ? html` · ${icon('clip')} ${h.attachment_count}` : ''}${h.assign_to === 'selected' ? ' · Selected students' : ''}</div></div></div></td>
          <td class="nowrap">${h.division_label}</td><td class="hide-m nowrap small">${fmtDate(h.homework_date, { year: false })}</td>
          <td class="nowrap small">${fmtDate(h.due_date, { year: false })} ${h.due_date < meta.today ? html`<span class="badge b-gray">Closed</span>` : h.due_date === meta.today ? html`<span class="badge b-amber">Today</span>` : ''}</td>
          <td class="hide-m"><div class="row between xs muted"><span>${h.submitted}/${h.assigned}</span><span>${h.reviewed} reviewed</span></div>${progress(p, pctColor(p))}</td>
          <td class="right">${icon('right', 'muted')}</td></tr>`; })}
      </tbody></table></div>`);
    } catch (e) { mount(listEl, html`<div class="card-body"><div class="banner danger">${icon('alert')}<span>${e.message}</span></div></div>`); }
  }
  const filters = $('#filters', el);
  filters.addEventListener('input', (e) => {
    const t = e.target; if (!t.name) return;
    f[t.name] = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
    clearTimeout(timer); timer = setTimeout(load, t.name === 'q' ? 350 : 0);
  });
  on(listEl, 'click', 'tr[data-id]', (e, tr) => navigate(`homework/${tr.dataset.id}`));
  await load();
}

// ---------- create / edit ----------
async function form(el, id, { query }) {
  const { meta, me } = store;
  const hw = id ? await api(`/api/homework/${id}`) : null;
  if (hw && !hw.can_edit) { mount(el, html`<div class="banner danger">${icon('lock')}<span>You can only edit homework you created.</span></div>`); return; }
  const v = hw || { division_id: Number(query.division_id) || meta.divisions[0]?.id, subject_id: '', homework_date: meta.today, due_date: addDays(meta.today, 1), allow_submission: 1, assign_to: 'class', title: '', instructions: '' };
  let newFiles = [];
  const removeIds = new Set();
  let selected = new Set(hw?.selected_students || []);

  mount(el, html`
  <div class="page-head"><div><a href="${id ? `#/homework/${id}` : '#/homework'}" class="small bold">${icon('left')} Back</a><h1 class="mt-8">${id ? 'Edit homework' : 'Give homework'}</h1></div></div>
  <form class="grid g-main" id="hwForm" novalidate>
    <div class="card"><div class="card-body form-grid">
      ${field('Class & division', html`<select class="input" name="division_id" required>${divisionOptions(v.division_id, { placeholder: 'Select class' })}</select>`, { req: true })}
      ${field('Subject', html`<select class="input" name="subject_id" required>${subjectOptions(v.subject_id, v.division_id)}</select>`, { req: true })}
      ${field('Homework date', html`<input type="date" class="input" name="homework_date" value="${v.homework_date}" required>`, { req: true })}
      ${field('Submission deadline', html`<input type="date" class="input" name="due_date" value="${v.due_date}" required>`, { req: true })}
      ${field('Title', html`<input class="input" name="title" value="${v.title}" maxlength="150" required placeholder="e.g. Exercise 4.2 — Q1 to Q10">`, { req: true, span: true })}
      ${field('Instructions', html`<textarea class="input" name="instructions" rows="6" maxlength="5000" placeholder="Explain what students need to do, pages, format, materials…">${v.instructions || ''}</textarea>`, { span: true })}
      <div class="span-2"><div class="field" style="margin-bottom:6px"><span class="bold small text-2">Attachments</span></div>
        <div class="dropzone" id="drop" tabindex="0">${icon('upload')}<div class="mt-8"><b>Click to upload</b> or drag & drop</div><div class="xs">PDF, images, Word, Excel, PowerPoint · up to 10 MB each · max 10 files</div></div>
        <input type="file" id="files" multiple class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt">
        <div id="fileList" class="mt-12"></div>
      </div>
    </div></div>
    <div class="col gap-16">
      <div class="card"><div class="card-head"><h2>Assign to</h2></div><div class="card-body col gap-16">
        <label class="check"><input type="radio" name="assign_to" value="class" ${v.assign_to === 'class' ? 'checked' : ''}> Entire class</label>
        <label class="check"><input type="radio" name="assign_to" value="selected" ${v.assign_to === 'selected' ? 'checked' : ''}> Selected students</label>
        <div id="studentPick" class="${v.assign_to === 'selected' ? '' : 'hidden'}"></div>
        <hr style="border:0;border-top:1px solid var(--border);margin:0">
        <label class="check"><input type="checkbox" name="allow_submission" ${v.allow_submission ? 'checked' : ''}> Allow online submission (file upload)</label>
        <span class="xs muted">Students can always mark homework as completed. With this on, they can also upload their work.</span>
      </div></div>
      <div class="card card-pad col gap-16"><div id="formErr"></div>
        <button class="btn primary block" type="submit">${icon(id ? 'check' : 'send')} ${id ? 'Save changes' : 'Publish homework'}</button>
        <span class="xs muted center">${id ? 'Students and parents will see the updated homework.' : 'Students and parents are notified immediately (or on the homework date).'}</span></div>
    </div>
  </form>`);

  const formEl = $('#hwForm', el);
  const drawFiles = () => {
    mount($('#fileList', el), html`${(hw?.attachments || []).filter((a) => !removeIds.has(a.id)).map((a) => html`<div class="attach">${icon('file', 'muted')}<div class="grow truncate small">${a.original_name}</div><span class="xs muted">${fileSize(a.size_bytes)}</span><button type="button" class="btn xs ghost" data-rm-old="${a.id}" aria-label="Remove">${icon('x')}</button></div>`)}
      ${newFiles.map((f, i) => html`<div class="attach">${icon('upload', 'muted')}<div class="grow truncate small">${f.name}</div><span class="xs muted">${fileSize(f.size)}</span><button type="button" class="btn xs ghost" data-rm-new="${i}" aria-label="Remove">${icon('x')}</button></div>`)}`);
  };
  drawFiles();
  const addFiles = (fl) => {
    for (const f of fl) {
      if (f.size > 10 * 1048576) { toast(`${f.name} is larger than 10 MB`, 'error'); continue; }
      newFiles.push(f);
    }
    drawFiles();
  };
  const drop = $('#drop', el), input = $('#files', el);
  drop.onclick = () => input.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  on(el, 'click', '[data-rm-old]', (e, b) => { removeIds.add(Number(b.dataset.rmOld)); drawFiles(); });
  on(el, 'click', '[data-rm-new]', (e, b) => { newFiles.splice(Number(b.dataset.rmNew), 1); drawFiles(); });

  const loadStudents = async () => {
    const pick = $('#studentPick', el);
    const div = formEl.division_id.value;
    if (!div) { pick.innerHTML = '<div class="xs muted">Select a class first</div>'; return; }
    mount(pick, loading());
    const r = await api('/api/teacher/students', { query: { division_id: div } });
    const ids = new Set(r.rows.map((s) => s.id));
    selected = new Set([...selected].filter((x) => ids.has(x)));
    mount(pick, html`<div class="row between mb-12"><span class="xs muted" id="selCount">${selected.size} selected</span><button type="button" class="btn xs" id="selAll">Select all</button></div>
      <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:6px 10px">${r.rows.map((s) => html`<label class="check" style="display:flex;padding:5px 0"><input type="checkbox" data-sid="${s.id}" ${selected.has(s.id) ? 'checked' : ''}> <span class="small">${s.roll_no}. ${s.full_name}</span></label>`)}</div>`);
    $('#selAll', pick).onclick = () => { r.rows.forEach((s) => selected.add(s.id)); $$('[data-sid]', pick).forEach((c) => (c.checked = true)); $('#selCount', pick).textContent = `${selected.size} selected`; };
    pick.onchange = (e) => { const c = e.target.closest('[data-sid]'); if (!c) return; const sid = Number(c.dataset.sid); c.checked ? selected.add(sid) : selected.delete(sid); $('#selCount', pick).textContent = `${selected.size} selected`; };
  };
  if (v.assign_to === 'selected') loadStudents();
  formEl.addEventListener('change', (e) => {
    if (e.target.name === 'assign_to') { $('#studentPick', el).classList.toggle('hidden', e.target.value !== 'selected'); if (e.target.value === 'selected') loadStudents(); }
    if (e.target.name === 'division_id') {
      formEl.subject_id.innerHTML = String(subjectOptions(formEl.subject_id.value, e.target.value));
      if (formEl.assign_to.value === 'selected') loadStudents();
    }
    if (e.target.name === 'homework_date' && formEl.due_date.value < e.target.value) formEl.due_date.value = e.target.value;
  });
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(formEl);
    const fd = new FormData();
    for (const k of ['division_id', 'subject_id', 'homework_date', 'due_date', 'title', 'instructions']) fd.append(k, formEl[k].value);
    fd.append('assign_to', formEl.assign_to.value);
    fd.append('allow_submission', formEl.allow_submission.checked ? '1' : '0');
    if (formEl.assign_to.value === 'selected') fd.append('student_ids', JSON.stringify([...selected]));
    newFiles.forEach((f) => fd.append('files', f, f.name));
    if (removeIds.size) fd.append('remove_attachment_ids', [...removeIds].join(','));
    await withBusy(e.submitter || $('button[type=submit]', formEl), async () => {
      try {
        const r = await api(id ? `/api/homework/${id}` : '/api/homework', { method: id ? 'PUT' : 'POST', form: fd });
        toast(id ? 'Homework updated' : 'Homework published — students & parents notified', 'success');
        navigate(`homework/${r.id}`);
      } catch (err) { showErrors(formEl, err); $('#formErr', el).innerHTML = String(html`<div class="banner danger">${icon('alert')}<span>${err.message}</span></div>`); }
    });
  });
}

// ---------- detail ----------
async function detail(el, id) {
  const { meta } = store;
  const hw = await api(`/api/homework/${id}`);
  let tab = 'all';
  const draw = () => {
    const roster = (hw.roster || []).filter((r) => tab === 'all' || r.status === tab);
    const c = hw.counts || {};
    mount(el, html`
    <div class="page-head"><div><a href="#/homework" class="small bold">${icon('left')} All homework</a><h1 class="mt-8">${hw.title}</h1>
      <div class="row wrap mt-8"><span class="chip">${hw.subject_name}</span><span class="chip">Class ${hw.division_label}</span>${hw.assign_to === 'selected' ? html`<span class="badge b-violet">Selected students</span>` : ''}<span class="small muted">by ${hw.teacher_name || '—'}</span></div></div>
      ${hw.can_edit ? html`<div class="row"><a class="btn" href="#/homework/${id}/edit">${icon('edit')} Edit</a><button class="btn danger" id="del">${icon('trash')} Delete</button></div>` : ''}</div>
    <div class="grid g-main">
      <div class="col gap-16">
        <div class="card"><div class="card-body">
          <div class="grid g-3 mb-16" style="gap:10px">
            <div><div class="xs muted bold">HOMEWORK DATE</div><div class="bold">${fmtDate(hw.homework_date, { weekday: true })}</div></div>
            <div><div class="xs muted bold">DEADLINE</div><div class="bold">${fmtDate(hw.due_date, { weekday: true })} ${hw.due_date < meta.today ? html`<span class="badge b-gray">Closed</span>` : ''}</div></div>
            <div><div class="xs muted bold">ONLINE SUBMISSION</div><div class="bold">${hw.allow_submission ? 'Enabled' : 'Disabled'}</div></div>
          </div>
          <div class="xs muted bold mb-12" style="margin-bottom:6px">INSTRUCTIONS</div>
          <div class="prose">${hw.instructions || html`<span class="muted">No additional instructions.</span>`}</div>
          ${hw.attachments.length ? html`<div class="xs muted bold mt-16" style="margin-bottom:8px">ATTACHMENTS</div>${hw.attachments.map((a) => html`<div class="attach">${icon('file', 'muted')}<div class="grow truncate small">${a.original_name}</div><span class="xs muted hide-m">${fileSize(a.size_bytes)}</span><a class="btn xs" href="/api/files/homework/${a.id}?inline=1" target="_blank" rel="noopener">${icon('eye')} View</a><a class="btn xs" href="/api/files/homework/${a.id}">${icon('download')}</a></div>`)}` : ''}
        </div></div>
        <div class="card"><div class="card-head"><h2>Submission status</h2>${c.submitted ? html`<button class="btn sm" id="reviewAll">${icon('check')} Mark all submitted as reviewed</button>` : ''}</div>
          <div class="tabs">${[['all', 'All', hw.roster.length], ['submitted', 'Submitted', c.submitted], ['reviewed', 'Reviewed', c.reviewed], ['pending', 'Pending', c.pending], ['overdue', 'Overdue', c.overdue]].map(([k, l, n]) => html`<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} <span class="muted">${n || 0}</span></button>`)}</div>
          ${roster.length ? html`<div class="table-wrap"><table class="table"><tbody>${roster.map((r) => html`<tr>
            <td style="width:40px" class="muted">${r.roll_no}</td><td><div class="bold">${r.full_name}</div>${r.submission ? html`<div class="xs muted">${r.submission.content || ''}${r.submission.late ? html` · <span style="color:var(--amber)">late</span>` : ''} · ${fmtDateTime(r.submission.submitted_at)}</div>${r.submission.feedback ? html`<div class="xs" style="color:var(--violet)">Feedback: ${r.submission.feedback}</div>` : ''}` : ''}</td>
            <td>${badge(r.status)}</td>
            <td class="right nowrap">${r.submission?.original_name ? html`<a class="btn xs" href="/api/files/submission/${r.submission.id}">${icon('download')} File</a> ` : ''}${r.submission && r.submission.status !== 'reviewed' ? html`<button class="btn xs primary" data-review="${r.submission.id}" data-name="${r.full_name}">Review</button>` : ''}</td></tr>`)}</tbody></table></div>` : emptyState('No students in this list.')}
        </div>
      </div>
      <div class="col gap-16">
        <div class="card"><div class="card-head"><h2>Summary</h2></div><div class="card-body col gap-16">
          ${[['Assigned', hw.roster.length, 'b-blue'], ['Submitted', (c.submitted || 0) + (c.reviewed || 0), 'b-green'], ['Reviewed', c.reviewed || 0, 'b-violet'], ['Pending', c.pending || 0, 'b-amber'], ['Overdue', c.overdue || 0, 'b-red']].map(([l, n, b]) => html`<div class="row between"><span class="text-2">${l}</span><span class="badge ${b}">${n}</span></div>`)}
          ${progress(hw.roster.length ? (((c.submitted || 0) + (c.reviewed || 0)) / hw.roster.length) * 100 : 0)}
        </div></div>
      </div>
    </div>`);
  };
  draw();
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw(); });
  on(el, 'click', '#del', async () => {
    if (!(await confirmDialog('Delete this homework? Students and parents will no longer see it.', { okLabel: 'Delete' }))) return;
    await api(`/api/homework/${id}`, { method: 'DELETE' }); toast('Homework deleted', 'success'); navigate('homework');
  });
  on(el, 'click', '#reviewAll', async (e, b) => {
    await withBusy(b, async () => { const r = await api(`/api/homework/${id}/review-all`, { method: 'POST' }); toast(`${r.reviewed} submission(s) marked reviewed`, 'success'); });
    Object.assign(hw, await api(`/api/homework/${id}`)); draw();
  });
  on(el, 'click', '[data-review]', (e, b) => modal({
    title: `Review — ${b.dataset.name}`, size: 'sm',
    body: field('Feedback (optional, visible to student & parent)', html`<textarea class="input" name="feedback" rows="3" maxlength="1000" placeholder="e.g. Well done! Neat work."></textarea>`),
    submitLabel: 'Mark reviewed',
    onSubmit: async (form) => {
      await api(`/api/homework/submissions/${b.dataset.review}/review`, { method: 'POST', body: { feedback: form.feedback.value } });
      toast('Marked as reviewed', 'success');
      Object.assign(hw, await api(`/api/homework/${id}`)); draw();
    },
  }));
}
