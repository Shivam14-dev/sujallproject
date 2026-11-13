import { html, mount, api, icon, $, $$, on, toast, fmtDate, addDays, modal, field, withBusy, fmtDateTime, emptyState, loading, statusLabel, badge } from '../lib.js';
import { store, setQuery } from '../app.js';
import { divisionOptions } from './_ui.js';

const OPTS = [['present', 'Present', 'P'], ['absent', 'Absent', 'A'], ['late', 'Late', 'L'], ['half_day', 'Half Day', 'H']];

export default async function render(el, { query }) {
  const { meta, me } = store;
  const markable = meta.divisions.filter((d) => me.role === 'admin' || d.is_class_teacher);
  let divisionId = Number(query.division_id) || markable[0]?.id || meta.divisions[0]?.id;
  let date = query.date && query.date <= meta.today ? query.date : meta.today;
  let sheet = null, state = new Map(), original = new Map(), search = '';

  if (!meta.divisions.length) { mount(el, html`<div class="card">${emptyState('You have no classes assigned yet. Please contact the school admin.', 'layers')}</div>`); return; }

  mount(el, html`
  <div class="page-head"><div><h1>Mark Attendance</h1><div class="sub">Select a class and date, mark each student, then save.</div></div>
    <button class="btn" id="historyBtn">${icon('history')} Edit history</button></div>
  <div class="card mb-16"><div class="card-body filters">
    ${field('Academic year', html`<select class="input" disabled><option>${meta.current_year?.name || '—'}</option></select>`)}
    ${field('Class & division', html`<select class="input" id="div">${divisionOptions(divisionId, { placeholder: undefined })}</select>`)}
    <label class="field"><span>Date</span><div class="row gap-4"><button class="btn icon" id="prev" aria-label="Previous day">${icon('left')}</button><input type="date" class="input" id="date" value="${date}" max="${meta.today}" min="${meta.current_year?.start_date || ''}"><button class="btn icon" id="next" aria-label="Next day">${icon('right')}</button></div></label>
    <button class="btn ghost" id="todayBtn" style="align-self:flex-end">Today</button>
  </div></div>
  <div id="sheet">${loading()}</div>`);

  const sheetEl = $('#sheet', el);
  const load = async () => {
    setQuery({ division_id: divisionId, date });
    mount(sheetEl, loading());
    try {
      sheet = await api('/api/attendance/sheet', { query: { division_id: divisionId, date } });
    } catch (e) { mount(sheetEl, html`<div class="banner danger">${icon('alert')}<span>${e.message}</span></div>`); return; }
    state = new Map(); original = new Map();
    for (const s of sheet.students) {
      const v = { status: s.status || null, remarks: s.remarks || '' };
      state.set(s.id, { ...v }); original.set(s.id, { ...v });
    }
    draw();
  };

  const counts = () => {
    const c = { present: 0, absent: 0, late: 0, half_day: 0, unmarked: 0 };
    for (const v of state.values()) c[v.status || 'unmarked']++;
    const marked = sheet.students.length - c.unmarked;
    c.pct = marked ? Math.round(((c.present + c.late + c.half_day * 0.5) / marked) * 1000) / 10 : 0;
    return c;
  };
  const dirty = () => [...state.entries()].filter(([id, v]) => { const o = original.get(id); return o.status !== v.status || (o.remarks || '') !== (v.remarks || ''); });
  const readOnly = () => !sheet.can_mark || sheet.is_future || (sheet.is_marked && !sheet.can_edit);

  function draw() {
    const ro = readOnly();
    const c = counts();
    const list = sheet.students.filter((s) => !search || s.full_name.toLowerCase().includes(search) || String(s.roll_no) === search);
    mount(sheetEl, html`
    ${sheet.holiday ? html`<div class="banner warn mb-16">${icon('calendar')}<span><b>${fmtDate(date)}</b> is a school holiday — ${sheet.holiday}.${me.role === 'admin' ? ' Admins can still record attendance if needed.' : ''}</span></div>` : ''}
    ${sheet.is_sunday && !sheet.holiday ? html`<div class="banner warn mb-16">${icon('calendar')}<span>${fmtDate(date, { weekday: true })} is a Sunday.</span></div>` : ''}
    ${!sheet.can_mark ? html`<div class="banner info mb-16">${icon('eye')}<span>View only — attendance for Class ${sheet.division.label} is marked by the class teacher (${sheet.division.class_teacher_name || 'not assigned'}).</span></div>` : ''}
    ${sheet.is_marked && sheet.can_mark && !sheet.can_edit ? html`<div class="banner warn mb-16">${icon('lock')}<span>${sheet.reason}</span></div>` : ''}
    ${sheet.is_marked && sheet.can_edit && sheet.can_mark ? html`<div class="banner success mb-16">${icon('checkCircle')}<span class="grow">Attendance already saved for this date (${sheet.marked_count}/${sheet.total_students} students${sheet.edit_count ? `, edited ${sheet.edit_count} time(s)` : ''}). Changes will be recorded in the edit history.</span></div>` : ''}

    <div class="att-summary mb-16">
      <div class="s"><div class="l">Total students</div><div class="v">${sheet.total_students}</div></div>
      <div class="s"><div class="l" style="color:var(--green)">Present</div><div class="v">${c.present}</div></div>
      <div class="s"><div class="l" style="color:var(--red)">Absent</div><div class="v">${c.absent}</div></div>
      <div class="s"><div class="l" style="color:var(--amber)">Late / Half day</div><div class="v">${c.late} / ${c.half_day}</div></div>
      <div class="s"><div class="l" style="color:var(--primary)">Attendance</div><div class="v">${c.unmarked === sheet.total_students ? '—' : c.pct + '%'}</div></div>
    </div>

    <div class="card">
      <div class="att-toolbar">
        <div class="row wrap"><h2>Class ${sheet.division.label}</h2><span class="muted small">${fmtDate(date, { weekday: true })}</span>${c.unmarked && !ro ? html`<span class="badge b-gray">${c.unmarked} not marked</span>` : ''}</div>
        <div class="row wrap">
          <div class="search"><span>${icon('search')}</span><input class="input sm" id="q" placeholder="Search name or roll no" value="${search}" style="width:200px"></div>
          ${ro ? '' : html`<button class="btn sm primary" id="allPresent">${icon('checkCircle')} Mark all present</button>`}
        </div>
      </div>
      ${sheet.students.length ? '' : emptyState('No active students in this class yet.', 'cap')}
      <div id="rows">${list.map((s) => row(s, state.get(s.id), ro))}</div>
      ${ro ? '' : html`<div class="sticky-save"><span class="small muted" id="dirtyInfo">${info(c)}</span><div class="row"><button class="btn" id="reset">Reset</button><button class="btn primary" id="save">${icon('check')} ${sheet.is_marked ? 'Save changes' : 'Save attendance'}</button></div></div>`}
    </div>`);
    bind();
  }
  const info = (c) => {
    const d = dirty().length;
    if (c.unmarked) return `${c.unmarked} student(s) not marked yet`;
    return d ? `${d} change(s) not saved` : (sheet.is_marked ? 'All changes saved' : 'Ready to save');
  };
  function row(s, v, ro) {
    return html`<div class="att-row" data-id="${s.id}">
      <div class="roll">${s.roll_no ?? '–'}</div>
      <div class="grow" style="min-width:0"><div class="bold truncate">${s.full_name}</div><div class="xs muted">${s.admission_no}${s.marked_by_name && s.status ? ` · by ${s.marked_by_name}` : ''}</div></div>
      <div class="att-opts" role="radiogroup" aria-label="Attendance for ${s.full_name}">${OPTS.map(([k, label, short]) => html`<button type="button" class="att-opt ${k} ${v.status === k ? 'on' : ''}" data-status="${k}" role="radio" aria-checked="${v.status === k}" ${ro ? 'disabled' : ''} title="${label}"><span class="full">${label}</span><span class="short">${short}</span></button>`)}</div>
      <input class="input sm rem" data-rem placeholder="${v.status && v.status !== 'present' ? 'Reason / remark (optional)' : 'Remark'}" value="${v.remarks}" maxlength="300" ${ro ? 'disabled' : ''} style="${v.status && v.status !== 'present' ? '' : 'opacity:.6'}">
    </div>`;
  }
  function refreshCounts() {
    const c = counts();
    const vals = $$('.att-summary .v', sheetEl);
    vals[1].textContent = c.present; vals[2].textContent = c.absent; vals[3].textContent = `${c.late} / ${c.half_day}`;
    vals[4].textContent = c.unmarked === sheet.total_students ? '—' : `${c.pct}%`;
    const di = $('#dirtyInfo', sheetEl); if (di) di.textContent = info(c);
  }
  function bind() {
    const q = $('#q', sheetEl);
    q?.addEventListener('input', () => { search = q.value.trim().toLowerCase(); const pos = q.selectionStart; draw(); const nq = $('#q', sheetEl); nq.focus(); nq.setSelectionRange(pos, pos); });
    $('#allPresent', sheetEl)?.addEventListener('click', () => {
      for (const s of sheet.students) { const v = state.get(s.id); if (v.status !== 'present') { v.status = 'present'; } }
      draw(); toast('All students marked present — now change only the absentees', 'success');
    });
    $('#reset', sheetEl)?.addEventListener('click', () => { for (const [id, o] of original) state.set(id, { ...o }); draw(); });
    $('#save', sheetEl)?.addEventListener('click', (e) => save(e.currentTarget));
  }
  on(sheetEl, 'click', '.att-opt', (e, b) => {
    if (b.disabled) return;
    const r = b.closest('.att-row'); const id = Number(r.dataset.id);
    const v = state.get(id); v.status = b.dataset.status;
    $$('.att-opt', r).forEach((x) => { const onState = x === b; x.classList.toggle('on', onState); x.setAttribute('aria-checked', onState); });
    const rem = $('[data-rem]', r); rem.style.opacity = v.status === 'present' ? '.6' : '1'; rem.placeholder = v.status !== 'present' ? 'Reason / remark (optional)' : 'Remark';
    refreshCounts();
  });
  on(sheetEl, 'input', '[data-rem]', (e, inp) => { state.get(Number(inp.closest('.att-row').dataset.id)).remarks = inp.value; refreshCounts(); });

  async function save(btn) {
    const c = counts();
    if (c.unmarked) { toast(`Please mark all students — ${c.unmarked} not marked yet`, 'error'); const firstId = [...state.entries()].find(([, v]) => !v.status)?.[0]; $(`.att-row[data-id="${firstId}"]`, sheetEl)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const changes = dirty();
    if (sheet.is_marked && !changes.length) { toast('No changes to save'); return; }
    const records = sheet.students.map((s) => ({ student_id: s.id, status: state.get(s.id).status, remarks: state.get(s.id).remarks || null }));
    const doSave = async (reason) => {
      const r = await api('/api/attendance/save', { method: 'POST', body: { division_id: divisionId, date, records, reason } });
      toast(r.is_edit ? `Attendance updated (${r.updated} change${r.updated === 1 ? '' : 's'})` : `Attendance saved — ${r.summary.present + r.summary.late} present, ${r.summary.absent} absent`, 'success');
      if (r.summary.absent && !r.is_edit) toast('Parents of absent students have been notified');
      await load();
    };
    if (sheet.is_marked) {
      modal({
        title: 'Reason for editing attendance', size: 'sm',
        body: html`<p class="small text-2 mb-12">You are changing ${changes.length} saved record(s) for ${fmtDate(date)}. This edit is logged with your name.</p>
          ${field('Reason', html`<input class="input" name="reason" required maxlength="300" placeholder="e.g. Student arrived late, parent called">`, { req: true })}`,
        submitLabel: 'Save changes',
        onSubmit: async (form) => {
          const reason = form.reason.value.trim();
          if (!reason) { const err = new Error('Please enter a reason'); err.details = { reason: 'Please enter a reason' }; throw err; }
          await doSave(reason);
        },
      });
    } else {
      await withBusy(btn, async () => { try { await doSave(); } catch (e) { toast(e.message, 'error'); } });
    }
  }

  $('#div', el).onchange = (e) => { divisionId = Number(e.target.value); search = ''; load(); };
  const setDate = (d) => { if (d > meta.today) return; date = d; $('#date', el).value = d; load(); };
  $('#date', el).onchange = (e) => e.target.value && setDate(e.target.value);
  $('#prev', el).onclick = () => setDate(addDays(date, -1));
  $('#next', el).onclick = () => setDate(addDays(date, 1));
  $('#todayBtn', el).onclick = () => setDate(meta.today);
  $('#historyBtn', el).onclick = async () => {
    const m = modal({ title: `Edit history — Class ${sheet?.division?.label || ''}, ${fmtDate(date)}`, size: 'lg', body: loading(), footer: true });
    try {
      const r = await api('/api/attendance/audit', { query: { division_id: divisionId, date } });
      $('.modal-body', m.el).innerHTML = String(r.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Student</th><th>Change</th><th>Reason</th><th>By</th></tr></thead><tbody>
        ${r.rows.map((l) => html`<tr><td class="nowrap small">${fmtDateTime(l.changed_at)}</td><td>${l.roll_no}. ${l.student_name}</td>
          <td class="nowrap">${l.old_status ? html`${badge(l.old_status)} → ` : html`<span class="muted small">new</span> `}${badge(l.new_status)}</td><td class="small">${l.reason || '—'}</td><td class="small">${l.changed_by_name || '—'}</td></tr>`)}
        </tbody></table></div>` : emptyState('No attendance recorded for this date yet.', 'history'));
    } catch (e) { $('.modal-body', m.el).textContent = e.message; }
  };
  await load();
}
