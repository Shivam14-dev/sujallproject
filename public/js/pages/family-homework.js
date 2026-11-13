import { html, mount, api, icon, fmtDate, badge, emptyState, $, $$, on, loading, options, toast, fileSize, withBusy, field, fmtDateTime, addDays } from '../lib.js';
import { store, navigate, setQuery } from '../app.js';
import { childSwitcher, bindSwitcher, noChild, hwRow } from './family-dashboard.js';

export default async function render(el, ctx) {
  if (!store.childId) return noChild(el);
  if (ctx.pattern === 'homework/:id') return detail(el, Number(ctx.params.id));
  const f = { subject_id: ctx.query.subject_id || '', status: ctx.query.status || 'open', from: ctx.query.from || addDays(store.meta.today, -30) };
  mount(el, html`${childSwitcher()}
  <div class="page-head"><div><h1>Homework</h1><div class="sub">Date-wise homework with deadlines and attachments.</div></div></div>
  <div class="card mb-16"><div class="card-body filters">
    <label class="field"><span>Show</span><div class="seg" id="status">${[['open', 'Pending'], ['completed', 'Completed'], ['', 'All']].map(([k, l]) => html`<button type="button" data-s="${k}" class="${f.status === k ? 'on' : ''}">${l}</button>`)}</div></label>
    <label class="field"><span>Subject</span><select class="input" id="subject">${options(store.meta.subjects.map((s) => [s.id, s.name]), f.subject_id, { placeholder: 'All subjects' })}</select></label>
    <label class="field"><span>Since</span><input type="date" class="input" id="from" value="${f.from}"></label>
  </div></div>
  <div class="card" id="list">${loading()}</div>`);
  bindSwitcher(el);
  const listEl = $('#list', el);
  async function load() {
    setQuery(f);
    mount(listEl, loading());
    const { rows } = await api('/api/homework', { query: { ...f, student_id: store.childId } });
    if (!rows.length) { mount(listEl, emptyState(f.status === 'open' ? 'No pending homework — well done!' : 'No homework found.', 'book')); return; }
    const groups = new Map();
    for (const h of rows) { if (!groups.has(h.homework_date)) groups.set(h.homework_date, []); groups.get(h.homework_date).push(h); }
    mount(listEl, html`${[...groups.entries()].map(([date, items]) => html`<div style="padding:10px 18px;background:#fafbfd;border-bottom:1px solid var(--border)" class="xs bold muted">${date === store.meta.today ? 'TODAY · ' : ''}${fmtDate(date, { weekday: true }).toUpperCase()}</div>${items.map((h) => hwRow(h, true))}`)}`);
  }
  on(listEl, 'click', '[data-hw]', (e, r) => navigate(`homework/${r.dataset.hw}`));
  $$('#status button', el).forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.s; $$('#status button', el).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#subject', el).onchange = (e) => { f.subject_id = e.target.value; load(); };
  $('#from', el).onchange = (e) => { f.from = e.target.value; load(); };
  await load();
}

async function detail(el, id) {
  const hw = await api(`/api/homework/${id}`, { query: store.me.role === 'parent' ? { student_id: store.childId } : {} });
  const sub = hw.submission;
  const canSubmit = sub?.status !== 'reviewed';
  const child = store.me.role === 'parent' ? store.children.find((c) => c.id === hw.student_id) : null;
  mount(el, html`
  <div class="page-head"><div><a href="#/homework" class="small bold">${icon('left')} Homework</a><h1 class="mt-8">${hw.title}</h1>
    <div class="row wrap mt-8"><span class="chip">${hw.subject_name}</span>${badge(hw.student_status)}<span class="small muted">by ${hw.teacher_name || 'Teacher'}${child ? ` · for ${child.full_name}` : ''}</span></div></div></div>
  <div class="grid g-main">
    <div class="card"><div class="card-body">
      <div class="grid g-2 mb-16" style="gap:10px">
        <div><div class="xs muted bold">GIVEN ON</div><div class="bold">${fmtDate(hw.homework_date, { weekday: true })}</div></div>
        <div><div class="xs muted bold">SUBMIT BY</div><div class="bold" style="color:${hw.student_status === 'overdue' ? 'var(--red)' : 'inherit'}">${fmtDate(hw.due_date, { weekday: true })}</div></div>
      </div>
      <div class="xs muted bold" style="margin-bottom:6px">INSTRUCTIONS</div>
      <div class="prose">${hw.instructions || html`<span class="muted">No additional instructions.</span>`}</div>
      ${hw.attachments.length ? html`<div class="xs muted bold mt-16" style="margin-bottom:8px">ATTACHMENTS</div>${hw.attachments.map((a) => html`<div class="attach">${icon('file', 'muted')}<div class="grow truncate small">${a.original_name}</div><span class="xs muted hide-m">${fileSize(a.size_bytes)}</span><a class="btn xs" href="/api/files/homework/${a.id}?inline=1" target="_blank" rel="noopener">${icon('eye')} View</a><a class="btn xs primary" href="/api/files/homework/${a.id}">${icon('download')} Download</a></div>`)}` : ''}
    </div></div>
    <div class="card"><div class="card-head"><h2>Submission</h2></div><div class="card-body col gap-16">
      ${sub ? html`<div class="banner ${sub.status === 'reviewed' ? 'success' : 'info'}">${icon(sub.status === 'reviewed' ? 'checkCircle' : 'check')}<div><div class="bold">${sub.status === 'reviewed' ? 'Reviewed by teacher' : 'Submitted'}</div><div class="xs">${fmtDateTime(sub.submitted_at)}${sub.content ? ` · ${sub.content}` : ''}</div></div></div>
        ${sub.original_name ? html`<div class="attach">${icon('file', 'muted')}<div class="grow truncate small">${sub.original_name}</div><a class="btn xs" href="/api/files/submission/${sub.id}">${icon('download')}</a></div>` : ''}
        ${sub.feedback ? html`<div><div class="xs muted bold">TEACHER FEEDBACK</div><div class="prose mt-8">${sub.feedback}</div></div>` : ''}` : ''}
      ${canSubmit ? html`<form id="subForm" class="col gap-16" novalidate>
        ${field(sub ? 'Update note' : 'Note to teacher (optional)', html`<textarea class="input" name="content" rows="3" maxlength="3000" placeholder="e.g. Completed in notebook"></textarea>`)}
        ${hw.allow_submission ? html`<label class="field"><span>Upload work (optional)</span><input type="file" class="input" name="file" style="padding:7px" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt"><span class="xs muted">PDF, photo or document up to 10 MB</span></label>` : html`<div class="xs muted">Online file upload is not enabled for this homework — submit the work in class and mark it as done here.</div>`}
        <div id="subErr"></div>
        <button class="btn primary" type="submit">${icon('check')} ${sub ? 'Update submission' : 'Mark as done / Submit'}</button>
      </form>` : ''}
    </div></div>
  </div>`);
  $('#subForm', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData();
    fd.append('content', form.content.value);
    if (store.me.role === 'parent') fd.append('student_id', hw.student_id);
    if (form.file?.files[0]) fd.append('file', form.file.files[0]);
    await withBusy(e.submitter, async () => {
      try { await api(`/api/homework/${id}/submit`, { method: 'POST', form: fd }); toast('Homework submitted', 'success'); detail(el, id); }
      catch (err) { $('#subErr', el).innerHTML = String(html`<div class="banner danger">${icon('alert')}<span>${err.message}</span></div>`); }
    });
  });
}
