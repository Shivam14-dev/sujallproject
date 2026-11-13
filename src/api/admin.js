// School administration: dashboard, school profile, academic years, classes/divisions/subjects,
// teachers & assignments, students (+bulk import), parents, audit logs.
import { api, bad, notFound } from '../http.js';
import { all, get, run, tx } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { validate, passwordPolicy, audit, currentYear, today, addDays, pct, page, schoolSettings, isDate } from '../util.js';
import { parseCsv, parseXlsx } from '../export.js';
import { visibleAnnouncements } from './common.js';

const admin = requireRole('admin');
const ROLE = { admin: 1, teacher: 2, parent: 3, student: 4 };

function uniqueUsername(base) {
  base = String(base).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 40) || 'user';
  let name = base, i = 1;
  while (get('SELECT 1 FROM users WHERE username = ?', name)) name = `${base}${++i}`;
  return name;
}
function assertUsernameFree(username, exceptUserId) {
  const u = get('SELECT id FROM users WHERE username = ?', username);
  if (u && u.id !== exceptUserId) throw bad(`User ID "${username}" is already taken`);
}
const usernameRule = { type: 'string', max: 60, pattern: /^[A-Za-z0-9._@-]{3,60}$/, patternMsg: 'User ID may contain letters, numbers, dot, dash, underscore (min 3)', label: 'User ID' };

// ---------- dashboard ----------
api.get('/api/admin/dashboard', admin, (ctx) => {
  const sid = ctx.user.school_id;
  const year = currentYear(sid);
  const t = today();
  const totals = {
    students: get(`SELECT COUNT(*) n FROM students WHERE school_id=? AND status='active' AND deleted_at IS NULL`, sid).n,
    teachers: get(`SELECT COUNT(*) n FROM teachers WHERE school_id=? AND status='active' AND deleted_at IS NULL`, sid).n,
    classes: get(`SELECT COUNT(*) n FROM classes WHERE school_id=? AND academic_year_id=? AND deleted_at IS NULL`, sid, year?.id).n,
    divisions: get(`SELECT COUNT(*) n FROM divisions d JOIN classes c ON c.id=d.class_id WHERE c.school_id=? AND c.academic_year_id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL`, sid, year?.id).n,
    parents: get(`SELECT COUNT(*) n FROM parents WHERE school_id=? AND deleted_at IS NULL`, sid).n,
  };
  const todayRows = all(`SELECT status, COUNT(*) n FROM attendance WHERE school_id=? AND date=? GROUP BY status`, sid, t);
  const tc = Object.fromEntries(todayRows.map((r) => [r.status, r.n]));
  const marked = todayRows.reduce((a, r) => a + r.n, 0);
  const todayAtt = { present: tc.present || 0, absent: tc.absent || 0, late: tc.late || 0, half_day: tc.half_day || 0, marked, unmarked: Math.max(totals.students - marked, 0) };
  todayAtt.percentage = pct(todayAtt.present + todayAtt.late + todayAtt.half_day * 0.5, marked);

  const trend = all(`SELECT date, SUM(status IN ('present','late')) + SUM(status='half_day')*0.5 AS present, SUM(status='absent') AS absent, COUNT(*) AS total
                     FROM attendance WHERE school_id=? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, sid, addDays(t, -29), t)
    .map((r) => ({ ...r, percentage: pct(r.present, r.total) }));

  const byDivision = all(`SELECT d.id, c.name || '-' || d.name AS label, t.full_name AS class_teacher,
          (SELECT COUNT(*) FROM students s WHERE s.division_id=d.id AND s.status='active' AND s.deleted_at IS NULL) AS students,
          (SELECT COUNT(*) FROM attendance a WHERE a.division_id=d.id AND a.date=?) AS marked,
          (SELECT COUNT(*) FROM attendance a WHERE a.division_id=d.id AND a.date=? AND a.status='absent') AS absent
        FROM divisions d JOIN classes c ON c.id=d.class_id LEFT JOIN teachers t ON t.id = d.class_teacher_id
        WHERE c.school_id=? AND c.academic_year_id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.sort_order, d.name`, t, t, sid, year?.id);

  const recentHomework = all(`SELECT h.id, h.title, h.homework_date, h.due_date, s.name AS subject, c.name || '-' || d.name AS division, te.full_name AS teacher
        FROM homework h JOIN subjects s ON s.id=h.subject_id JOIN divisions d ON d.id=h.division_id JOIN classes c ON c.id=d.class_id
        LEFT JOIN teachers te ON te.id=h.teacher_id WHERE h.school_id=? AND h.deleted_at IS NULL ORDER BY h.homework_date DESC, h.id DESC LIMIT 6`, sid);
  return { totals, today: todayAtt, trend, by_division: byDivision, recent_homework: recentHomework, announcements: visibleAnnouncements(ctx.user, 5), date: t };
});

// ---------- school profile & settings ----------
api.get('/api/admin/school', admin, (ctx) => ({ ...get('SELECT * FROM schools WHERE id = ?', ctx.user.school_id), settings: schoolSettings(ctx.user.school_id) }));
api.put('/api/admin/school', admin, (ctx) => {
  const v = validate(ctx.body, {
    name: { type: 'string', required: true, max: 150, label: 'School name' }, address: { type: 'text', max: 500 },
    phone: { type: 'phone' }, email: { type: 'email' }, website: { type: 'string', max: 200 },
  });
  run(`UPDATE schools SET name=?, address=?, phone=?, email=?, website=?, updated_at=datetime('now') WHERE id=?`, v.name, v.address, v.phone, v.email, v.website, ctx.user.school_id);
  audit(ctx, 'update', 'school', ctx.user.school_id, v);
  return { ok: true };
});
api.put('/api/admin/settings', admin, (ctx) => {
  const v = validate(ctx.body, {
    teacher_edit_window_days: { type: 'int', min: 0, max: 60, label: 'Teacher edit window' },
    low_attendance_threshold: { type: 'int', min: 1, max: 100, label: 'Low attendance threshold' },
    notify_absent: { type: 'bool' }, notify_homework: { type: 'bool' },
    whatsapp_enabled: { type: 'bool' }, email_enabled: { type: 'bool' }, sms_enabled: { type: 'bool' },
  });
  const merged = { ...schoolSettings(ctx.user.school_id), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) };
  for (const k of ['notify_absent', 'notify_homework', 'whatsapp_enabled', 'email_enabled', 'sms_enabled']) merged[k] = !!merged[k];
  run(`UPDATE schools SET settings=?, updated_at=datetime('now') WHERE id=?`, JSON.stringify(merged), ctx.user.school_id);
  audit(ctx, 'update', 'settings', ctx.user.school_id, merged);
  return merged;
});

// ---------- academic years ----------
api.get('/api/admin/academic-years', admin, (ctx) => ({ rows: all('SELECT * FROM academic_years WHERE school_id=? ORDER BY start_date DESC', ctx.user.school_id) }));
const yearSchema = { name: { type: 'string', required: true, max: 20, pattern: /^\d{4}-\d{2,4}$/, patternMsg: 'Name must look like 2026-27' }, start_date: { type: 'date', required: true }, end_date: { type: 'date', required: true } };
api.post('/api/admin/academic-years', admin, (ctx) => {
  const v = validate(ctx.body, yearSchema);
  if (v.end_date <= v.start_date) throw bad('End date must be after start date');
  if (get('SELECT 1 FROM academic_years WHERE school_id=? AND name=?', ctx.user.school_id, v.name)) throw bad('Academic year already exists');
  const { id } = run('INSERT INTO academic_years (school_id, name, start_date, end_date) VALUES (?,?,?,?)', ctx.user.school_id, v.name, v.start_date, v.end_date);
  audit(ctx, 'create', 'academic_year', id, v);
  return get('SELECT * FROM academic_years WHERE id=?', id);
});
api.put('/api/admin/academic-years/:id', admin, (ctx) => {
  const v = validate(ctx.body, yearSchema);
  if (v.end_date <= v.start_date) throw bad('End date must be after start date');
  const r = run(`UPDATE academic_years SET name=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=? AND school_id=?`, v.name, v.start_date, v.end_date, +ctx.params.id, ctx.user.school_id);
  if (!r.changes) throw notFound();
  audit(ctx, 'update', 'academic_year', +ctx.params.id, v);
  return { ok: true };
});
api.post('/api/admin/academic-years/:id/set-current', admin, (ctx) => {
  const y = get('SELECT * FROM academic_years WHERE id=? AND school_id=?', +ctx.params.id, ctx.user.school_id);
  if (!y) throw notFound();
  tx(() => { run('UPDATE academic_years SET is_current=0 WHERE school_id=?', ctx.user.school_id); run('UPDATE academic_years SET is_current=1 WHERE id=?', y.id); });
  audit(ctx, 'set_current', 'academic_year', y.id);
  return { ok: true };
});

// ---------- classes & divisions ----------
api.get('/api/admin/classes', admin, (ctx) => {
  const year = ctx.query.academic_year_id ? +ctx.query.academic_year_id : currentYear(ctx.user.school_id)?.id;
  const classes = all('SELECT * FROM classes WHERE school_id=? AND academic_year_id=? AND deleted_at IS NULL ORDER BY sort_order, name', ctx.user.school_id, year);
  const divs = all(`SELECT d.*, t.full_name AS class_teacher_name,
                     (SELECT COUNT(*) FROM students s WHERE s.division_id=d.id AND s.status='active' AND s.deleted_at IS NULL) AS student_count
                    FROM divisions d LEFT JOIN teachers t ON t.id=d.class_teacher_id WHERE d.deleted_at IS NULL AND d.class_id IN (${classes.map((c) => c.id).join(',') || 0}) ORDER BY d.name`);
  return { academic_year_id: year, rows: classes.map((c) => ({ ...c, divisions: divs.filter((d) => d.class_id === c.id) })) };
});
api.post('/api/admin/classes', admin, (ctx) => {
  const v = validate(ctx.body, { name: { type: 'string', required: true, max: 40, label: 'Class name' }, sort_order: { type: 'int', min: 0, max: 999 }, academic_year_id: { type: 'id' }, divisions: { type: 'string', max: 100 } });
  const yearId = v.academic_year_id || currentYear(ctx.user.school_id)?.id;
  if (!yearId) throw bad('Create an academic year first');
  if (get('SELECT 1 FROM classes WHERE academic_year_id=? AND name=? AND deleted_at IS NULL', yearId, v.name)) throw bad(`Class ${v.name} already exists`);
  const id = tx(() => {
    const { id } = run('INSERT INTO classes (school_id, academic_year_id, name, sort_order) VALUES (?,?,?,?)', ctx.user.school_id, yearId, v.name, v.sort_order ?? 0);
    for (const d of String(v.divisions || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) run('INSERT INTO divisions (class_id, name) VALUES (?,?)', id, d.slice(0, 10));
    return id;
  });
  audit(ctx, 'create', 'class', id, v);
  return get('SELECT * FROM classes WHERE id=?', id);
});
const ownClass = (ctx, id) => { const c = get('SELECT * FROM classes WHERE id=? AND school_id=? AND deleted_at IS NULL', id, ctx.user.school_id); if (!c) throw notFound('Class not found'); return c; };
api.put('/api/admin/classes/:id', admin, (ctx) => {
  const c = ownClass(ctx, +ctx.params.id);
  const v = validate(ctx.body, { name: { type: 'string', required: true, max: 40 }, sort_order: { type: 'int', min: 0, max: 999 } });
  const dup = get('SELECT id FROM classes WHERE academic_year_id=? AND name=? AND deleted_at IS NULL AND id != ?', c.academic_year_id, v.name, c.id);
  if (dup) throw bad(`Class ${v.name} already exists`);
  run(`UPDATE classes SET name=?, sort_order=?, updated_at=datetime('now') WHERE id=?`, v.name, v.sort_order ?? c.sort_order, c.id);
  audit(ctx, 'update', 'class', c.id, v);
  return { ok: true };
});
api.del('/api/admin/classes/:id', admin, (ctx) => {
  const c = ownClass(ctx, +ctx.params.id);
  const n = get(`SELECT COUNT(*) n FROM students s JOIN divisions d ON d.id=s.division_id WHERE d.class_id=? AND s.deleted_at IS NULL AND s.status='active'`, c.id).n;
  if (n) throw bad(`Cannot delete: ${n} active students are in this class. Move them first.`);
  tx(() => { run(`UPDATE divisions SET deleted_at=datetime('now') WHERE class_id=?`, c.id); run(`UPDATE classes SET deleted_at=datetime('now') WHERE id=?`, c.id); });
  audit(ctx, 'delete', 'class', c.id);
  return { ok: true };
});

const divSchema = { name: { type: 'string', required: true, max: 10, label: 'Division name' }, class_teacher_id: { type: 'id' }, room: { type: 'string', max: 30 }, capacity: { type: 'int', min: 1, max: 200 } };
function checkTeacher(ctx, tid) { if (tid && !get('SELECT 1 FROM teachers WHERE id=? AND school_id=? AND deleted_at IS NULL', tid, ctx.user.school_id)) throw bad('Selected teacher not found'); }
api.post('/api/admin/divisions', admin, (ctx) => {
  const v = validate(ctx.body, { ...divSchema, class_id: { type: 'id', required: true } });
  ownClass(ctx, v.class_id);
  checkTeacher(ctx, v.class_teacher_id);
  v.name = v.name.toUpperCase();
  if (get('SELECT 1 FROM divisions WHERE class_id=? AND name=? AND deleted_at IS NULL', v.class_id, v.name)) throw bad(`Division ${v.name} already exists`);
  const { id } = run('INSERT INTO divisions (class_id, name, class_teacher_id, room, capacity) VALUES (?,?,?,?,?)', v.class_id, v.name, v.class_teacher_id, v.room, v.capacity);
  audit(ctx, 'create', 'division', id, v);
  return get('SELECT * FROM divisions WHERE id=?', id);
});
const ownDivision = (ctx, id) => {
  const d = get('SELECT d.* FROM divisions d JOIN classes c ON c.id=d.class_id WHERE d.id=? AND c.school_id=? AND d.deleted_at IS NULL', id, ctx.user.school_id);
  if (!d) throw notFound('Division not found');
  return d;
};
api.put('/api/admin/divisions/:id', admin, (ctx) => {
  const d = ownDivision(ctx, +ctx.params.id);
  const v = validate({ name: d.name, room: d.room, capacity: d.capacity, class_teacher_id: d.class_teacher_id, ...ctx.body }, divSchema);
  checkTeacher(ctx, v.class_teacher_id);
  v.name = v.name.toUpperCase();
  if (get('SELECT 1 FROM divisions WHERE class_id=? AND name=? AND deleted_at IS NULL AND id != ?', d.class_id, v.name, d.id)) throw bad(`Division ${v.name} already exists`);
  run(`UPDATE divisions SET name=?, class_teacher_id=?, room=?, capacity=?, updated_at=datetime('now') WHERE id=?`, v.name, v.class_teacher_id, v.room, v.capacity, d.id);
  audit(ctx, 'update', 'division', d.id, v);
  return { ok: true };
});
api.del('/api/admin/divisions/:id', admin, (ctx) => {
  const d = ownDivision(ctx, +ctx.params.id);
  const n = get(`SELECT COUNT(*) n FROM students WHERE division_id=? AND deleted_at IS NULL AND status='active'`, d.id).n;
  if (n) throw bad(`Cannot delete: ${n} active students are in this division`);
  run(`UPDATE divisions SET deleted_at=datetime('now') WHERE id=?`, d.id);
  audit(ctx, 'delete', 'division', d.id);
  return { ok: true };
});

// ---------- subjects ----------
api.get('/api/admin/subjects', admin, (ctx) => ({ rows: all(`SELECT s.*, (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.subject_id=s.id) AS assignments FROM subjects s WHERE school_id=? AND deleted_at IS NULL ORDER BY name`, ctx.user.school_id) }));
const subSchema = { name: { type: 'string', required: true, max: 60 }, code: { type: 'string', required: true, max: 12, pattern: /^[A-Za-z0-9-]+$/, patternMsg: 'Code may contain letters, numbers and dashes' } };
api.post('/api/admin/subjects', admin, (ctx) => {
  const v = validate(ctx.body, subSchema); v.code = v.code.toUpperCase();
  if (get('SELECT 1 FROM subjects WHERE school_id=? AND code=? AND deleted_at IS NULL', ctx.user.school_id, v.code)) throw bad('Subject code already exists');
  const { id } = run('INSERT INTO subjects (school_id, name, code) VALUES (?,?,?)', ctx.user.school_id, v.name, v.code);
  audit(ctx, 'create', 'subject', id, v);
  return get('SELECT * FROM subjects WHERE id=?', id);
});
api.put('/api/admin/subjects/:id', admin, (ctx) => {
  const v = validate(ctx.body, subSchema); v.code = v.code.toUpperCase();
  if (get('SELECT 1 FROM subjects WHERE school_id=? AND code=? AND deleted_at IS NULL AND id != ?', ctx.user.school_id, v.code, +ctx.params.id)) throw bad('Subject code already exists');
  const r = run(`UPDATE subjects SET name=?, code=?, updated_at=datetime('now') WHERE id=? AND school_id=? AND deleted_at IS NULL`, v.name, v.code, +ctx.params.id, ctx.user.school_id);
  if (!r.changes) throw notFound();
  audit(ctx, 'update', 'subject', +ctx.params.id, v);
  return { ok: true };
});
api.del('/api/admin/subjects/:id', admin, (ctx) => {
  const r = run(`UPDATE subjects SET deleted_at=datetime('now') WHERE id=? AND school_id=? AND deleted_at IS NULL`, +ctx.params.id, ctx.user.school_id);
  if (!r.changes) throw notFound();
  run('DELETE FROM teacher_assignments WHERE subject_id=?', +ctx.params.id);
  audit(ctx, 'delete', 'subject', +ctx.params.id);
  return { ok: true };
});

// ---------- teachers ----------
api.get('/api/admin/teachers', admin, (ctx) => {
  const q = `%${(ctx.query.q || '').trim()}%`;
  const status = ['active', 'inactive'].includes(ctx.query.status) ? ctx.query.status : null;
  const rows = all(`SELECT t.*, u.username, u.last_login_at,
        (SELECT GROUP_CONCAT(c.name || '-' || d.name, ', ') FROM divisions d JOIN classes c ON c.id=d.class_id WHERE d.class_teacher_id=t.id AND d.deleted_at IS NULL) AS class_teacher_of,
        (SELECT GROUP_CONCAT(DISTINCT s.name) FROM teacher_assignments ta JOIN subjects s ON s.id=ta.subject_id WHERE ta.teacher_id=t.id) AS subjects,
        (SELECT COUNT(DISTINCT ta.division_id) FROM teacher_assignments ta WHERE ta.teacher_id=t.id) AS division_count
      FROM teachers t LEFT JOIN users u ON u.id=t.user_id
      WHERE t.school_id=? AND t.deleted_at IS NULL AND (t.full_name LIKE ? OR t.teacher_code LIKE ? OR IFNULL(t.email,'') LIKE ? OR IFNULL(t.phone,'') LIKE ?)
        AND (? IS NULL OR t.status = ?) ORDER BY t.full_name`, ctx.user.school_id, q, q, q, q, status, status);
  return { rows };
});
api.get('/api/admin/teachers/:id', admin, (ctx) => {
  const t = get('SELECT t.*, u.username FROM teachers t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.school_id=? AND t.deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!t) throw notFound('Teacher not found');
  t.assignments = all(`SELECT ta.id, ta.division_id, ta.subject_id, s.name AS subject_name, c.name || '-' || d.name AS division_label
                       FROM teacher_assignments ta JOIN subjects s ON s.id=ta.subject_id JOIN divisions d ON d.id=ta.division_id JOIN classes c ON c.id=d.class_id
                       WHERE ta.teacher_id=? AND d.deleted_at IS NULL ORDER BY c.sort_order, d.name, s.name`, t.id);
  t.class_teacher_of = all(`SELECT d.id, c.name || '-' || d.name AS label FROM divisions d JOIN classes c ON c.id=d.class_id WHERE d.class_teacher_id=? AND d.deleted_at IS NULL`, t.id);
  return t;
});
const teacherSchema = {
  teacher_code: { type: 'string', required: true, max: 20, label: 'Teacher ID' }, full_name: { type: 'string', required: true, max: 100, label: 'Full name' },
  email: { type: 'email' }, phone: { type: 'phone' }, qualification: { type: 'string', max: 100 }, joining_date: { type: 'date' },
  status: { type: 'string', enum: ['active', 'inactive'] }, username: usernameRule, password: { type: 'string', max: 128 },
};
api.post('/api/admin/teachers', admin, (ctx) => {
  const v = validate(ctx.body, teacherSchema);
  if (get('SELECT 1 FROM teachers WHERE school_id=? AND teacher_code=?', ctx.user.school_id, v.teacher_code)) throw bad('Teacher ID already exists');
  const username = v.username || uniqueUsername(v.full_name.split(' ').slice(0, 2).join('.'));
  assertUsernameFree(username);
  const password = v.password || 'Teacher@123';
  passwordPolicy(password);
  const id = tx(() => {
    const user = run(`INSERT INTO users (school_id, role_id, username, email, phone, full_name, password_hash, status, must_change_password) VALUES (?,?,?,?,?,?,?,?,?)`,
      ctx.user.school_id, ROLE.teacher, username, v.email, v.phone, v.full_name, hashPassword(password), v.status || 'active', v.password ? 0 : 1);
    return run(`INSERT INTO teachers (school_id, user_id, teacher_code, full_name, email, phone, qualification, joining_date, status) VALUES (?,?,?,?,?,?,?,?,?)`,
      ctx.user.school_id, user.id, v.teacher_code, v.full_name, v.email, v.phone, v.qualification, v.joining_date, v.status || 'active').id;
  });
  audit(ctx, 'create', 'teacher', id, { teacher_code: v.teacher_code, username });
  return { id, username, temporary_password: v.password ? undefined : password };
});
api.put('/api/admin/teachers/:id', admin, (ctx) => {
  const t = get('SELECT * FROM teachers WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!t) throw notFound('Teacher not found');
  const v = validate(ctx.body, teacherSchema);
  if (get('SELECT 1 FROM teachers WHERE school_id=? AND teacher_code=? AND id != ?', ctx.user.school_id, v.teacher_code, t.id)) throw bad('Teacher ID already exists');
  if (v.username) assertUsernameFree(v.username, t.user_id);
  tx(() => {
    run(`UPDATE teachers SET teacher_code=?, full_name=?, email=?, phone=?, qualification=?, joining_date=?, status=?, updated_at=datetime('now') WHERE id=?`,
      v.teacher_code, v.full_name, v.email, v.phone, v.qualification, v.joining_date, v.status || t.status, t.id);
    if (t.user_id) {
      run(`UPDATE users SET full_name=?, email=?, phone=?, status=?, username=COALESCE(?, username), updated_at=datetime('now') WHERE id=?`, v.full_name, v.email, v.phone, v.status || t.status, v.username, t.user_id);
      if ((v.status || t.status) === 'inactive') run('DELETE FROM sessions WHERE user_id=?', t.user_id);
    }
  });
  audit(ctx, 'update', 'teacher', t.id, { ...v, password: undefined });
  return { ok: true };
});
api.del('/api/admin/teachers/:id', admin, (ctx) => {
  const t = get('SELECT * FROM teachers WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!t) throw notFound('Teacher not found');
  tx(() => {
    run(`UPDATE teachers SET deleted_at=datetime('now'), status='inactive' WHERE id=?`, t.id);
    run('UPDATE divisions SET class_teacher_id=NULL WHERE class_teacher_id=?', t.id);
    run('DELETE FROM teacher_assignments WHERE teacher_id=?', t.id);
    if (t.user_id) { run(`UPDATE users SET status='inactive', deleted_at=datetime('now') WHERE id=?`, t.user_id); run('DELETE FROM sessions WHERE user_id=?', t.user_id); }
  });
  audit(ctx, 'delete', 'teacher', t.id);
  return { ok: true };
});

function resetPassword(ctx, table, id) {
  const row = get(`SELECT user_id FROM ${table} WHERE id=? AND school_id=? AND deleted_at IS NULL`, id, ctx.user.school_id);
  if (!row?.user_id) throw notFound('Account not found');
  const v = validate(ctx.body, { password: { type: 'string', max: 128 } });
  const pw = v.password || `Sch@${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}`;
  passwordPolicy(pw);
  run(`UPDATE users SET password_hash=?, must_change_password=1, status='active', updated_at=datetime('now') WHERE id=?`, hashPassword(pw), row.user_id);
  run('DELETE FROM sessions WHERE user_id=?', row.user_id);
  audit(ctx, 'reset_password', table.replace(/s$/, ''), id);
  return { username: get('SELECT username FROM users WHERE id=?', row.user_id).username, password: pw };
}
api.post('/api/admin/teachers/:id/reset-password', admin, (ctx) => resetPassword(ctx, 'teachers', +ctx.params.id));
api.post('/api/admin/parents/:id/reset-password', admin, (ctx) => resetPassword(ctx, 'parents', +ctx.params.id));
api.post('/api/admin/students/:id/reset-password', admin, (ctx) => resetPassword(ctx, 'students', +ctx.params.id));

// ---------- teacher assignments ----------
api.post('/api/admin/assignments', admin, (ctx) => {
  const v = validate(ctx.body, { teacher_id: { type: 'id', required: true, label: 'Teacher' }, division_id: { type: 'id', required: true, label: 'Division' }, subject_id: { type: 'id', required: true, label: 'Subject' } });
  checkTeacher(ctx, v.teacher_id); ownDivision(ctx, v.division_id);
  if (!get('SELECT 1 FROM subjects WHERE id=? AND school_id=? AND deleted_at IS NULL', v.subject_id, ctx.user.school_id)) throw bad('Subject not found');
  if (get('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND division_id=? AND subject_id=?', v.teacher_id, v.division_id, v.subject_id)) throw bad('This assignment already exists');
  const { id } = run('INSERT INTO teacher_assignments (teacher_id, division_id, subject_id) VALUES (?,?,?)', v.teacher_id, v.division_id, v.subject_id);
  audit(ctx, 'create', 'teacher_assignment', id, v);
  return { id };
});
api.del('/api/admin/assignments/:id', admin, (ctx) => {
  const a = get(`SELECT ta.id FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id WHERE ta.id=? AND t.school_id=?`, +ctx.params.id, ctx.user.school_id);
  if (!a) throw notFound();
  run('DELETE FROM teacher_assignments WHERE id=?', a.id);
  audit(ctx, 'delete', 'teacher_assignment', a.id);
  return { ok: true };
});

// ---------- students ----------
api.get('/api/admin/students', admin, (ctx) => {
  const { limit, offset, page: p } = page(ctx.query);
  const q = `%${(ctx.query.q || '').trim()}%`;
  const div = ctx.query.division_id ? +ctx.query.division_id : null;
  const cls = ctx.query.class_id ? +ctx.query.class_id : null;
  const status = ['active', 'inactive', 'transferred', 'alumni'].includes(ctx.query.status) ? ctx.query.status : null;
  const where = `s.school_id=? AND s.deleted_at IS NULL AND (s.full_name LIKE ? OR s.admission_no LIKE ? OR IFNULL(s.parent_phone,'') LIKE ? OR IFNULL(s.parent_name,'') LIKE ?)
                 AND (? IS NULL OR s.division_id=?) AND (? IS NULL OR d.class_id=?) AND (? IS NULL OR s.status=?)`;
  const params = [ctx.user.school_id, q, q, q, q, div, div, cls, cls, status, status];
  const total = get(`SELECT COUNT(*) n FROM students s LEFT JOIN divisions d ON d.id=s.division_id WHERE ${where}`, ...params).n;
  const rows = all(`SELECT s.*, c.name || '-' || d.name AS division_label, u.username
                    FROM students s LEFT JOIN divisions d ON d.id=s.division_id LEFT JOIN classes c ON c.id=d.class_id LEFT JOIN users u ON u.id=s.user_id
                    WHERE ${where} ORDER BY c.sort_order, d.name, s.roll_no, s.full_name LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { rows, total, page: p, limit };
});
api.get('/api/admin/students/:id', admin, (ctx) => {
  const s = get(`SELECT s.*, c.name || '-' || d.name AS division_label, u.username FROM students s LEFT JOIN divisions d ON d.id=s.division_id
                 LEFT JOIN classes c ON c.id=d.class_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.school_id=? AND s.deleted_at IS NULL`, +ctx.params.id, ctx.user.school_id);
  if (!s) throw notFound('Student not found');
  s.parents = all(`SELECT p.*, m.relation, u.username FROM student_parent_mapping m JOIN parents p ON p.id=m.parent_id LEFT JOIN users u ON u.id=p.user_id WHERE m.student_id=? AND p.deleted_at IS NULL`, s.id);
  return s;
});
const studentSchema = {
  admission_no: { type: 'string', required: true, max: 30, label: 'Admission number' }, full_name: { type: 'string', required: true, max: 100, label: 'Full name' },
  dob: { type: 'date', label: 'Date of birth' }, gender: { type: 'string', enum: ['M', 'F', 'O'] }, division_id: { type: 'id', label: 'Division' },
  roll_no: { type: 'int', min: 1, max: 999, label: 'Roll number' }, parent_name: { type: 'string', max: 100 }, parent_phone: { type: 'phone', label: 'Parent phone' },
  parent_email: { type: 'email', label: 'Parent email' }, address: { type: 'text', max: 500 }, admission_date: { type: 'date' }, blood_group: { type: 'string', max: 5 },
  status: { type: 'string', enum: ['active', 'inactive', 'transferred', 'alumni'] },
  create_login: { type: 'bool' }, create_parent_login: { type: 'bool' },
};
function checkStudent(ctx, v, exceptId = 0) {
  if (get('SELECT 1 FROM students WHERE school_id=? AND admission_no=? AND id != ?', ctx.user.school_id, v.admission_no, exceptId)) throw bad(`Admission number ${v.admission_no} already exists`);
  if (v.division_id) ownDivision(ctx, v.division_id);
  if (v.division_id && v.roll_no && (v.status || 'active') === 'active'
    && get(`SELECT 1 FROM students WHERE division_id=? AND roll_no=? AND status='active' AND deleted_at IS NULL AND id != ?`, v.division_id, v.roll_no, exceptId)) {
    throw bad(`Roll number ${v.roll_no} is already used in this division`);
  }
  if (v.dob && v.dob >= today()) throw bad('Date of birth must be in the past');
}
/** Find-or-create parent account by phone and link to student. */
function linkParentByPhone(ctx, studentId, v) {
  if (!v.parent_phone || !v.parent_name) return null;
  let p = get('SELECT * FROM parents WHERE school_id=? AND phone=? AND deleted_at IS NULL', ctx.user.school_id, v.parent_phone);
  let created = null;
  if (!p) {
    const username = uniqueUsername(v.parent_phone);
    const pw = 'Parent@123';
    const u = run(`INSERT INTO users (school_id, role_id, username, email, phone, full_name, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,1)`,
      ctx.user.school_id, ROLE.parent, username, v.parent_email, v.parent_phone, v.parent_name, hashPassword(pw));
    const pid = run('INSERT INTO parents (school_id, user_id, full_name, phone, email) VALUES (?,?,?,?,?)', ctx.user.school_id, u.id, v.parent_name, v.parent_phone, v.parent_email).id;
    p = { id: pid };
    created = { username, password: pw };
  }
  run('INSERT INTO student_parent_mapping (student_id, parent_id, relation) VALUES (?,?,?) ON CONFLICT DO NOTHING', studentId, p.id, 'parent');
  return created;
}
function createStudent(ctx, v) {
  checkStudent(ctx, v);
  return tx(() => {
    let userId = null, login = null;
    if (v.create_login) {
      const pw = 'Student@123';
      assertUsernameFree(v.admission_no);
      userId = run(`INSERT INTO users (school_id, role_id, username, email, full_name, password_hash, must_change_password) VALUES (?,?,?,?,?,?,1)`,
        ctx.user.school_id, ROLE.student, v.admission_no, null, v.full_name, hashPassword(pw)).id;
      login = { username: v.admission_no, password: pw };
    }
    const id = run(`INSERT INTO students (school_id, user_id, admission_no, full_name, dob, gender, division_id, roll_no, parent_name, parent_phone, parent_email, address, admission_date, blood_group, status)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ctx.user.school_id, userId, v.admission_no, v.full_name, v.dob, v.gender, v.division_id, v.roll_no, v.parent_name, v.parent_phone, v.parent_email, v.address, v.admission_date || today(), v.blood_group, v.status || 'active').id;
    const parentLogin = v.create_parent_login ? linkParentByPhone(ctx, id, v) : null;
    return { id, student_login: login, parent_login: parentLogin };
  });
}
api.post('/api/admin/students', admin, (ctx) => {
  const v = validate(ctx.body, studentSchema);
  const out = createStudent(ctx, v);
  audit(ctx, 'create', 'student', out.id, { admission_no: v.admission_no });
  return out;
});
api.put('/api/admin/students/:id', admin, (ctx) => {
  const s = get('SELECT * FROM students WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!s) throw notFound('Student not found');
  const v = validate(ctx.body, studentSchema);
  checkStudent(ctx, v, s.id);
  const out = tx(() => {
    run(`UPDATE students SET admission_no=?, full_name=?, dob=?, gender=?, division_id=?, roll_no=?, parent_name=?, parent_phone=?, parent_email=?, address=?, admission_date=?, blood_group=?, status=?, updated_at=datetime('now') WHERE id=?`,
      v.admission_no, v.full_name, v.dob, v.gender, v.division_id, v.roll_no, v.parent_name, v.parent_phone, v.parent_email, v.address, v.admission_date || s.admission_date, v.blood_group, v.status || s.status, s.id);
    let login = null;
    if (s.user_id) {
      run(`UPDATE users SET full_name=?, status=?, updated_at=datetime('now') WHERE id=?`, v.full_name, (v.status || s.status) === 'active' ? 'active' : 'inactive', s.user_id);
    } else if (v.create_login) {
      assertUsernameFree(v.admission_no);
      const uid = run(`INSERT INTO users (school_id, role_id, username, full_name, password_hash, must_change_password) VALUES (?,?,?,?,?,1)`, ctx.user.school_id, ROLE.student, v.admission_no, v.full_name, hashPassword('Student@123')).id;
      run('UPDATE students SET user_id=? WHERE id=?', uid, s.id);
      login = { username: v.admission_no, password: 'Student@123' };
    }
    const parentLogin = v.create_parent_login ? linkParentByPhone(ctx, s.id, v) : null;
    return { ok: true, student_login: login, parent_login: parentLogin };
  });
  audit(ctx, 'update', 'student', s.id, { admission_no: v.admission_no, division_id: v.division_id, status: v.status });
  return out;
});
api.del('/api/admin/students/:id', admin, (ctx) => {
  const s = get('SELECT * FROM students WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!s) throw notFound('Student not found');
  tx(() => {
    run(`UPDATE students SET deleted_at=datetime('now'), status='inactive' WHERE id=?`, s.id);
    if (s.user_id) { run(`UPDATE users SET status='inactive', deleted_at=datetime('now') WHERE id=?`, s.user_id); run('DELETE FROM sessions WHERE user_id=?', s.user_id); }
  });
  audit(ctx, 'delete', 'student', s.id, { admission_no: s.admission_no });
  return { ok: true };
});

// bulk import (CSV or XLSX). Columns: admission_no, full_name, class, division, roll_no, gender, dob, parent_name, parent_phone, parent_email, address
const IMPORT_COLS = ['admission_no', 'full_name', 'class', 'division', 'roll_no', 'gender', 'dob', 'parent_name', 'parent_phone', 'parent_email', 'address', 'admission_date'];
api.get('/api/admin/students-import/template', admin, (ctx) => {
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student_import_template.csv"' });
  ctx.res.end(IMPORT_COLS.join(',') + '\r\nADM2026901,Aarav Kulkarni,8,A,41,M,2013-05-14,Sanjay Kulkarni,9876500001,sanjay@example.com,"12 MG Road, Pune",2026-06-15\r\n');
  return ctx.SENT;
});
const excelDate = (v) => {
  if (/^\d{5}(\.\d+)?$/.test(String(v))) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 864e5); return d.toISOString().slice(0, 10); }
  const m = String(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return String(v || '').trim();
};
api.post('/api/admin/students-import', admin, (ctx) => {
  const file = ctx.files[0];
  let rows;
  try {
    if (file) rows = /\.xlsx$/i.test(file.filename) ? parseXlsx(file.data) : parseCsv(file.data.toString('utf8'));
    else if (ctx.body.text) rows = parseCsv(ctx.body.text);
    else throw bad('Please upload a CSV or Excel (.xlsx) file');
  } catch (e) { if (e.status) throw e; throw bad(`Could not read file: ${e.message}`); }
  if (rows.length < 2) throw bad('The file has no data rows');
  const header = rows[0].map((h) => String(h).trim().toLowerCase().replace(/[\s/]+/g, '_'));
  const idx = Object.fromEntries(IMPORT_COLS.map((c) => [c, header.indexOf(c)]));
  if (idx.admission_no < 0 || idx.full_name < 0) throw bad('Header row must include admission_no and full_name');
  const dryRun = ctx.body.dry_run === '1' || ctx.body.dry_run === 'true';
  const year = currentYear(ctx.user.school_id);
  const divLookup = new Map(all(`SELECT d.id, c.name AS cname, d.name AS dname FROM divisions d JOIN classes c ON c.id=d.class_id WHERE c.school_id=? AND c.academic_year_id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL`, ctx.user.school_id, year?.id)
    .map((d) => [`${d.cname}`.toLowerCase() + '|' + `${d.dname}`.toLowerCase(), d.id]));
  const results = [];
  let created = 0;
  const work = () => {
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const val = (c) => (idx[c] >= 0 ? String(r[idx[c]] ?? '').trim() : '');
      try {
        let division_id = null;
        if (val('class')) {
          division_id = divLookup.get(`${val('class').toLowerCase()}|${val('division').toLowerCase()}`);
          if (!division_id) throw bad(`Class ${val('class')}-${val('division')} not found`);
        }
        const g = val('gender').toUpperCase().charAt(0);
        const input = {
          admission_no: val('admission_no'), full_name: val('full_name'), division_id, roll_no: val('roll_no'),
          gender: g ? ({ B: 'M', G: 'F' }[g] || g) : '', dob: excelDate(val('dob')), parent_name: val('parent_name'), parent_phone: val('parent_phone'),
          parent_email: val('parent_email'), address: val('address'), admission_date: excelDate(val('admission_date')), create_login: 1, create_parent_login: 1,
        };
        const v = validate(input, studentSchema);
        if (dryRun) { checkStudent(ctx, v); results.push({ line, ok: true, admission_no: v.admission_no }); return; }
        const out = createStudent(ctx, v);
        created++;
        results.push({ line, ok: true, admission_no: v.admission_no, id: out.id, parent_login: out.parent_login });
      } catch (e) { results.push({ line, ok: false, admission_no: val('admission_no'), error: e.message }); }
    });
  };
  work();
  audit(ctx, dryRun ? 'import_preview' : 'import', 'student', null, { rows: rows.length - 1, created });
  return { total: rows.length - 1, created, failed: results.filter((r) => !r.ok).length, dry_run: dryRun, results };
});

// ---------- parents ----------
api.get('/api/admin/parents', admin, (ctx) => {
  const q = `%${(ctx.query.q || '').trim()}%`;
  const rows = all(`SELECT p.*, u.username, u.status AS account_status, u.last_login_at,
        (SELECT GROUP_CONCAT(s.full_name || ' (' || IFNULL(c.name || '-' || d.name, '—') || ')', ', ') FROM student_parent_mapping m JOIN students s ON s.id=m.student_id
          LEFT JOIN divisions d ON d.id=s.division_id LEFT JOIN classes c ON c.id=d.class_id WHERE m.parent_id=p.id AND s.deleted_at IS NULL) AS children,
        (SELECT COUNT(*) FROM student_parent_mapping m JOIN students s ON s.id = m.student_id WHERE m.parent_id=p.id AND s.deleted_at IS NULL) AS child_count
      FROM parents p LEFT JOIN users u ON u.id=p.user_id
      WHERE p.school_id=? AND p.deleted_at IS NULL AND (p.full_name LIKE ? OR IFNULL(p.phone,'') LIKE ? OR IFNULL(p.email,'') LIKE ? OR IFNULL(u.username,'') LIKE ?)
      ORDER BY p.full_name LIMIT 500`, ctx.user.school_id, q, q, q, q);
  return { rows };
});
api.get('/api/admin/parents/:id', admin, (ctx) => {
  const p = get('SELECT p.*, u.username, u.status AS account_status FROM parents p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.school_id=? AND p.deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!p) throw notFound('Parent not found');
  p.children = all(`SELECT s.id, s.full_name, s.admission_no, m.relation, c.name || '-' || d.name AS division_label FROM student_parent_mapping m JOIN students s ON s.id=m.student_id
                    LEFT JOIN divisions d ON d.id=s.division_id LEFT JOIN classes c ON c.id=d.class_id WHERE m.parent_id=? AND s.deleted_at IS NULL`, p.id);
  return p;
});
const parentSchema = { full_name: { type: 'string', required: true, max: 100, label: 'Full name' }, phone: { type: 'phone', required: true }, email: { type: 'email' }, occupation: { type: 'string', max: 80 }, address: { type: 'text', max: 500 }, username: usernameRule, password: { type: 'string', max: 128 }, status: { type: 'string', enum: ['active', 'inactive'] } };
api.post('/api/admin/parents', admin, (ctx) => {
  const v = validate(ctx.body, parentSchema);
  if (get('SELECT 1 FROM parents WHERE school_id=? AND phone=? AND deleted_at IS NULL', ctx.user.school_id, v.phone)) throw bad('A parent with this phone number already exists');
  const username = v.username || uniqueUsername(v.phone);
  assertUsernameFree(username);
  const pw = v.password || 'Parent@123';
  passwordPolicy(pw);
  const id = tx(() => {
    const u = run(`INSERT INTO users (school_id, role_id, username, email, phone, full_name, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,?)`,
      ctx.user.school_id, ROLE.parent, username, v.email, v.phone, v.full_name, hashPassword(pw), v.password ? 0 : 1);
    return run('INSERT INTO parents (school_id, user_id, full_name, phone, email, occupation, address) VALUES (?,?,?,?,?,?,?)', ctx.user.school_id, u.id, v.full_name, v.phone, v.email, v.occupation, v.address).id;
  });
  audit(ctx, 'create', 'parent', id, { username });
  return { id, username, temporary_password: v.password ? undefined : pw };
});
api.put('/api/admin/parents/:id', admin, (ctx) => {
  const p = get('SELECT * FROM parents WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!p) throw notFound('Parent not found');
  const v = validate(ctx.body, parentSchema);
  if (get('SELECT 1 FROM parents WHERE school_id=? AND phone=? AND deleted_at IS NULL AND id != ?', ctx.user.school_id, v.phone, p.id)) throw bad('Another parent has this phone number');
  if (v.username) assertUsernameFree(v.username, p.user_id);
  tx(() => {
    run(`UPDATE parents SET full_name=?, phone=?, email=?, occupation=?, address=?, updated_at=datetime('now') WHERE id=?`, v.full_name, v.phone, v.email, v.occupation, v.address, p.id);
    if (p.user_id) {
      run(`UPDATE users SET full_name=?, phone=?, email=?, username=COALESCE(?, username), status=COALESCE(?, status), updated_at=datetime('now') WHERE id=?`, v.full_name, v.phone, v.email, v.username, v.status, p.user_id);
      if (v.status === 'inactive') run('DELETE FROM sessions WHERE user_id=?', p.user_id);
    }
  });
  audit(ctx, 'update', 'parent', p.id);
  return { ok: true };
});
api.del('/api/admin/parents/:id', admin, (ctx) => {
  const p = get('SELECT * FROM parents WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!p) throw notFound('Parent not found');
  tx(() => {
    run(`UPDATE parents SET deleted_at=datetime('now') WHERE id=?`, p.id);
    run('DELETE FROM student_parent_mapping WHERE parent_id=?', p.id);
    if (p.user_id) { run(`UPDATE users SET status='inactive', deleted_at=datetime('now') WHERE id=?`, p.user_id); run('DELETE FROM sessions WHERE user_id=?', p.user_id); }
  });
  audit(ctx, 'delete', 'parent', p.id);
  return { ok: true };
});
api.post('/api/admin/parents/:id/children', admin, (ctx) => {
  const p = get('SELECT * FROM parents WHERE id=? AND school_id=? AND deleted_at IS NULL', +ctx.params.id, ctx.user.school_id);
  if (!p) throw notFound('Parent not found');
  const v = validate(ctx.body, { student_id: { type: 'id', required: true, label: 'Student' }, relation: { type: 'string', max: 20, enum: ['father', 'mother', 'guardian', 'parent'] } });
  if (!get('SELECT 1 FROM students WHERE id=? AND school_id=? AND deleted_at IS NULL', v.student_id, ctx.user.school_id)) throw bad('Student not found');
  if (get('SELECT 1 FROM student_parent_mapping WHERE student_id=? AND parent_id=?', v.student_id, p.id)) throw bad('This child is already linked');
  run('INSERT INTO student_parent_mapping (student_id, parent_id, relation) VALUES (?,?,?)', v.student_id, p.id, v.relation || 'parent');
  audit(ctx, 'link', 'parent', p.id, v);
  return { ok: true };
});
api.del('/api/admin/parents/:id/children/:studentId', admin, (ctx) => {
  const p = get('SELECT id FROM parents WHERE id=? AND school_id=?', +ctx.params.id, ctx.user.school_id);
  if (!p) throw notFound();
  run('DELETE FROM student_parent_mapping WHERE parent_id=? AND student_id=?', p.id, +ctx.params.studentId);
  audit(ctx, 'unlink', 'parent', p.id, { student_id: +ctx.params.studentId });
  return { ok: true };
});

// ---------- audit & outbox ----------
api.get('/api/admin/audit-logs', admin, (ctx) => {
  const { limit, offset } = page({ ...ctx.query, limit: ctx.query.limit || 50 });
  const entity = ctx.query.entity || null;
  const rows = all(`SELECT a.*, u.full_name AS user_name, u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
                    WHERE (a.school_id=? OR a.school_id IS NULL) AND (? IS NULL OR a.entity=?) ORDER BY a.id DESC LIMIT ? OFFSET ?`, ctx.user.school_id, entity, entity, limit, offset);
  return { rows };
});
api.get('/api/admin/outbox', admin, () => ({
  rows: all('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 100'),
  summary: all('SELECT channel, status, COUNT(*) n FROM notification_outbox GROUP BY channel, status'),
}));
export { isDate };
