import { html, mount, api, icon, $, on, fmtDate, initials, badge, emptyState, modal, field, toast, confirmDialog, fmtDateTime, options, addDays } from '../lib.js';
import { store } from '../app.js';
import { stat, cardHead } from './_ui.js';
import { lineChart, donut, COLORS } from '../charts.js';
import { studentHistory } from './attendance-records.js';

const CAT = { general: ['b-gray', 'General'], academic: ['b-blue', 'Academic'], behaviour: ['b-amber', 'Behaviour'], appreciation: ['b-green', 'Appreciation'] };

export default async function render(el, { params }) {
  const id = Number(params.id);
  const [d, rem] = await Promise.all([api(`/api/students/${id}/overview`), api(`/api/students/${id}/remarks`)]);
  const s = d.student;
  const isAdmin = store.me.role === 'admin';
  const full = isAdmin ? await api(`/api/admin/students/${id}`) : null;
  mount(el, html`
  <div class="page-head"><div><a href="${isAdmin ? '#/students' : `#/my-students?division_id=${s.division_id}`}" class="small bold">${icon('left')} Back</a></div>
    <div class="row wrap"><button class="btn" id="hist">${icon('history')} Attendance history</button><button class="btn primary" id="addRemark">${icon('message')} Add remark</button></div></div>
  <div class="card mb-16"><div class="profile-hero"><div class="avatar lg">${initials(s.full_name)}</div>
    <div class="grow"><h1>${s.full_name}</h1><div class="row wrap mt-8"><span class="chip">Class ${s.division_label || '—'}</span><span class="small muted">Roll ${s.roll_no ?? '—'} · ${s.admission_no}${s.blood_group ? ` · Blood group ${s.blood_group}` : ''}</span></div></div>
    <div class="col hide-m" style="align-items:flex-end"><span class="xs muted bold">TODAY</span>${d.today ? badge(d.today.status) : html`<span class="badge b-gray">Not marked</span>`}</div></div></div>
  <div class="grid g-4 stats-2m mb-16">
    ${stat('This month', d.month.total ? `${d.month.percentage}%` : '—', 'calendar', 'tone-blue', `${d.month.absent} absent`)}
    ${stat('Academic year', d.year.total ? `${d.year.percentage}%` : '—', 'trend', d.year.percentage >= 75 ? 'tone-green' : 'tone-amber', `${d.year.total} days · ${d.year.absent} absent`)}
    ${stat('Pending homework', d.pending.length, 'book', 'tone-amber', `${d.homework_counts.overdue || 0} overdue`)}
    ${stat('Remarks', rem.rows.length, 'message', 'tone-violet', 'by teachers')}
  </div>
  <div class="grid g-main">
    <div class="col gap-16">
      ${d.monthly.length ? html`<div class="card">${cardHead('Monthly attendance')}<div class="card-body">${lineChart(d.monthly.map((m) => ({ label: fmtDate(m.month + '-01').split(' ')[1], value: m.percentage })), { min: 40, height: 180 })}</div></div>` : ''}
      <div class="card">${cardHead('Teacher remarks')}
        ${rem.rows.length ? rem.rows.map((r) => html`<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="row wrap"><span class="badge ${CAT[r.category][0]}">${CAT[r.category][1]}</span>${r.visible_to_parent ? '' : html`<span class="badge b-gray">${icon('lock')} Staff only</span>`}<span class="xs muted">${r.author} · ${fmtDateTime(r.created_at)}</span></div><div class="mt-8">${r.remark}</div></div>
          ${isAdmin || r.author_user_id === store.me.id ? html`<button class="btn xs ghost" data-del-remark="${r.id}" aria-label="Delete remark">${icon('trash')}</button>` : ''}</div>`) : emptyState('No remarks yet.', 'message')}</div>
    </div>
    <div class="col gap-16">
      <div class="card">${cardHead('This month')}<div class="card-body">${donut([{ label: 'Present', value: d.month.present, color: COLORS.present }, { label: 'Absent', value: d.month.absent, color: COLORS.absent }, { label: 'Late', value: d.month.late, color: COLORS.late }, { label: 'Half day', value: d.month.half_day, color: COLORS.half_day }], { center: d.month.total ? `${d.month.percentage}%` : '—', size: 130 })}</div></div>
      <div class="card">${cardHead('Details')}<div class="card-body"><dl class="kv">
        <dt>Date of birth</dt><dd>${fmtDate(s.dob)}</dd><dt>Gender</dt><dd>${{ M: 'Male', F: 'Female', O: 'Other' }[s.gender] || '—'}</dd>
        <dt>Class teacher</dt><dd>${s.class_teacher_name || '—'}</dd>
        ${full ? html`<dt>Parent</dt><dd>${full.parent_name || '—'}</dd><dt>Phone</dt><dd>${full.parent_phone || '—'}</dd><dt>Email</dt><dd class="truncate">${full.parent_email || '—'}</dd><dt>Address</dt><dd>${full.address || '—'}</dd><dt>Admitted</dt><dd>${fmtDate(full.admission_date)}</dd><dt>Login</dt><dd>${full.username || 'No account'}</dd>` : ''}
      </dl></div></div>
      <div class="card">${cardHead('Recent attendance')}${d.recent.length ? d.recent.slice(0, 8).map((r) => html`<div class="list-item"><span class="grow small">${fmtDate(r.date, { weekday: true })}</span>${badge(r.status)}</div>`) : emptyState('No records')}</div>
    </div>
  </div>`);
  $('#hist', el).onclick = () => studentHistory(id, addDays(store.meta.today, -60), store.meta.today);
  $('#addRemark', el).onclick = () => modal({
    title: `Add remark for ${s.full_name}`,
    body: html`<div class="col gap-16">${field('Category', html`<select class="input" name="category">${options(Object.entries(CAT).map(([k, v]) => [k, v[1]]), 'general')}</select>`)}
      ${field('Remark', html`<textarea class="input" name="remark" rows="4" maxlength="1000" required placeholder="Write a short, constructive note"></textarea>`, { req: true })}
      <label class="check"><input type="checkbox" name="visible_to_parent" checked> Visible to parent & student (they will be notified)</label></div>`,
    submitLabel: 'Save remark',
    onSubmit: async (form) => {
      await api(`/api/students/${id}/remarks`, { method: 'POST', body: { category: form.category.value, remark: form.remark.value, visible_to_parent: form.visible_to_parent.checked } });
      toast('Remark added', 'success'); render(el, { params });
    },
  });
  on(el, 'click', '[data-del-remark]', async (e, b) => {
    if (!(await confirmDialog('Delete this remark?', { okLabel: 'Delete' }))) return;
    await api(`/api/remarks/${b.dataset.delRemark}`, { method: 'DELETE' }); toast('Remark deleted', 'success'); render(el, { params });
  });
}
