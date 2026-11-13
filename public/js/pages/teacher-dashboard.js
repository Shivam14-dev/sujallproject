import { html, mount, api, icon, fmtDate, $, on } from '../lib.js';
import { store, navigate } from '../app.js';
import { lineChart, donut, progress, COLORS, pctColor } from '../charts.js';
import { stat, announcementItem, eventItem, cardHead } from './_ui.js';

export default async function render(el) {
  const d = await api('/api/teacher/dashboard');
  const me = store.me;
  const ct = d.classes.filter((c) => c.is_class_teacher);
  const ctToday = ct.reduce((a, c) => { for (const k of ['present', 'absent', 'late', 'half_day', 'total']) a[k] += c.today[k]; return a; }, { present: 0, absent: 0, late: 0, half_day: 0, total: 0 });
  const hwAssigned = d.recent_homework.reduce((a, h) => a + h.assigned, 0);
  const hwSubmitted = d.recent_homework.reduce((a, h) => a + h.submitted, 0);
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  mount(el, html`
  <div class="page-head"><div><h1>${greet}, ${me.full_name.split(' ')[0]}</h1><div class="sub">${fmtDate(d.date, { weekday: true })}${ct.length ? ` · Class teacher of ${ct.map((c) => c.label).join(', ')}` : ''}</div></div>
    <div class="row wrap"><a class="btn" href="#/homework/new">${icon('plus')} Give homework</a><a class="btn primary" href="#/attendance">${icon('attendance')} Mark attendance</a></div></div>

  ${d.pending_attendance.length ? html`<div class="banner warn mb-16">${icon('clock')}<span class="grow">Today's attendance is <b>not marked</b> for ${d.pending_attendance.map((p) => `Class ${p.label}`).join(', ')}.</span>
    <a class="btn sm" href="#/attendance?division_id=${d.pending_attendance[0].id}">Mark now</a></div>`
    : ct.length ? html`<div class="banner success mb-16">${icon('checkCircle')}<span>Today's attendance has been marked for all your classes. Great job!</span></div>` : ''}

  <div class="grid g-4 stats-2m mb-16">
    ${stat('Assigned classes', d.classes.length, 'layers', 'tone-blue', `${ct.length} as class teacher`)}
    ${stat('My students', d.student_count, 'cap', 'tone-sky', 'Across all assigned classes')}
    ${stat("Today's attendance", ctToday.total ? `${Math.round(((ctToday.present + ctToday.late + ctToday.half_day * 0.5) / ctToday.total) * 100)}%` : '—', 'attendance', 'tone-green', ctToday.total ? `${ctToday.absent} absent · ${ctToday.late} late` : 'Not marked yet')}
    ${stat('To review', d.pending_review, 'inbox', 'tone-amber', 'Homework submissions waiting')}
  </div>

  <div class="grid g-main">
    <div class="col gap-16">
      <div class="card">${cardHead('My classes today', html`<a class="small bold" href="#/attendance-reports">Attendance records</a>`)}
        <div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Role</th><th class="hide-m">Subjects</th><th>Students</th><th>Today</th><th></th></tr></thead><tbody>
        ${d.classes.map((c) => html`<tr>
          <td class="bold">Class ${c.label}</td>
          <td>${c.is_class_teacher ? html`<span class="badge b-blue">Class teacher</span>` : html`<span class="badge b-gray">Subject</span>`}</td>
          <td class="hide-m small text-2">${c.subjects.join(', ') || '—'}</td>
          <td>${c.student_count}</td>
          <td>${c.attendance_marked ? html`<div class="row gap-4"><span class="badge b-present">${c.today.present + c.today.late} P</span><span class="badge b-absent">${c.today.absent} A</span></div>` : html`<span class="badge b-gray">Not marked</span>`}</td>
          <td class="right">${c.is_class_teacher ? html`<a class="btn xs ${c.attendance_marked ? '' : 'primary'}" href="#/attendance?division_id=${c.id}">${c.attendance_marked ? 'View / edit' : 'Mark'}</a>` : html`<a class="btn xs" href="#/my-students?division_id=${c.id}">Students</a>`}</td>
        </tr>`)}
        </tbody></table></div></div>

      ${ct.length ? html`<div class="card">${cardHead(`Attendance trend — last 2 weeks (${ct.map((c) => c.label).join(', ')})`)}
        <div class="card-body">${lineChart(d.trend.map((t) => ({ label: fmtDate(t.date, { year: false }), value: t.percentage })), { min: 50 })}</div></div>` : ''}

      <div class="card">${cardHead('Recent homework & submissions', html`<a class="btn xs" href="#/homework">View all</a>`)}
        ${d.recent_homework.length ? d.recent_homework.map((h) => {
          const p = h.assigned ? Math.round((h.submitted / h.assigned) * 100) : 0;
          return html`<div class="list-item link" data-hw="${h.id}"><div class="grow"><div class="row wrap gap-4"><span class="bold">${h.title}</span><span class="chip">${h.subject} · ${h.division}</span></div>
            <div class="xs muted mt-8">Given ${fmtDate(h.homework_date, { year: false })} · Due ${fmtDate(h.due_date, { year: false })}</div></div>
            <div style="width:150px" class="hide-m"><div class="row between xs muted"><span>${h.submitted}/${h.assigned} submitted</span><span>${p}%</span></div>${progress(p, pctColor(p))}</div></div>`;
        }) : html`<div class="empty">${icon('book')}<div>No homework given yet. <a href="#/homework/new">Give homework</a></div></div>`}</div>
    </div>

    <div class="col gap-16">
      ${ct.length ? html`<div class="card">${cardHead("Today's class attendance")}<div class="card-body">
        ${donut([{ label: 'Present', value: ctToday.present, color: COLORS.present }, { label: 'Absent', value: ctToday.absent, color: COLORS.absent }, { label: 'Late', value: ctToday.late, color: COLORS.late }, { label: 'Half day', value: ctToday.half_day, color: COLORS.half_day }],
          { center: ctToday.total ? `${Math.round(((ctToday.present + ctToday.late + ctToday.half_day * 0.5) / ctToday.total) * 100)}%` : '—', sub: ctToday.total ? 'attendance' : 'not marked' })}
      </div></div>` : ''}
      <div class="card">${cardHead('Homework submission overview')}<div class="card-body">
        ${donut([{ label: 'Submitted', value: hwSubmitted, color: COLORS.present }, { label: 'Not submitted', value: Math.max(hwAssigned - hwSubmitted, 0), color: COLORS.muted }], { center: hwAssigned ? `${Math.round((hwSubmitted / hwAssigned) * 100)}%` : '—', sub: 'last 8 tasks' })}
      </div></div>
      ${d.low_attendance.length ? html`<div class="card">${cardHead('Needs attention (below threshold, 30 days)')}
        ${d.low_attendance.map((s) => html`<a class="list-item link" href="#/students/${s.id}" style="text-decoration:none;color:inherit"><div class="avatar sm">${s.roll_no}</div><div class="grow"><div class="bold small">${s.full_name}</div><div class="xs muted">Class ${s.division} · ${s.days} days</div></div><span class="badge b-red">${s.percentage}%</span></a>`)}</div>` : ''}
      <div class="card">${cardHead('Upcoming', html`<a class="small bold" href="#/calendar">Calendar</a>`)}${d.upcoming.length ? d.upcoming.map(eventItem) : html`<div class="empty small">No upcoming events</div>`}</div>
      <div class="card">${cardHead('Announcements', html`<a class="small bold" href="#/announcements">All</a>`)}${d.announcements.length ? d.announcements.slice(0, 4).map(announcementItem) : html`<div class="empty small">No announcements</div>`}</div>
    </div>
  </div>`);
  on(el, 'click', '[data-hw]', (e, t) => navigate(`homework/${t.dataset.hw}`));
}
