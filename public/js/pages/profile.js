import { html, mount, api, icon, $, field, formValues, toast, withBusy, initials, showErrors, clearErrors } from '../lib.js';
import { store } from '../app.js';

export default async function render(el) {
  const me = store.me;
  mount(el, html`
  <div class="page-head"><div><h1>My profile</h1></div></div>
  <div class="grid g-2">
    <div class="card"><div class="profile-hero"><div class="avatar lg">${initials(me.full_name)}</div><div><h2>${me.full_name}</h2><div class="muted small">${me.role[0].toUpperCase() + me.role.slice(1)}</div></div></div>
      <div class="card-body"><dl class="kv"><dt>User ID</dt><dd><code>${me.username}</code></dd><dt>Email</dt><dd>${me.email || '—'}</dd><dt>Phone</dt><dd>${me.phone || '—'}</dd>
      ${me.class_teacher_of?.length ? html`<dt>Class teacher of</dt><dd>${me.class_teacher_of.map((c) => c.label).join(', ')}</dd>` : ''}
      ${store.children?.length ? html`<dt>Children</dt><dd>${store.children.map((c) => `${c.full_name} (${c.division_label})`).join(', ')}</dd>` : ''}</dl>
      <p class="xs muted mt-16">To update your name, phone or email, please contact the school office.</p></div></div>
    <div class="card"><div class="card-head"><h2>${icon('lock')} Change password</h2></div>
      <form class="card-body col gap-16" id="pw" novalidate>
        ${field('Current password', html`<input class="input" type="password" name="current_password" autocomplete="current-password" required>`, { req: true })}
        ${field('New password', html`<input class="input" type="password" name="new_password" autocomplete="new-password" required minlength="8">`, { req: true, hint: 'At least 8 characters, including letters and numbers' })}
        ${field('Confirm new password', html`<input class="input" type="password" name="confirm" autocomplete="new-password" required>`, { req: true })}
        <div><button class="btn primary" type="submit">Update password</button></div>
      </form></div>
  </div>`);
  $('#pw', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; clearErrors(f);
    const v = formValues(f);
    if (v.new_password !== v.confirm) { showErrors(f, { message: 'Passwords do not match', details: { confirm: 'Passwords do not match' } }); return; }
    await withBusy(e.submitter, async () => {
      try { await api('/api/auth/change-password', { method: 'POST', body: v }); toast('Password updated. Other devices have been signed out.', 'success'); f.reset(); }
      catch (err) { showErrors(f, err); }
    });
  };
}
