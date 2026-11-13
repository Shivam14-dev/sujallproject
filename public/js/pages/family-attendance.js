import { html, mount, api, icon, fmtDate, monthName, badge, emptyState, $, loading, addDays } from '../lib.js';
import { store } from '../app.js';
import { stat } from './_ui.js';
import { childSwitcher, bindSwitcher, noChild } from './family-dashboard.js';

export default async function render(el) {
  if (!store.childId) return noChild(el);
  let month = store.meta.today.slice(0, 7);
  const holidays = (await api('/api/holidays')).rows;
  mount(el, html`${childSwitcher()}<div id="att">${loading()}</div>`);
  bindSwitcher(el);
  const box = $('#att', el);

  async function load() {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${month}-${String(last).padStart(2, '0')}`;
    mount(box, loading());
    const r = await api(`/api/attendance/student/${store.childId}`, { query: { from, to } });
    const yr = await api(`/api/students/${store.childId}/overview`);
    const map = new Map(r.records.map((x) => [x.date, x]));
    const hol = new Map(holidays.filter((h) => h.date.startsWith(month)).map((h) => [h.date, h.name]));
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(html`<div class="c blank"></div>`);
    for (let d = 1; d <= last; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const rec = map.get(iso);
      const cls = rec ? rec.status : hol.has(iso) ? 'holiday' : '';
      const tip = rec ? `${fmtDate(iso)}: ${rec.status.replace('_', ' ')}${rec.remarks ? ' — ' + rec.remarks : ''}` : hol.has(iso) ? `${fmtDate(iso)}: ${hol.get(iso)}` : fmtDate(iso);
      cells.push(html`<div class="c ${cls} ${iso === store.meta.today ? 'today' : ''}" title="${tip}">${d}</div>`);
    }
    const s = r.summary;
    mount(box, html`
      <div class="page-head"><div><h1>${store.me.role === 'parent' ? `${r.student.full_name}'s attendance` : 'My attendance'}</h1><div class="sub">Class ${r.student.division_label} · Academic year ${yr.year.percentage}% overall (${yr.year.total} days)</div></div></div>
      <div class="grid g-4 stats-2m mb-16">
        ${stat('Attendance', s.total ? `${s.percentage}%` : '—', 'trend', s.percentage >= 75 || !s.total ? 'tone-green' : 'tone-amber', monthName(month))}
        ${stat('Present', s.present, 'checkCircle', 'tone-green', `${s.late} late`)}
        ${stat('Absent', s.absent, 'xCircle', 'tone-red', 'days this month')}
        ${stat('Half day', s.half_day, 'clock', 'tone-violet', `${s.total} school days`)}
      </div>
      <div class="grid g-2">
        <div class="card"><div class="card-head"><button class="btn icon sm" id="prevM" aria-label="Previous month">${icon('left')}</button><h2>${monthName(month)}</h2><button class="btn icon sm" id="nextM" aria-label="Next month" ${month >= store.meta.today.slice(0, 7) ? 'disabled' : ''}>${icon('right')}</button></div>
          <div class="card-body"><div class="att-cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => html`<div class="h">${x}</div>`)}${cells}</div>
          <div class="legend mt-16"><span><i style="background:var(--green-50);border:1px solid var(--green)"></i>Present</span><span><i style="background:var(--red-50);border:1px solid var(--red)"></i>Absent</span><span><i style="background:var(--amber-50);border:1px solid var(--amber)"></i>Late</span><span><i style="background:var(--violet-50);border:1px solid var(--violet)"></i>Half day</span><span><i style="border:1px dashed #f3b0b0"></i>Holiday</span></div></div></div>
        <div class="card"><div class="card-head"><h2>Daily log</h2></div>
          ${r.records.length ? html`<div class="table-wrap" style="max-height:440px;overflow:auto"><table class="table"><tbody>${r.records.map((x) => html`<tr><td>${fmtDate(x.date, { weekday: true })}</td><td>${badge(x.status)}</td><td class="small muted">${x.remarks || ''}</td></tr>`)}</tbody></table></div>` : emptyState('No attendance recorded this month.', 'calendar')}</div>
      </div>`);
    $('#prevM', box).onclick = () => { month = addDays(`${month}-01`, -1).slice(0, 7); load(); };
    $('#nextM', box).onclick = () => { month = addDays(`${month}-28`, 7).slice(0, 7); load(); };
  }
  await load();
}
