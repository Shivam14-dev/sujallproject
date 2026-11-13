import { html, mount, api, icon, $, $$, loading, emptyState, options, qs, download, addDays, toast } from '../lib.js';
import { store } from '../app.js';
import { divisionOptions } from './_ui.js';

const INFO = {
  'daily-attendance': ['attendance', 'Every student\'s status for one day', ['date', 'division']],
  'monthly-attendance': ['calendar', 'Register view: students × days for a month', ['month', 'division*']],
  'student-attendance': ['user', 'Day-by-day record for one student', ['student', 'range']],
  'class-attendance': ['layers', 'Attendance % for every class', ['range']],
  absentee: ['alert', 'Students below the attendance threshold', ['range', 'division', 'threshold']],
  'homework-assigned': ['book', 'All homework given in a period', ['range', 'division', 'subject']],
  'homework-submission': ['inbox', 'Submission rate for each homework', ['range', 'division']],
  'teacher-activity': ['users', 'Attendance sheets, homework & reviews per teacher', ['range']],
};

export default async function render(el) {
  const { meta } = store;
  const { rows: reports } = await api('/api/reports');
  let type = reports[0].key;
  const p = { date: meta.today, month: meta.today.slice(0, 7), from: addDays(meta.today, -30), to: meta.today, division_id: meta.divisions.find((d) => d.is_class_teacher)?.id || '', subject_id: '', student_id: '', threshold: 75 };
  mount(el, html`
  <div class="page-head"><div><h1>Reports</h1><div class="sub">Preview any report, then download it as PDF or Excel.</div></div></div>
  <div class="grid" style="grid-template-columns:minmax(0,280px) minmax(0,1fr)" id="wrap">
    <div class="card" id="types">${reports.map((r) => html`<div class="list-item link" data-type="${r.key}"><div class="ni tone-blue" style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none">${icon(INFO[r.key][0])}</div><div class="grow"><div class="bold small">${r.title}</div><div class="xs muted">${INFO[r.key][1]}</div></div></div>`)}</div>
    <div class="col gap-16"><div class="card"><div class="card-body filters" id="params"></div></div><div class="card" id="preview">${loading()}</div></div>
  </div>`);
  if (window.matchMedia('(max-width: 1024px)').matches) $('#wrap', el).style.gridTemplateColumns = 'minmax(0,1fr)';
  const typesEl = $('#types', el), paramsEl = $('#params', el), prev = $('#preview', el);
  let studentOpts = [];

  async function drawParams() {
    const need = INFO[type][2];
    $$('[data-type]', typesEl).forEach((x) => (x.style.background = x.dataset.type === type ? 'var(--primary-50)' : ''));
    if (need.includes('student') && p.division_id) studentOpts = (await api('/api/teacher/students', { query: { division_id: p.division_id } })).rows;
    paramsEl.innerHTML = String(html`
      ${need.includes('date') ? html`<label class="field"><span>Date</span><input type="date" class="input" name="date" value="${p.date}" max="${meta.today}"></label>` : ''}
      ${need.includes('month') ? html`<label class="field"><span>Month</span><input type="month" class="input" name="month" value="${p.month}"></label>` : ''}
      ${need.includes('range') ? html`<label class="field"><span>From</span><input type="date" class="input" name="from" value="${p.from}"></label><label class="field"><span>To</span><input type="date" class="input" name="to" value="${p.to}" max="${meta.today}"></label>` : ''}
      ${need.some((n) => n.startsWith('division')) || need.includes('student') ? html`<label class="field"><span>Class</span><select class="input" name="division_id">${divisionOptions(p.division_id, { placeholder: need.includes('division*') || need.includes('student') ? 'Select class' : 'All my classes' })}</select></label>` : ''}
      ${need.includes('student') ? html`<label class="field"><span>Student</span><select class="input" name="student_id">${options(studentOpts.map((s) => [s.id, `${s.roll_no}. ${s.full_name}`]), p.student_id, { placeholder: 'Select student' })}</select></label>` : ''}
      ${need.includes('subject') ? html`<label class="field"><span>Subject</span><select class="input" name="subject_id">${options(meta.subjects.map((s) => [s.id, s.name]), p.subject_id, { placeholder: 'All subjects' })}</select></label>` : ''}
      ${need.includes('threshold') ? html`<label class="field"><span>Below %</span><input type="number" class="input" name="threshold" min="1" max="100" value="${p.threshold}" style="width:90px"></label>` : ''}
      <div class="row" style="align-self:flex-end;margin-left:auto"><button class="btn" data-fmt="pdf">${icon('download')} PDF</button><button class="btn" data-fmt="xlsx">${icon('download')} Excel</button><button class="btn ghost" data-fmt="csv">CSV</button></div>`);
  }
  const params = () => { const need = INFO[type][2]; const q = {}; for (const k of ['date', 'month', 'from', 'to', 'division_id', 'subject_id', 'student_id', 'threshold']) { if ((k === 'date' && need.includes('date')) || (k === 'month' && need.includes('month')) || ((k === 'from' || k === 'to') && need.includes('range')) || (k === 'division_id') || (k === 'subject_id' && need.includes('subject')) || (k === 'student_id' && need.includes('student')) || (k === 'threshold' && need.includes('threshold'))) q[k] = p[k]; } return q; };
  async function preview() {
    mount(prev, loading());
    try {
      const r = await api(`/api/reports/${type}`, { query: params() });
      mount(prev, html`<div class="card-head"><div><h2>${r.title}</h2><div class="xs muted mt-8">${r.subtitle || ''}</div></div><span class="small muted nowrap">${r.total_rows} rows</span></div>
        ${r.rows.length ? html`<div class="table-wrap" style="max-height:560px;overflow:auto"><table class="table"><thead style="position:sticky;top:0"><tr>${r.columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead><tbody>${r.rows.slice(0, 300).map((row) => html`<tr>${r.columns.map((c) => html`<td class="small ${String(row[c.key]) === 'A' || row[c.key] === 'Absent' ? 'bold' : ''}" style="${String(row[c.key]) === 'A' || row[c.key] === 'Absent' ? 'color:var(--red)' : ''}">${row[c.key] ?? ''}</td>`)}</tr>`)}</tbody></table></div>
          ${r.total_rows > 300 ? html`<div class="pager small muted">Showing first 300 rows — download for the full report.</div>` : ''}` : emptyState('No data for the selected filters.', 'chart')}`);
    } catch (e) { mount(prev, html`<div class="card-body"><div class="banner warn">${icon('alert')}<span>${e.message}</span></div></div>`); }
  }
  typesEl.addEventListener('click', async (e) => { const t = e.target.closest('[data-type]'); if (!t) return; type = t.dataset.type; await drawParams(); preview(); });
  paramsEl.addEventListener('change', async (e) => {
    const t = e.target; if (!t.name) return;
    p[t.name] = t.value;
    if (t.name === 'division_id' && INFO[type][2].includes('student')) { p.student_id = ''; await drawParams(); }
    preview();
  });
  paramsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]'); if (!b) return;
    download(`/api/reports/${type}?${qs({ ...params(), format: b.dataset.fmt })}`);
    toast('Preparing download…');
  });
  await drawParams();
  preview();
}
