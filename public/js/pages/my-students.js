import { html, mount, api, icon, $, on, loading, emptyState, initials } from '../lib.js';
import { store, navigate, setQuery } from '../app.js';
import { divisionOptions } from './_ui.js';
import { progress, pctColor } from '../charts.js';

export default async function render(el, { query }) {
  const { meta } = store;
  if (!meta.divisions.length) { mount(el, html`<div class="card">${emptyState('No classes assigned.', 'layers')}</div>`); return; }
  let divisionId = Number(query.division_id) || meta.divisions.find((d) => d.is_class_teacher)?.id || meta.divisions[0].id;
  let q = '';
  mount(el, html`
  <div class="page-head"><div><h1>My Students</h1><div class="sub">Students in your classes, attendance over the last 30 days, and remarks.</div></div></div>
  <div class="card mb-16"><div class="card-body filters">
    <label class="field"><span>Class & division</span><select class="input" id="div">${divisionOptions(divisionId, { placeholder: undefined })}</select></label>
    <label class="field" style="flex:1 1 220px"><span>Search</span><div class="search">${icon('search')}<input class="input" id="q" placeholder="Name, roll no or admission no"></div></label>
  </div></div>
  <div class="card" id="list">${loading()}</div>`);
  const listEl = $('#list', el);
  let data;
  const draw = () => {
    const rows = data.rows.filter((s) => !q || s.full_name.toLowerCase().includes(q) || String(s.roll_no) === q || s.admission_no.toLowerCase().includes(q));
    mount(listEl, html`<div class="card-head"><h2>Class ${data.division.label}</h2><span class="small muted">${data.rows.length} students · Class teacher: ${data.division.class_teacher_name || '—'}</span></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Roll</th><th>Student</th><th class="hide-m">Parent</th><th style="min-width:150px">Attendance (30d)</th><th class="hide-m">Remarks</th><th></th></tr></thead><tbody>
      ${rows.map((s) => html`<tr class="link" data-id="${s.id}" style="cursor:pointer"><td>${s.roll_no}</td><td><div class="row"><div class="avatar sm">${initials(s.full_name)}</div><div><div class="bold">${s.full_name}</div><div class="xs muted">${s.admission_no}</div></div></div></td>
        <td class="hide-m small">${s.parent_name || '—'}<div class="xs muted">${s.parent_phone || ''}</div></td>
        <td>${s.days ? html`<div class="row"><div class="grow">${progress(s.percentage, pctColor(s.percentage))}</div><span class="small bold" style="width:44px;text-align:right">${s.percentage}%</span></div>` : html`<span class="muted small">—</span>`}</td>
        <td class="hide-m">${s.remarks ? html`<span class="badge b-violet">${s.remarks}</span>` : html`<span class="muted small">0</span>`}</td><td class="right">${icon('right', 'muted')}</td></tr>`)}
      </tbody></table></div>` : emptyState('No students match your search.')}`);
  };
  const load = async () => { setQuery({ division_id: divisionId }); mount(listEl, loading()); data = await api('/api/teacher/students', { query: { division_id: divisionId } }); draw(); };
  $('#div', el).onchange = (e) => { divisionId = Number(e.target.value); load(); };
  $('#q', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  on(listEl, 'click', 'tr[data-id]', (e, tr) => navigate(`students/${tr.dataset.id}`));
  await load();
}
