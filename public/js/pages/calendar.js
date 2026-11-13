import { html, mount, api, icon, $, on, loading, modal, field, options, toast, confirmDialog, formValues, monthName, addDays, fmtDate } from '../lib.js';
import { store, navigate } from '../app.js';
import { divisionOptions, eventItem } from './_ui.js';

export default async function render(el) {
  const { me, meta } = store;
  const canEdit = me.role === 'admin' || me.role === 'teacher';
  let month = meta.today.slice(0, 7);
  mount(el, html`<div id="cal">${loading()}</div>`);
  const box = $('#cal', el);
  let data;
  async function load() {
    mount(box, loading());
    data = await api('/api/calendar', { query: { month } });
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const start = addDays(`${month}-01`, -first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const trimmed = days[35].slice(0, 7) !== month ? days.slice(0, 35) : days;
    const evOn = (d) => [
      ...data.holidays.filter((h) => h.date === d).map((h) => html`<span class="ev ev-holiday" title="${h.name}">${h.name}</span>`),
      ...data.events.filter((e) => e.start_date <= d && e.end_date >= d).map((e) => html`<span class="ev ev-${e.event_type}" data-ev="${e.id}" title="${e.title}${e.division_label ? ' (' + e.division_label + ')' : ''}">${e.title}</span>`),
      ...data.homework_deadlines.filter((h) => h.due_date === d).slice(0, 2).map((h) => html`<span class="ev ev-homework" data-hw="${h.id}" title="Homework due: ${h.title} (${h.division_label})">${h.subject_name}${me.role === 'admin' || me.role === 'teacher' ? ' ' + h.division_label : ''}</span>`),
      data.homework_deadlines.filter((h) => h.due_date === d).length > 2 ? html`<span class="xs muted">+${data.homework_deadlines.filter((h) => h.due_date === d).length - 2} more</span>` : '',
    ];
    const upcoming = [...data.events, ...data.holidays.map((h) => ({ ...h, start_date: h.date }))].sort((a, b) => a.start_date.localeCompare(b.start_date));
    mount(box, html`
      <div class="page-head"><div><h1>School calendar</h1><div class="sub">Holidays, examinations, parent meetings, events and homework deadlines.</div></div>
        ${canEdit ? html`<button class="btn primary" id="addEv">${icon('plus')} Add event</button>` : ''}</div>
      <div class="grid g-main">
        <div class="card"><div class="card-head"><button class="btn sm icon" id="prev" aria-label="Previous month">${icon('left')}</button><h2>${monthName(month)}</h2><div class="row"><button class="btn sm" id="today">Today</button><button class="btn sm icon" id="next" aria-label="Next month">${icon('right')}</button></div></div>
          <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => html`<div class="dow">${d}</div>`)}
          ${trimmed.map((d) => html`<div class="day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === meta.today ? 'today' : ''} ${new Date(d + 'T00:00:00Z').getUTCDay() === 0 ? 'sun' : ''}"><div class="num">${Number(d.slice(8))}</div>${d.slice(0, 7) === month ? evOn(d) : ''}</div>`)}</div>
          <div class="card-body legend"><span><i class="ev-holiday"></i>Holiday</span><span><i class="ev-exam"></i>Exam</span><span><i class="ev-test"></i>Test</span><span><i class="ev-meeting"></i>Meeting</span><span><i class="ev-event"></i>Event</span><span><i class="ev-homework"></i>Homework due</span></div></div>
        <div class="card"><div class="card-head"><h2>This month</h2></div>${upcoming.length ? upcoming.map((e) => html`<div data-ev="${e.event_type ? e.id : ''}" style="cursor:${e.event_type ? 'pointer' : 'default'}">${eventItem(e)}</div>`) : html`<div class="empty small">Nothing scheduled</div>`}</div>
      </div>`);
    $('#prev', box).onclick = () => { month = addDays(`${month}-01`, -1).slice(0, 7); load(); };
    $('#next', box).onclick = () => { month = addDays(`${month}-28`, 7).slice(0, 7); load(); };
    $('#today', box).onclick = () => { month = meta.today.slice(0, 7); load(); };
    if (canEdit) $('#addEv', box).onclick = () => eventForm();
  }
  const eventForm = (ev) => modal({
    title: ev ? 'Edit event' : 'Add event', size: 'lg',
    body: html`<div class="form-grid">
      ${field('Title', html`<input class="input" name="title" required maxlength="150" value="${ev?.title || ''}">`, { req: true, span: true })}
      ${field('Type', html`<select class="input" name="event_type">${options([['exam', 'Examination'], ['test', 'Class test'], ['meeting', 'Parent meeting'], ['event', 'Event'], ['other', 'Other']], ev?.event_type || 'event')}</select>`)}
      ${field('Class', html`<select class="input" name="division_id">${divisionOptions(ev?.division_id, { placeholder: me.role === 'admin' ? 'Whole school' : 'Select class' })}</select>`, { req: me.role === 'teacher' })}
      ${field('Start date', html`<input class="input" type="date" name="start_date" required value="${ev?.start_date || meta.today}">`, { req: true })}
      ${field('End date', html`<input class="input" type="date" name="end_date" value="${ev?.end_date || ''}">`)}
      ${field('Description', html`<textarea class="input" name="description" rows="3" maxlength="2000">${ev?.description || ''}</textarea>`, { span: true })}
      ${me.role === 'admin' ? html`<div class="span-2 xs muted">To add a school holiday, use Settings → Holidays.</div>` : ''}</div>`,
    onSubmit: async (f) => { await api(ev ? `/api/calendar-events/${ev.id}` : '/api/calendar-events', { method: ev ? 'PUT' : 'POST', body: formValues(f) }); toast('Event saved', 'success'); load(); },
  });
  on(el, 'click', '[data-hw]', (e, b) => navigate(`homework/${b.dataset.hw}`));
  on(el, 'click', '[data-ev]', (e, b) => {
    const ev = data.events.find((x) => x.id === Number(b.dataset.ev));
    if (!ev) return;
    const mine = me.role === 'admin' || ev.created_by === me.id;
    const m = modal({
      title: ev.title, size: 'sm',
      body: html`<div class="col gap-16"><div class="row wrap"><span class="badge ev-${ev.event_type}">${ev.event_type}</span>${ev.division_label ? html`<span class="chip">Class ${ev.division_label}</span>` : html`<span class="chip">Whole school</span>`}</div>
        <div class="bold">${fmtDate(ev.start_date, { weekday: true })}${ev.end_date !== ev.start_date ? ` – ${fmtDate(ev.end_date, { weekday: true })}` : ''}</div>${ev.description ? html`<div class="prose">${ev.description}</div>` : ''}
        ${canEdit && mine ? html`<div class="row"><button type="button" class="btn sm" id="evEdit">${icon('edit')} Edit</button><button type="button" class="btn sm danger" id="evDel">${icon('trash')} Delete</button></div>` : ''}</div>`,
    });
    $('#evEdit', m.el)?.addEventListener('click', () => { m.close(); eventForm(ev); });
    $('#evDel', m.el)?.addEventListener('click', async () => { m.close(); if (await confirmDialog('Delete this event?', { okLabel: 'Delete' })) { await api(`/api/calendar-events/${ev.id}`, { method: 'DELETE' }); toast('Event deleted', 'success'); load(); } });
  });
  await load();
}
