import { html, mount, api, icon, fmtDate, initials, on, badge, emptyState, subjectTone, timeAgo } from '../lib.js';
import { store, navigate, setChild } from '../app.js';
import { donut, lineChart, COLORS } from '../charts.js';
import { stat, announcementItem, eventItem, cardHead } from './_ui.js';

export function childSwitcher() {
  if (store.me.role !== 'parent' || store.children.length < 2) return '';
  return html`<div class="child-switch mb-16" id="childSwitch">${store.children.map((c) => html`<button data-child="${c.id}" class="${c.id === store.childId ? 'on' : ''}"><span class="avatar sm">${initials(c.full_name)}</span><span class="col" style="gap:0;text-align:left"><span class="bold small">${c.full_name}</span><span class="xs muted">Class ${c.division_label}</span></span></button>`)}</div>`;
}
export function bindSwitcher(el) { on(el, 'click', '[data-child]', (e, b) => setChild(b.dataset.child)); }
export function noChild(el) {
  mount(el, html`<div class="card">${emptyState('No student is linked to your account yet. Please contact the school office.', 'user')}</div>`);
}

export default async function render(el) {
  if (!store.childId) return noChild(el);
  const d = await api(`/api/students/${store.childId}/overview`);
  const s = d.student;
  const isParent = store.me.role === 'parent';
  const todayBadge = d.today ? badge(d.today.status) : html`<span class="badge b-gray">Not marked yet</span>`;
  const hc = d.homework_counts;

  mount(el, html`
  ${childSwitcher()}
  <div class="card mb-16"><div class="profile-hero">
    <div class="avatar lg">${initials(s.full_name)}</div>
    <div class="grow"><h1>${isParent ? s.full_name : `Hello, ${s.full_name.split(' ')[0]}!`}</h1>
      <div class="row wrap mt-8"><span class="chip">Class ${s.division_label}</span><span class="small muted">Roll no. ${s.roll_no} · ${s.admission_no}</span>${s.class_teacher_name ? html`<span class="small muted">· Class teacher: ${s.class_teacher_name}</span>` : ''}</div></div>
    <div class="col hide-m" style="align-items:flex-end"><span class="xs muted bold">TODAY · ${fmtDate(d.date, { year: false })}</span>${todayBadge}${d.today?.remarks ? html`<span class="xs muted">${d.today.remarks}</span>` : ''}</div>
  </div></div>

  <div class="grid g-4 stats-2m mb-16">
    ${stat("Today's attendance", d.today ? html`${badge(d.today.status)}` : '—', 'attendance', d.today?.status === 'absent' ? 'tone-red' : 'tone-green', d.today ? (d.today.remarks || 'Marked by class teacher') : 'Not marked yet')}
    ${stat('This month', d.month.total ? `${d.month.percentage}%` : '—', 'calendar', 'tone-blue', `${d.month.present + d.month.late} present · ${d.month.absent} absent`)}
    ${stat('This year', d.year.total ? `${d.year.percentage}%` : '—', 'trend', d.year.percentage >= 75 ? 'tone-green' : 'tone-amber', `${d.year.total} school days`)}
    ${stat('Pending homework', d.pending.length, 'book', d.pending.length ? 'tone-amber' : 'tone-green', `${hc.overdue || 0} overdue`)}
  </div>

  <div class="grid g-main">
    <div class="col gap-16">
      <div class="card">${cardHead(`Today's homework`, html`<a class="small bold" href="#/homework">All homework</a>`)}
        ${d.homework_today.length ? d.homework_today.map((h) => hwRow(h)) : emptyState('No homework assigned today.', 'book')}</div>
      <div class="card">${cardHead('Upcoming deadlines')}
        ${d.pending.length ? d.pending.slice(0, 6).map((h) => hwRow(h, true)) : emptyState('All caught up — nothing pending!', 'checkCircle')}</div>
      ${d.monthly.length ? html`<div class="card">${cardHead('Monthly attendance %')}<div class="card-body">${lineChart(d.monthly.map((m) => ({ label: fmtDate(m.month + '-01', { year: false }).split(' ')[1], value: m.percentage })), { min: 50, height: 180 })}</div></div>` : ''}
    </div>
    <div class="col gap-16">
      <div class="card">${cardHead('Attendance this month', html`<a class="small bold" href="#/attendance">Details</a>`)}<div class="card-body">
        ${donut([{ label: 'Present', value: d.month.present, color: COLORS.present }, { label: 'Absent', value: d.month.absent, color: COLORS.absent }, { label: 'Late', value: d.month.late, color: COLORS.late }, { label: 'Half day', value: d.month.half_day, color: COLORS.half_day }], { center: d.month.total ? `${d.month.percentage}%` : '—', sub: `${d.month.total} days` })}
        <div class="row wrap mt-12">${d.recent.slice(0, 10).reverse().map((r) => html`<span title="${fmtDate(r.date)}: ${r.status}" class="badge b-${r.status}" style="padding:2px 6px">${r.date.slice(8)}</span>`)}</div>
      </div></div>
      ${d.remarks.length ? html`<div class="card">${cardHead('Teacher remarks', html`<a class="small bold" href="#/remarks">All</a>`)}${d.remarks.slice(0, 3).map((r) => html`<div class="list-item" style="align-items:flex-start"><div class="ni tone-violet" style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex:none">${icon('message')}</div><div class="grow"><div class="small">${r.remark}</div><div class="xs muted mt-8">${r.author} · ${timeAgo(r.created_at)}</div></div></div>`)}</div>` : ''}
      <div class="card">${cardHead('Upcoming tests, events & holidays', html`<a class="small bold" href="#/calendar">Calendar</a>`)}
        ${[...d.upcoming, ...d.holidays.map((h) => ({ ...h, start_date: h.date }))].sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 6).map(eventItem)}
        ${!d.upcoming.length && !d.holidays.length ? html`<div class="empty small">Nothing scheduled</div>` : ''}</div>
      <div class="card">${cardHead('School notices', html`<a class="small bold" href="#/announcements">All</a>`)}${d.announcements.length ? d.announcements.slice(0, 4).map(announcementItem) : html`<div class="empty small">No notices</div>`}</div>
    </div>
  </div>`);
  bindSwitcher(el);
  on(el, 'click', '[data-hw]', (e, r) => navigate(`homework/${r.dataset.hw}`));
}

export const hwRow = (h, showDue) => html`<div class="hw-card" data-hw="${h.id}"><div class="subj-ic ${subjectTone(h.subject_name)}">${h.subject_code.slice(0, 4)}</div>
  <div class="grow" style="min-width:0"><div class="row between"><span class="bold truncate">${h.title}</span>${badge(h.student_status)}</div>
  <div class="xs muted mt-8">${h.subject_name} · ${showDue ? html`<b style="color:${h.student_status === 'overdue' ? 'var(--red)' : 'inherit'}">Due ${fmtDate(h.due_date, { weekday: true, year: false })}</b>` : `Due ${fmtDate(h.due_date, { year: false })}`}${h.attachment_count ? html` · ${icon('clip')} ${h.attachment_count} file(s)` : ''}</div></div></div>`;
