import { html, mount, api, emptyState, timeAgo, on, fmtDateTime } from '../lib.js';
import { setBell, notifIcon } from '../app.js';

export default async function render(el) {
  const r = await api('/api/notifications', { query: { limit: 100 } });
  setBell(r.unread);
  mount(el, html`
  <div class="page-head"><div><h1>Notifications</h1><div class="sub">${r.unread} unread</div></div>${r.unread ? html`<button class="btn" id="all">Mark all as read</button>` : ''}</div>
  <div class="card">${r.rows.length ? r.rows.map((n) => html`<div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">${notifIcon(n.type)}<div class="grow"><div class="bold">${n.title}</div>${n.body ? html`<div class="small text-2">${n.body}</div>` : ''}<div class="xs muted mt-8" title="${fmtDateTime(n.created_at)}">${timeAgo(n.created_at)}</div></div></div>`) : emptyState("You're all caught up.", 'bell')}</div>`);
  el.querySelector('#all')?.addEventListener('click', async () => { await api('/api/notifications/read-all', { method: 'POST' }); render(el); });
  on(el, 'click', '.notif-item', async (e, n) => {
    await api(`/api/notifications/${n.dataset.id}/read`, { method: 'POST' });
    if (n.dataset.link) location.hash = n.dataset.link; else render(el);
  });
}
