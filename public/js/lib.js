// Core UI helpers: safe HTML templating, API client, icons, toasts, modals, formatting.

// ---------- safe templating ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function toHtml(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
/** Tagged template: interpolated values are HTML-escaped unless wrapped in raw() or produced by html``. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += toHtml(vals[i]); });
  return new Raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function mount(el, content) { el.innerHTML = String(content); return el; }
export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); });
}

// ---------- API ----------
export class ApiError extends Error { constructor(msg, status, details) { super(msg); this.status = status; this.details = details; } }
export async function api(path, { method = 'GET', body, form, query } = {}) {
  let url = path;
  if (query) {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...q].length) url += (url.includes('?') ? '&' : '?') + q;
  }
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError('Cannot reach the server. Check your connection.', 0); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !path.includes('/auth/')) { window.dispatchEvent(new CustomEvent('unauthorized')); }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  return data;
}
export const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ---------- icons (Lucide-style outlines) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  attendance: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>',
  school: '<path d="M4 22h16"/><path d="M6 22V9l6-5 6 5v13"/><path d="M10 22v-5h4v5"/><path d="M10 11h4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.file}</svg>`);

// ---------- formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(iso, { weekday = false, year = true } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${weekday ? DAYS[dt.getUTCDay()] + ', ' : ''}${d} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`;
}
export const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; };
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
export function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d.toISOString());
}
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const fileSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const pct = (n) => `${Number(n || 0).toFixed(n % 1 ? 1 : 0)}%`;
const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day', pending: 'Pending', submitted: 'Submitted', reviewed: 'Reviewed', overdue: 'Overdue', assigned: 'Assigned', active: 'Active', inactive: 'Inactive', transferred: 'Transferred', alumni: 'Alumni', closed: 'Closed', unmarked: 'Not marked' };
export const statusLabel = (s) => STATUS_LABEL[s] || s;
export const badge = (status, text) => html`<span class="badge dot b-${status}">${text || statusLabel(status)}</span>`;
const SUBJ_TONES = ['tone-blue', 'tone-green', 'tone-violet', 'tone-amber', 'tone-sky', 'tone-red'];
export const subjectTone = (name) => SUBJ_TONES[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % SUBJ_TONES.length];

// ---------- toast ----------
export function toast(msg, type = 'info') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = String(html`${icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'bell')}<span>${msg}</span>`);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'error' ? 5000 : 3000);
}

// ---------- modal ----------
export function modal({ title, body, size = '', submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, danger = false, footer = true }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = String(html`<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
    <form novalidate>
      <div class="modal-head"><h2>${title}</h2><button type="button" class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-foot"><button type="button" class="btn" data-close>${cancelLabel}</button>${onSubmit ? html`<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submitLabel}</button>` : ''}</div>` : ''}
    </form></div>`);
  document.body.appendChild(back);
  const form = $('form', back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    clearErrors(form);
    const btn = $('button[type=submit]', form);
    await withBusy(btn, async () => {
      try { const r = await onSubmit(form, close); if (r !== false) close(); }
      catch (err) { showErrors(form, err); }
    });
  });
  setTimeout(() => $('input:not([type=hidden]):not([type=checkbox]), select, textarea', back)?.focus(), 30);
  return { el: back, form, close };
}
export function confirmDialog(message, { title = 'Please confirm', okLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({ title, size: 'sm', body: html`<p class="text-2">${message}</p>`, submitLabel: okLabel, danger, onSubmit: () => { ok = true; } });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); resolve(ok); } });
    obs.observe(document.body, { childList: true });
  });
}
export async function withBusy(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + prev;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = prev; }
}

// ---------- forms ----------
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'file') continue;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}
export function clearErrors(form) { $$('.field-err', form).forEach((e) => e.remove()); $$('.invalid', form).forEach((e) => e.classList.remove('invalid')); $('.form-error', form)?.remove(); }
export function showErrors(form, err) {
  const details = err.details || {};
  let placed = false;
  for (const [k, msg] of Object.entries(details)) {
    const el = form.elements[k];
    if (el && el.classList) { el.classList.add('invalid'); el.insertAdjacentHTML('afterend', String(html`<span class="field-err">${msg}</span>`)); placed = true; }
  }
  if (!placed) {
    const body = $('.modal-body', form) || form;
    body.insertAdjacentHTML('afterbegin', String(html`<div class="banner danger form-error mb-12">${icon('alert')}<span>${err.message}</span></div>`));
  }
  if (!err.status) console.error(err);
}
export const field = (label, input, { req = false, span = false, hint } = {}) =>
  html`<label class="field ${span ? 'span-2' : ''}"><span>${label}${req ? html` <span class="req">*</span>` : ''}</span>${input}${hint ? html`<span class="xs muted">${hint}</span>` : ''}</label>`;
export const options = (items, selected, { placeholder } = {}) => html`${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}${items.map((o) => {
  const [v, l] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.name];
  return html`<option value="${v}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${l}</option>`;
})}`;

export const loading = () => html`<div class="loading"><div class="spinner"></div></div>`;
export const emptyState = (msg, ic = 'inbox') => html`<div class="empty">${icon(ic)}<div>${msg}</div></div>`;
export function errorState(el, err, retry) {
  mount(el, html`<div class="card card-pad"><div class="banner danger">${icon('alert')}<span class="grow">${err.message}</span>${retry ? html`<button class="btn sm" data-retry>Try again</button>` : ''}</div></div>`);
  if (retry) $('[data-retry]', el)?.addEventListener('click', retry);
}
export function download(url) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
