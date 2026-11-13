// Shared page widgets.
import { html, icon, fmtDate, timeAgo, options, badge } from '../lib.js';
import { store } from '../app.js';

export const stat = (label, value, ic, tone, foot) => html`<div class="card stat"><div class="ic ${tone}">${icon(ic)}</div><div class="grow"><div class="lbl">${label}</div><div class="val">${value}</div>${foot ? html`<div class="foot">${foot}</div>` : ''}</div></div>`;

export const divisionOptions = (selected, { placeholder = 'Select class', filter } = {}) => {
  let divs = store.meta.divisions;
  if (filter) divs = divs.filter(filter);
  return options(divs.map((d) => [d.id, `Class ${d.label}${d.is_class_teacher ? ' (Class teacher)' : ''}`]), selected, { placeholder });
};
export const subjectOptions = (selected, divisionId, { placeholder = 'Select subject' } = {}) => {
  let subs = store.meta.subjects;
  if (store.me.role === 'teacher' && divisionId) {
    const div = store.meta.divisions.find((d) => d.id === Number(divisionId));
    if (!div?.is_class_teacher) {
      const mine = new Set(store.meta.my_subjects.filter((s) => s.division_id === Number(divisionId)).map((s) => s.subject_id));
      subs = subs.filter((s) => mine.has(s.id));
    }
  }
  return options(subs.map((s) => [s.id, s.name]), selected, { placeholder });
};

export const announcementItem = (a) => html`<div class="list-item top" style="align-items:flex-start">
  <div class="ni ${a.is_important ? 'tone-red' : 'tone-sky'}" style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none">${icon(a.is_important ? 'alert' : 'megaphone')}</div>
  <div class="grow"><div class="row wrap gap-4"><span class="bold">${a.title}</span>${a.is_important ? html`<span class="badge b-red">Important</span>` : ''}${a.division_label ? html`<span class="chip">Class ${a.division_label}</span>` : ''}</div>
  <div class="small text-2 mt-8" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${a.body}</div>
  <div class="xs muted mt-8">${a.author || 'School'} · ${timeAgo(a.published_at)}</div></div></div>`;

const EV_IC = { exam: 'file', test: 'edit', meeting: 'users', event: 'star', other: 'calendar', holiday: 'calendar' };
export const eventItem = (e) => html`<div class="list-item"><div class="ev-${e.event_type || 'holiday'}" style="width:46px;border-radius:10px;padding:6px 0;text-align:center;flex:none">
  <div class="xs bold">${fmtDate(e.start_date || e.date, { year: false }).split(' ')[1]}</div><div style="font-size:17px;font-weight:800;line-height:1">${(e.start_date || e.date).slice(8)}</div></div>
  <div class="grow"><div class="bold small">${e.title || e.name}</div><div class="xs muted">${e.event_type ? e.event_type[0].toUpperCase() + e.event_type.slice(1) : 'Holiday'}${e.end_date && e.end_date !== e.start_date ? ` · till ${fmtDate(e.end_date, { year: false })}` : ''}${e.description ? ' · ' + e.description : ''}</div></div>${icon(EV_IC[e.event_type || 'holiday'], 'muted')}</div>`;

export const hwStatus = (s) => badge(s);
export const cardHead = (title, action) => html`<div class="card-head"><h2>${title}</h2>${action || ''}</div>`;
