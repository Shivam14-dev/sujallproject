import { html, mount, api, icon, $, $$, on, loading, emptyState, modal, field, toast, confirmDialog, formValues, fmtDate, fmtDateTime, withBusy, badge } from '../lib.js';
import { store } from '../app.js';

export default async function render(el, { query }) {
  let tab = query.tab || 'school';
  mount(el, html`
  <div class="page-head"><div><h1>Settings</h1><div class="sub">School profile, academic years, holidays, notifications and audit logs.</div></div></div>
  <div class="card"><div class="tabs" id="tabs">${[['school', 'School profile'], ['years', 'Academic years'], ['holidays', 'Holidays'], ['notify', 'Notifications'], ['audit', 'Audit log']].map(([k, l]) => html`<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`)}</div><div id="pane" class="card-body">${loading()}</div></div>`);
  const pane = $('#pane', el);
  const show = async () => { mount(pane, loading()); await TABS[tab](pane); };
  $$('#tabs button', el).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; $$('#tabs button', el).forEach((x) => x.classList.toggle('on', x === b)); show(); }));
  await show();
}

const TABS = {
  async school(pane) {
    const s = await api('/api/admin/school');
    mount(pane, html`<form id="f" class="form-grid" style="max-width:760px" novalidate>
      ${field('School name', html`<input class="input" name="name" value="${s.name}" required maxlength="150">`, { req: true, span: true })}
      ${field('Phone', html`<input class="input" name="phone" value="${s.phone || ''}">`)}${field('Email', html`<input class="input" name="email" type="email" value="${s.email || ''}">`)}
      ${field('Website', html`<input class="input" name="website" value="${s.website || ''}">`, { span: true })}
      ${field('Address', html`<textarea class="input" name="address" rows="2">${s.address || ''}</textarea>`, { span: true })}
      <div><button class="btn primary" type="submit">${icon('check')} Save profile</button></div></form>`);
    $('#f', pane).onsubmit = async (e) => { e.preventDefault(); await withBusy(e.submitter, async () => { try { await api('/api/admin/school', { method: 'PUT', body: formValues(e.target) }); toast('School profile saved', 'success'); store.meta.school.name = e.target.name.value; } catch (err) { toast(err.message, 'error'); } }); };
  },
  async years(pane) {
    const { rows } = await api('/api/admin/academic-years');
    mount(pane, html`<div class="row between mb-16"><span class="small muted">The current year controls which classes and attendance are active.</span><button class="btn sm primary" id="addY">${icon('plus')} Add academic year</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Year</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((y) => html`<tr><td class="bold">${y.name}</td><td>${fmtDate(y.start_date)}</td><td>${fmtDate(y.end_date)}</td><td>${y.is_current ? html`<span class="badge b-green">Current</span>` : ''}</td>
        <td class="right">${y.is_current ? '' : html`<button class="btn xs" data-cur="${y.id}">Set as current</button>`}</td></tr>`)}</tbody></table></div>`);
    $('#addY', pane).onclick = () => modal({
      title: 'Add academic year', size: 'sm',
      body: html`<div class="col gap-16">${field('Name', html`<input class="input" name="name" placeholder="2027-28" required>`, { req: true })}${field('Start date', html`<input class="input" type="date" name="start_date" required>`, { req: true })}${field('End date', html`<input class="input" type="date" name="end_date" required>`, { req: true })}</div>`,
      onSubmit: async (form) => { await api('/api/admin/academic-years', { method: 'POST', body: formValues(form) }); toast('Academic year added', 'success'); TABS.years(pane); },
    });
    on(pane, 'click', '[data-cur]', async (e, b) => {
      if (!(await confirmDialog('Switch the current academic year? Classes and attendance will use the new year.', { okLabel: 'Switch', danger: false }))) return;
      await api(`/api/admin/academic-years/${b.dataset.cur}/set-current`, { method: 'POST' }); toast('Current year updated', 'success'); location.reload();
    });
  },
  async holidays(pane) {
    const { rows } = await api('/api/holidays');
    mount(pane, html`<form id="hf" class="row wrap mb-16" novalidate><input class="input" name="name" placeholder="Holiday name" required style="max-width:260px"><input class="input" type="date" name="date" required style="max-width:180px"><button class="btn primary" type="submit">${icon('plus')} Add holiday</button></form>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Holiday</th><th></th></tr></thead><tbody>${rows.map((h) => html`<tr><td class="nowrap">${fmtDate(h.date, { weekday: true })}</td><td>${h.name}</td><td class="right"><button class="btn xs danger" data-del="${h.id}">${icon('trash')}</button></td></tr>`)}</tbody></table></div>` : emptyState('No holidays added.', 'calendar')}`);
    $('#hf', pane).onsubmit = async (e) => { e.preventDefault(); try { await api('/api/holidays', { method: 'POST', body: formValues(e.target) }); toast('Holiday added', 'success'); TABS.holidays(pane); } catch (err) { toast(err.message, 'error'); } };
    on(pane, 'click', '[data-del]', async (e, b) => { await api(`/api/holidays/${b.dataset.del}`, { method: 'DELETE' }); toast('Holiday removed', 'success'); TABS.holidays(pane); });
  },
  async notify(pane) {
    const [s, ob] = await Promise.all([api('/api/admin/school'), api('/api/admin/outbox')]);
    const st = s.settings;
    mount(pane, html`<form id="nf" class="col gap-16" style="max-width:720px" novalidate>
      <h3>In-app notifications</h3>
      <label class="check"><input type="checkbox" name="notify_absent" ${st.notify_absent ? 'checked' : ''}> Notify parents when a student is marked absent, late or half day</label>
      <label class="check"><input type="checkbox" name="notify_homework" ${st.notify_homework ? 'checked' : ''}> Notify students and parents when new homework is assigned</label>
      <h3 class="mt-8">External channels (integration-ready)</h3>
      <div class="banner info">${icon('settings')}<span class="small">WhatsApp, SMS and Email are sent through providers configured with environment variables (<code>WHATSAPP_PROVIDER</code>, <code>WHATSAPP_TOKEN</code>, <code>EMAIL_PROVIDER</code>…). API credentials are never stored in the database or code. Messages are queued in an outbox and retried automatically.</span></div>
      <label class="check"><input type="checkbox" name="whatsapp_enabled" ${st.whatsapp_enabled ? 'checked' : ''}> Send absence alerts on WhatsApp</label>
      <label class="check"><input type="checkbox" name="sms_enabled" ${st.sms_enabled ? 'checked' : ''}> Send absence alerts by SMS</label>
      <label class="check"><input type="checkbox" name="email_enabled" ${st.email_enabled ? 'checked' : ''}> Send absence alerts by email</label>
      <h3 class="mt-8">Attendance rules</h3>
      <div class="form-grid">${field('Teachers can edit attendance for the last … days', html`<input class="input" type="number" name="teacher_edit_window_days" min="0" max="60" value="${st.teacher_edit_window_days}">`, { hint: 'Older records can be edited only by admins' })}
        ${field('Low attendance threshold (%)', html`<input class="input" type="number" name="low_attendance_threshold" min="1" max="100" value="${st.low_attendance_threshold}">`)}</div>
      <div><button class="btn primary" type="submit">${icon('check')} Save settings</button></div></form>
      <h3 class="mt-24 mb-12">Outbox (last 100 messages)</h3>
      ${ob.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Channel</th><th>To</th><th>Message</th><th>Status</th><th>Created</th></tr></thead><tbody>${ob.rows.map((o) => html`<tr><td>${o.channel}</td><td class="small">${o.recipient}</td><td class="small truncate" style="max-width:320px">${o.message}</td><td>${badge(o.status === 'sent' ? 'present' : o.status === 'failed' ? 'absent' : 'pending', o.status)}${o.last_error ? html`<div class="xs muted">${o.last_error}</div>` : ''}</td><td class="small nowrap">${fmtDateTime(o.created_at)}</td></tr>`)}</tbody></table></div>` : emptyState('No external messages queued yet.', 'send')}`);
    $('#nf', pane).onsubmit = async (e) => {
      e.preventDefault();
      await withBusy(e.submitter, async () => { try { await api('/api/admin/settings', { method: 'PUT', body: formValues(e.target) }); toast('Settings saved', 'success'); } catch (err) { toast(err.message, 'error'); } });
    };
  },
  async audit(pane) {
    let entity = '';
    const draw = async () => {
      const { rows } = await api('/api/admin/audit-logs', { query: { entity, limit: 100 } });
      mount(pane, html`<div class="row mb-16"><select class="input sm" id="ent" style="width:auto">${['', 'attendance', 'homework', 'student', 'teacher', 'parent', 'announcement', 'user', 'report', 'settings'].map((x) => html`<option value="${x}" ${x === entity ? 'selected' : ''}>${x || 'All activity'}</option>`)}</select><span class="small muted">Latest 100 entries</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th class="hide-m">Details</th><th class="hide-m">IP</th></tr></thead><tbody>
        ${rows.map((a) => html`<tr><td class="nowrap small">${fmtDateTime(a.created_at)}</td><td class="small">${a.user_name || a.username || '—'}</td><td><span class="badge b-gray">${a.action}</span></td><td class="small">${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}</td><td class="hide-m xs muted truncate" style="max-width:300px">${a.details || ''}</td><td class="hide-m xs muted">${a.ip || ''}</td></tr>`)}
        </tbody></table></div>`);
      $('#ent', pane).onchange = (e) => { entity = e.target.value; draw(); };
    };
    await draw();
  },
};
