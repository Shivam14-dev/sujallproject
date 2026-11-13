// Auth, session, meta, notifications, announcements, calendar & holidays.
import { api, bad, notFound, forbidden, HttpError } from '../http.js';
import { all, get, run } from '../db.js';
import {
  authenticate, createSession, destroySession, cookieHeader, requireAuth, requireRole, hashPassword, verifyPassword,
  checkThrottle, recordFailure, clearFailures, sha, teacherDivisionIds, parentStudentIds, assertDivision,
} from '../auth.js';
import { validate, passwordPolicy, audit, currentYear, monthRange, isMonth, today, schoolSettings, page } from '../util.js';
import { notifyAnnouncement } from '../notify.js';

// ---------- auth ----------
api.post('/api/auth/login', (ctx) => {
  const { username, password } = validate(ctx.body, {
    username: { type: 'string', required: true, max: 80, label: 'User ID' },
    password: { type: 'string', required: true, max: 128 },
  });
  const key = `${username.toLowerCase()}|${ctx.ip}`;
  checkThrottle(key);
  const u = authenticate(username, password);
  if (!u) { recordFailure(key); audit({ ip: ctx.ip }, 'login_failed', 'user', null, { username }); throw new HttpError(401, 'Invalid user ID or password'); }
  clearFailures(key);
  const { token, expires } = createSession(u.id, ctx.req);
  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, u.id);
  audit({ user: u, ip: ctx.ip }, 'login', 'user', u.id);
  ctx.res.setHeader('Set-Cookie', cookieHeader(token, expires));
  return { user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, must_change_password: !!u.must_change_password } };
});

api.post('/api/auth/logout', (ctx) => {
  if (ctx.user) destroySession(ctx.user.token);
  ctx.res.setHeader('Set-Cookie', cookieHeader('', 0));
  return { ok: true };
});

api.get('/api/auth/me', requireAuth, (ctx) => {
  const u = ctx.user;
  const out = { id: u.id, username: u.username, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, must_change_password: !!u.must_change_password };
  if (u.role === 'teacher') {
    out.teacher_id = u.teacher_id;
    out.class_teacher_of = all(`SELECT d.id, c.name || '-' || d.name AS label FROM divisions d JOIN classes c ON c.id = d.class_id
                                WHERE d.class_teacher_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL`, u.teacher_id);
  }
  if (u.role === 'parent') out.parent_id = u.parent_id;
  if (u.role === 'student') out.student_id = u.student_id;
  return out;
});

api.post('/api/auth/change-password', requireAuth, (ctx) => {
  const { current_password, new_password } = validate(ctx.body, {
    current_password: { type: 'string', required: true, max: 128, label: 'Current password' },
    new_password: { type: 'string', required: true, max: 128, label: 'New password' },
  });
  passwordPolicy(new_password);
  const u = get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
  if (!verifyPassword(current_password, u.password_hash)) throw bad('Current password is incorrect');
  run(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`, hashPassword(new_password), ctx.user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', ctx.user.id, sha(ctx.user.token));
  audit(ctx, 'change_password', 'user', ctx.user.id);
  return { ok: true };
});

// ---------- meta ----------
export function divisionsFor(user) {
  const year = currentYear(user.school_id);
  let rows = all(`SELECT d.id, d.name, d.class_id, c.name AS class_name, c.sort_order, d.class_teacher_id, t.full_name AS class_teacher_name,
                    (SELECT COUNT(*) FROM students s WHERE s.division_id = d.id AND s.status='active' AND s.deleted_at IS NULL) AS student_count
                  FROM divisions d JOIN classes c ON c.id = d.class_id LEFT JOIN teachers t ON t.id = d.class_teacher_id
                  WHERE c.school_id = ? AND c.academic_year_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL
                  ORDER BY c.sort_order, c.name, d.name`, user.school_id, year?.id ?? 0);
  if (user.role === 'teacher') {
    const ids = teacherDivisionIds(user.teacher_id);
    rows = rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r, is_class_teacher: r.class_teacher_id === user.teacher_id }));
  } else if (user.role !== 'admin') rows = [];
  return rows.map((r) => ({ ...r, label: `${r.class_name}-${r.name}` }));
}

api.get('/api/meta', requireAuth, (ctx) => {
  const u = ctx.user;
  const school = get('SELECT id, name, address, phone, email, website FROM schools WHERE id = ?', u.school_id);
  const years = all('SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC', u.school_id);
  const subjects = all('SELECT id, name, code FROM subjects WHERE school_id = ? AND deleted_at IS NULL ORDER BY name', u.school_id);
  let mySubjects = [];
  if (u.role === 'teacher') {
    mySubjects = all(`SELECT ta.division_id, ta.subject_id, s.name AS subject_name FROM teacher_assignments ta JOIN subjects s ON s.id = ta.subject_id WHERE ta.teacher_id = ?`, u.teacher_id);
  }
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', u.id).n;
  return { school, years, current_year: currentYear(u.school_id), subjects, divisions: divisionsFor(u), my_subjects: mySubjects, unread, today: today(), settings: u.role === 'admin' ? schoolSettings(u.school_id) : undefined };
});

// ---------- notifications ----------
api.get('/api/notifications', requireAuth, (ctx) => {
  const { limit, offset } = page(ctx.query);
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', ctx.user.id, limit, offset);
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', ctx.user.id).n;
  return { rows, unread };
});
api.post('/api/notifications/read-all', requireAuth, (ctx) => { run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', ctx.user.id); return { ok: true }; });
api.post('/api/notifications/:id/read', requireAuth, (ctx) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', +ctx.params.id, ctx.user.id);
  return { ok: true };
});

// ---------- announcements ----------
function visibleAnnouncements(u, limit = 50) {
  const base = `SELECT a.*, us.full_name AS author, c.name || '-' || d.name AS division_label
                FROM announcements a LEFT JOIN users us ON us.id = a.published_by
                LEFT JOIN divisions d ON d.id = a.division_id LEFT JOIN classes c ON c.id = d.class_id
                WHERE a.school_id = ? AND a.deleted_at IS NULL`;
  if (u.role === 'admin') return all(`${base} ORDER BY a.published_at DESC LIMIT ?`, u.school_id, limit);
  let divs = [];
  let audiences = [];
  if (u.role === 'teacher') { divs = teacherDivisionIds(u.teacher_id); audiences = ['all', 'teachers']; }
  if (u.role === 'parent') { divs = all(`SELECT DISTINCT division_id AS id FROM students WHERE id IN (${parentStudentIds(u.parent_id).join(',') || 0})`).map((r) => r.id); audiences = ['all', 'parents']; }
  if (u.role === 'student') { divs = [get('SELECT division_id FROM students WHERE id = ?', u.student_id)?.division_id].filter(Boolean); audiences = ['all', 'students']; }
  const rows = all(`${base} AND (a.audience IN (${audiences.map(() => '?').join(',')}) OR a.published_by = ?) ORDER BY a.published_at DESC LIMIT ?`,
    u.school_id, ...audiences, u.id, limit * 2);
  return rows.filter((a) => !a.division_id || divs.includes(a.division_id) || a.published_by === u.id).slice(0, limit);
}
export { visibleAnnouncements };

api.get('/api/announcements', requireAuth, (ctx) => ({ rows: visibleAnnouncements(ctx.user, Math.min(+ctx.query.limit || 50, 200)) }));

const annSchema = {
  title: { type: 'string', required: true, max: 150 },
  body: { type: 'text', required: true, max: 4000, label: 'Message' },
  audience: { type: 'string', required: true, enum: ['all', 'teachers', 'parents', 'students'] },
  division_id: { type: 'id' },
  is_important: { type: 'bool' },
};
api.post('/api/announcements', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.body, annSchema);
  if (ctx.user.role === 'teacher') {
    if (!v.division_id) throw bad('Teachers can only publish announcements to their own classes. Please select a class.');
    assertDivision(ctx.user, v.division_id);
    if (v.audience === 'teachers') throw bad('Teachers cannot publish staff-only announcements');
  } else if (v.division_id) assertDivision(ctx.user, v.division_id);
  const { id } = run(`INSERT INTO announcements (school_id, title, body, audience, division_id, is_important, published_by) VALUES (?,?,?,?,?,?,?)`,
    ctx.user.school_id, v.title, v.body, v.audience, v.division_id, v.is_important || 0, ctx.user.id);
  const ann = get('SELECT * FROM announcements WHERE id = ?', id);
  notifyAnnouncement(ctx.user.school_id, ann, ctx.user.id);
  audit(ctx, 'create', 'announcement', id, { title: v.title });
  return ann;
});
function ownAnnouncement(ctx) {
  const a = get('SELECT * FROM announcements WHERE id = ? AND school_id = ? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!a) throw notFound('Announcement not found');
  if (ctx.user.role !== 'admin' && a.published_by !== ctx.user.id) throw forbidden('You can only change your own announcements');
  return a;
}
api.put('/api/announcements/:id', requireRole('admin', 'teacher'), (ctx) => {
  const a = ownAnnouncement(ctx);
  const v = validate({ ...a, ...ctx.body }, annSchema);
  if (ctx.user.role === 'teacher') { if (!v.division_id) throw bad('Select a class'); assertDivision(ctx.user, v.division_id); }
  run(`UPDATE announcements SET title=?, body=?, audience=?, division_id=?, is_important=?, updated_at=datetime('now') WHERE id=?`,
    v.title, v.body, v.audience, v.division_id, v.is_important || 0, a.id);
  audit(ctx, 'update', 'announcement', a.id);
  return get('SELECT * FROM announcements WHERE id = ?', a.id);
});
api.del('/api/announcements/:id', requireRole('admin', 'teacher'), (ctx) => {
  const a = ownAnnouncement(ctx);
  run(`UPDATE announcements SET deleted_at = datetime('now') WHERE id = ?`, a.id);
  audit(ctx, 'delete', 'announcement', a.id);
  return { ok: true };
});

// ---------- calendar ----------
api.get('/api/calendar', requireAuth, (ctx) => {
  const u = ctx.user;
  const month = isMonth(ctx.query.month) ? ctx.query.month : today().slice(0, 7);
  const [from, to] = monthRange(month);
  let divs = null; // null = all
  let studentIds = [];
  if (u.role === 'teacher') divs = teacherDivisionIds(u.teacher_id);
  if (u.role === 'parent') { studentIds = parentStudentIds(u.parent_id); divs = all(`SELECT DISTINCT division_id AS id FROM students WHERE id IN (${studentIds.join(',') || 0})`).map((r) => r.id); }
  if (u.role === 'student') { studentIds = [u.student_id]; divs = [get('SELECT division_id FROM students WHERE id = ?', u.student_id)?.division_id].filter(Boolean); }
  const inDivs = (d) => divs === null || d == null || divs.includes(d);

  const events = all(`SELECT e.*, c.name || '-' || d.name AS division_label FROM school_calendar e
                      LEFT JOIN divisions d ON d.id = e.division_id LEFT JOIN classes c ON c.id = d.class_id
                      WHERE e.school_id = ? AND e.deleted_at IS NULL AND e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date`, u.school_id, to, from)
    .filter((e) => inDivs(e.division_id));
  const holidays = all('SELECT * FROM holidays WHERE school_id = ? AND date BETWEEN ? AND ? ORDER BY date', u.school_id, from, to);
  let hw = all(`SELECT h.id, h.title, h.due_date, h.division_id, s.name AS subject_name, c.name || '-' || d.name AS division_label, h.assign_to
                FROM homework h JOIN subjects s ON s.id = h.subject_id JOIN divisions d ON d.id = h.division_id JOIN classes c ON c.id = d.class_id
                WHERE h.school_id = ? AND h.deleted_at IS NULL AND h.due_date BETWEEN ? AND ?`, u.school_id, from, to)
    .filter((h) => divs === null || divs.includes(h.division_id));
  if (studentIds.length) {
    hw = hw.filter((h) => h.assign_to === 'class' || get(`SELECT 1 FROM homework_assignments WHERE homework_id = ? AND student_id IN (${studentIds.join(',')})`, h.id));
  }
  return { month, events, holidays, homework_deadlines: hw };
});

const evSchema = {
  title: { type: 'string', required: true, max: 150 },
  description: { type: 'text', max: 2000 },
  event_type: { type: 'string', required: true, enum: ['exam', 'test', 'meeting', 'event', 'other'] },
  start_date: { type: 'date', required: true, label: 'Start date' },
  end_date: { type: 'date', label: 'End date' },
  division_id: { type: 'id' },
};
function checkEvent(ctx, v) {
  v.end_date = v.end_date || v.start_date;
  if (v.end_date < v.start_date) throw bad('End date cannot be before start date');
  if (ctx.user.role === 'teacher') { if (!v.division_id) throw bad('Teachers can only add events for their own class'); assertDivision(ctx.user, v.division_id); }
  else if (v.division_id) assertDivision(ctx.user, v.division_id);
}
api.post('/api/calendar-events', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.body, evSchema);
  checkEvent(ctx, v);
  const { id } = run(`INSERT INTO school_calendar (school_id, academic_year_id, title, description, event_type, start_date, end_date, division_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    ctx.user.school_id, currentYear(ctx.user.school_id)?.id, v.title, v.description, v.event_type, v.start_date, v.end_date, v.division_id, ctx.user.id);
  audit(ctx, 'create', 'calendar_event', id, { title: v.title });
  return get('SELECT * FROM school_calendar WHERE id = ?', id);
});
function ownEvent(ctx) {
  const e = get('SELECT * FROM school_calendar WHERE id = ? AND school_id = ? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!e) throw notFound('Event not found');
  if (ctx.user.role !== 'admin' && e.created_by !== ctx.user.id) throw forbidden('You can only change events you created');
  return e;
}
api.put('/api/calendar-events/:id', requireRole('admin', 'teacher'), (ctx) => {
  const e = ownEvent(ctx);
  const v = validate({ ...e, ...ctx.body }, evSchema);
  checkEvent(ctx, v);
  run(`UPDATE school_calendar SET title=?, description=?, event_type=?, start_date=?, end_date=?, division_id=?, updated_at=datetime('now') WHERE id=?`,
    v.title, v.description, v.event_type, v.start_date, v.end_date, v.division_id, e.id);
  audit(ctx, 'update', 'calendar_event', e.id);
  return get('SELECT * FROM school_calendar WHERE id = ?', e.id);
});
api.del('/api/calendar-events/:id', requireRole('admin', 'teacher'), (ctx) => {
  const e = ownEvent(ctx);
  run(`UPDATE school_calendar SET deleted_at = datetime('now') WHERE id = ?`, e.id);
  audit(ctx, 'delete', 'calendar_event', e.id);
  return { ok: true };
});

// ---------- holidays ----------
api.get('/api/holidays', requireAuth, (ctx) => ({ rows: all('SELECT * FROM holidays WHERE school_id = ? ORDER BY date', ctx.user.school_id) }));
api.post('/api/holidays', requireRole('admin'), (ctx) => {
  const v = validate(ctx.body, { name: { type: 'string', required: true, max: 120 }, date: { type: 'date', required: true }, description: { type: 'text', max: 500 } });
  if (get('SELECT 1 FROM holidays WHERE school_id = ? AND date = ?', ctx.user.school_id, v.date)) throw bad('A holiday already exists on this date');
  const { id } = run('INSERT INTO holidays (school_id, academic_year_id, name, date, description) VALUES (?,?,?,?,?)',
    ctx.user.school_id, currentYear(ctx.user.school_id)?.id, v.name, v.date, v.description);
  audit(ctx, 'create', 'holiday', id, v);
  return get('SELECT * FROM holidays WHERE id = ?', id);
});
api.del('/api/holidays/:id', requireRole('admin'), (ctx) => {
  const r = run('DELETE FROM holidays WHERE id = ? AND school_id = ?', +ctx.params.id, ctx.user.school_id);
  if (!r.changes) throw notFound();
  audit(ctx, 'delete', 'holiday', +ctx.params.id);
  return { ok: true };
});
