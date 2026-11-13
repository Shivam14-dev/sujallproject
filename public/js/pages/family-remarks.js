import { html, mount, api, icon, emptyState, fmtDateTime } from '../lib.js';
import { store } from '../app.js';
import { childSwitcher, bindSwitcher, noChild } from './family-dashboard.js';

const CAT = { general: ['b-gray', 'General'], academic: ['b-blue', 'Academic'], behaviour: ['b-amber', 'Behaviour'], appreciation: ['b-green', 'Appreciation'] };
export default async function render(el) {
  if (!store.childId) return noChild(el);
  const { rows } = await api(`/api/students/${store.childId}/remarks`);
  mount(el, html`${childSwitcher()}
  <div class="page-head"><div><h1>Teacher remarks</h1><div class="sub">Notes shared by teachers about progress and behaviour.</div></div></div>
  <div class="card">${rows.length ? rows.map((r) => html`<div class="list-item" style="align-items:flex-start"><div class="ni tone-violet" style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none">${icon('message')}</div>
    <div class="grow"><div class="row wrap"><span class="badge ${CAT[r.category][0]}">${CAT[r.category][1]}</span><span class="xs muted">${r.author} · ${fmtDateTime(r.created_at)}</span></div><div class="mt-8">${r.remark}</div></div></div>`) : emptyState('No remarks yet.', 'message')}</div>`);
  bindSwitcher(el);
}
