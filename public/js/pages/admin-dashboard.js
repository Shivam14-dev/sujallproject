import { html, mount, api, icon, fmtDate, on } from '../lib.js';
import { navigate } from '../app.js';
import { lineChart, barChart, donut, COLORS, progress, pctColor } from '../charts.js';
import { stat, announcementItem, cardHead } from './_ui.js';

export default async function render(el) {
  const d = await api('/api/admin/dashboard');
  const t = d.today;
  const notMarked = d.by_division.filter((x) => !x.marked && x.students);
  mount(el, html`
  <div class="page-head"><div><h1>School overview</h1><div class="sub">${fmtDate(d.date, { weekday: true })}</div></div>
    <div class="row wrap"><a class="btn" href="#/reports">${icon('download')} Reports</a><a class="btn" href="#/announcements?new=1">${icon('megaphone')} New announcement</a><a class="btn primary" href="#/students?new=1">${icon('userPlus')} Add student</a></div></div>

  <div class="grid g-5 mb-16">
    ${stat('Total students', d.totals.students, 'cap', 'tone-blue', `${d.totals.parents} parent accounts`)}
    ${stat('Total teachers', d.totals.teachers, 'users', 'tone-violet', 'Active staff')}
    ${stat('Classes', d.totals.classes, 'layers', 'tone-sky', `${d.totals.divisions} divisions`)}
    ${stat("Today's attendance", t.marked ? `${t.percentage}%` : '—', 'attendance', 'tone-green', `${t.present + t.late} present · ${t.absent} absent`)}
    ${stat('Not yet marked', t.unmarked, 'clock', t.unmarked ? 'tone-amber' : 'tone-green', `${notMarked.length} class(es) pending`)}
  </div>

  <div class="grid g-main mb-16">
    <div class="card">${cardHead('Attendance trend — last 30 days', html`<a class="small bold" href="#/attendance-reports">Details</a>`)}
      <div class="card-body">${lineChart(d.trend.map((x) => ({ label: fmtDate(x.date, { year: false }), value: x.percentage, tip: `${fmtDate(x.date)}: ${x.percentage}% (${x.absent} absent)` })), { min: 60 })}</div></div>
    <div class="card">${cardHead('Present vs absent today')}<div class="card-body">
      ${donut([{ label: 'Present', value: t.present, color: COLORS.present }, { label: 'Absent', value: t.absent, color: COLORS.absent }, { label: 'Late', value: t.late, color: COLORS.late }, { label: 'Half day', value: t.half_day, color: COLORS.half_day }, { label: 'Not marked', value: t.unmarked, color: COLORS.muted }],
        { center: t.marked ? `${t.percentage}%` : '—', sub: `${t.marked} marked` })}
    </div></div>
  </div>

  <div class="card mb-16">${cardHead("Class-wise attendance today")}
    <div class="card-body">${barChart(d.by_division.map((x) => ({ label: x.label, values: { present: x.marked - x.absent, absent: x.absent, pending: x.marked ? 0 : x.students } })),
      [{ key: 'present', label: 'Present', color: COLORS.present }, { key: 'absent', label: 'Absent', color: COLORS.absent }, { key: 'pending', label: 'Not marked', color: COLORS.muted }], { height: 220 })}</div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Class teacher</th><th>Students</th><th>Status</th><th>Present</th><th>Absent</th><th style="width:160px" class="hide-m">Attendance</th><th></th></tr></thead><tbody>
    ${d.by_division.map((x) => { const p = x.marked ? Math.round(((x.marked - x.absent) / x.marked) * 100) : 0; return html`<tr>
      <td class="bold">${x.label}</td><td class="small">${x.class_teacher || html`<span class="muted">Not assigned</span>`}</td><td>${x.students}</td>
      <td>${x.marked ? html`<span class="badge b-present">Marked</span>` : html`<span class="badge b-pending">Pending</span>`}</td>
      <td>${x.marked ? x.marked - x.absent : '—'}</td><td>${x.marked ? x.absent : '—'}</td>
      <td class="hide-m">${x.marked ? html`<div class="row"><div class="grow">${progress(p, pctColor(p))}</div><span class="small bold">${p}%</span></div>` : ''}</td>
      <td class="right"><a class="btn xs" href="#/attendance?division_id=${x.id}">${x.marked ? 'View' : 'Mark'}</a></td></tr>`; })}
    </tbody></table></div></div>

  <div class="grid g-2">
    <div class="card">${cardHead('Recent homework', html`<a class="small bold" href="#/homework">View all</a>`)}
      ${d.recent_homework.map((h) => html`<div class="list-item link" data-hw="${h.id}"><div class="grow"><div class="bold small">${h.title}</div><div class="xs muted">${h.subject} · Class ${h.division} · ${h.teacher || ''}</div></div><div class="xs muted nowrap">Due ${fmtDate(h.due_date, { year: false })}</div></div>`)}</div>
    <div class="card">${cardHead('Recent announcements', html`<a class="small bold" href="#/announcements">Manage</a>`)}
      ${d.announcements.length ? d.announcements.map(announcementItem) : html`<div class="empty small">No announcements yet</div>`}</div>
  </div>`);
  on(el, 'click', '[data-hw]', (e, r) => navigate(`homework/${r.dataset.hw}`));
}
