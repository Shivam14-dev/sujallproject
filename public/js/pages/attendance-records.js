import { html, mount, api, icon, $, $$, on, fmtDate, addDays, dow, loading, emptyState, modal, badge, qs, download, fmtDateTime } from '../lib.js';
import { store, setQuery } from '../app.js';
import { divisionOptions, stat } from './_ui.js';
import { lineChart, progress, pctColor } from '../charts.js';

function presetRange(p, today) {
  if (p === 'daily') return [today, today];
  if (p === 'weekly') { const d = dow(today); return [addDays(today, -((d + 6) % 7)), today]; }
  if (p === 'monthly') return [today.slice(0, 8) + '01', today];
  return null;
}

export default async function render(el, { query }) {
  const { meta } = store;
  if (!meta.divisions.length) { mount(el, html`<div class="card">${emptyState('No classes assigned.', 'layers')}</div>`); return; }
  let divisionId = Number(query.division_id) || meta.divisions.find((d) => d.is_class_teacher)?.id || meta.divisions[0].id;
  let preset = query.preset || 'monthly';
  let [from, to] = presetRange(preset, meta.today) || [query.from || addDays(meta.today, -30), query.to || meta.today];
  let sort = 'roll';

  mount(el, html`
  <div class="page-head"><div><h1>Attendance Records</h1><div class="sub">Class-wise and student-wise attendance with filters.</div></div>
    <div class="row wrap"><button class="btn" id="xpdf">${icon('download')} PDF register</button><button class="btn" id="xxls">${icon('download')} Excel register</button></div></div>
  <div class="card mb-16"><div class="card-body filters">
    ${html`<label class="field"><span>Class & division</span><select class="input" id="div">${divisionOptions(divisionId, { placeholder: undefined })}</select></label>`}
    <label class="field"><span>Period</span><div class="seg" id="preset">${[['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month'], ['custom', 'Custom']].map(([k, l]) => html`<button type="button" data-p="${k}" class="${preset === k ? 'on' : ''}">${l}</button>`)}</div></label>
    <label class="field"><span>From</span><input type="date" class="input" id="from" value="${from}" max="${meta.today}"></label>
    <label class="field"><span>To</span><input type="date" class="input" id="to" value="${to}" max="${meta.today}"></label>
  </div></div>
  <div id="out">${loading()}</div>`);

  const out = $('#out', el);
  async function load() {
    setQuery({ division_id: divisionId, preset, from: preset === 'custom' ? from : '', to: preset === 'custom' ? to : '' });
    mount(out, loading());
    let r;
    try { r = await api('/api/attendance/summary', { query: { division_id: divisionId, from, to } }); }
    catch (e) { mount(out, html`<div class="banner danger">${icon('alert')}<span>${e.message}</span></div>`); return; }
    const rows = [...r.rows].sort((a, b) => (sort === 'pct' ? a.percentage - b.percentage : sort === 'absent' ? b.absent - a.absent : (a.roll_no || 0) - (b.roll_no || 0)));
    const low = r.rows.filter((x) => x.total && x.percentage < 75).length;
    mount(out, html`
      <div class="grid g-4 stats-2m mb-16">
        ${stat('Working days', r.working_days, 'calendar', 'tone-blue', `${fmtDate(from, { year: false })} – ${fmtDate(to, { year: false })}`)}
        ${stat('Average attendance', r.totals.total ? `${r.totals.percentage}%` : '—', 'trend', 'tone-green', `Class ${r.division.label}`)}
        ${stat('Total absences', r.totals.absent, 'xCircle', 'tone-red', `${r.totals.late} late · ${r.totals.half_day} half day`)}
        ${stat('Below 75%', low, 'alert', low ? 'tone-amber' : 'tone-green', 'Students needing follow-up')}
      </div>
      ${r.daily.length > 1 ? html`<div class="card mb-16"><div class="card-head"><h2>Daily attendance %</h2></div><div class="card-body">${lineChart(r.daily.map((d) => ({ label: fmtDate(d.date, { year: false }), value: d.percentage, tip: `${fmtDate(d.date)}: ${d.percentage}% · ${d.absent} absent` })), { min: 50, height: 180 })}</div></div>` : ''}
      <div class="card"><div class="card-head"><h2>Student-wise — Class ${r.division.label}</h2>
        <div class="row"><span class="small muted hide-m">Sort</span><select class="input sm" id="sort" style="width:auto"><option value="roll" ${sort === 'roll' ? 'selected' : ''}>Roll number</option><option value="pct" ${sort === 'pct' ? 'selected' : ''}>Lowest attendance</option><option value="absent" ${sort === 'absent' ? 'selected' : ''}>Most absences</option></select></div></div>
        ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Roll</th><th>Student</th><th>Present</th><th>Absent</th><th class="hide-m">Late</th><th class="hide-m">Half day</th><th style="min-width:150px">Attendance</th><th></th></tr></thead><tbody>
        ${rows.map((s) => html`<tr><td>${s.roll_no}</td><td><div class="bold">${s.full_name}</div><div class="xs muted">${s.admission_no}</div></td>
          <td>${s.present}</td><td>${s.absent ? html`<span class="bold" style="color:var(--red)">${s.absent}</span>` : 0}</td><td class="hide-m">${s.late}</td><td class="hide-m">${s.half_day}</td>
          <td>${s.total ? html`<div class="row"><div class="grow">${progress(s.percentage, pctColor(s.percentage))}</div><span class="small bold" style="width:44px;text-align:right">${s.percentage}%</span></div>` : html`<span class="muted small">No records</span>`}</td>
          <td class="right"><button class="btn xs" data-student="${s.id}">${icon('history')} History</button></td></tr>`)}
        </tbody></table></div>` : emptyState('No students in this class.')}
      </div>`);
    $('#sort', out).onchange = (e) => { sort = e.target.value; load(); };
  }
  on(out, 'click', '[data-student]', (e, b) => studentHistory(Number(b.dataset.student), from, to));

  $('#div', el).onchange = (e) => { divisionId = Number(e.target.value); load(); };
  $$('#preset button', el).forEach((b) => b.addEventListener('click', () => {
    preset = b.dataset.p;
    $$('#preset button', el).forEach((x) => x.classList.toggle('on', x === b));
    const r = presetRange(preset, meta.today);
    if (r) { [from, to] = r; $('#from', el).value = from; $('#to', el).value = to; load(); }
  }));
  const custom = () => { preset = 'custom'; $$('#preset button', el).forEach((x) => x.classList.toggle('on', x.dataset.p === 'custom')); from = $('#from', el).value; to = $('#to', el).value; if (from && to) load(); };
  $('#from', el).onchange = custom; $('#to', el).onchange = custom;
  const exp = (format) => download(`/api/reports/monthly-attendance?${qs({ division_id: divisionId, month: to.slice(0, 7), format })}`);
  $('#xpdf', el).onclick = () => exp('pdf'); $('#xxls', el).onclick = () => exp('xlsx');
  await load();
}

export async function studentHistory(studentId, from, to) {
  const m = modal({ title: 'Student attendance', size: 'lg', body: loading() });
  try {
    const r = await api(`/api/attendance/student/${studentId}`, { query: { from, to } });
    $('.modal-head h2', m.el).textContent = `${r.student.full_name} — Class ${r.student.division_label}`;
    $('.modal-body', m.el).innerHTML = String(html`
      <div class="row wrap mb-16"><span class="badge b-blue">${r.summary.percentage}% attendance</span><span class="badge b-present">${r.summary.present} present</span><span class="badge b-absent">${r.summary.absent} absent</span><span class="badge b-late">${r.summary.late} late</span><span class="badge b-half_day">${r.summary.half_day} half day</span>
        <a class="btn xs" style="margin-left:auto" href="/api/reports/student-attendance?${qs({ student_id: studentId, from, to, format: 'pdf' })}">${icon('download')} PDF</a></div>
      ${r.history.length ? html`<h3 class="mb-12">Edit history</h3><div class="table-wrap mb-16"><table class="table"><thead><tr><th>Date</th><th>Change</th><th>Reason</th><th>By</th><th>When</th></tr></thead><tbody>${r.history.map((h) => html`<tr><td>${fmtDate(h.date)}</td><td>${badge(h.old_status)} → ${badge(h.new_status)}</td><td class="small">${h.reason || '—'}</td><td class="small">${h.changed_by_name}</td><td class="small nowrap">${fmtDateTime(h.changed_at)}</td></tr>`)}</tbody></table></div>` : ''}
      <h3 class="mb-12">Daily records</h3>
      ${r.records.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${r.records.map((x) => html`<tr><td>${fmtDate(x.date, { weekday: true })}</td><td>${badge(x.status)}</td><td class="small">${x.remarks || ''}</td></tr>`)}</tbody></table></div>` : emptyState('No attendance records in this period')}`);
  } catch (e) { $('.modal-body', m.el).textContent = e.message; }
}
