// Homework: create/edit/delete with attachments, targeted assignment, submissions, review, secure downloads.
import { api, bad, forbidden, notFound, sendFile } from '../http.js';
import { all, get, run, tx } from '../db.js';
import { requireAuth, requireRole, assertDivision, assertStudent, teacherDivisionIds, parentStudentIds, canViewStudent } from '../auth.js';
import { validate, audit, today, currentYear, isDate, addDays } from '../util.js';
import { storeUpload, storage } from '../storage.js';
import { notifyHomework, homeworkAudience, notifyUsers, studentAudience } from '../notify.js';

const HW_SELECT = `SELECT h.*, s.name AS subject_name, s.code AS subject_code, c.name || '-' || d.name AS division_label, t.full_name AS teacher_name,
  (SELECT COUNT(*) FROM homework_attachments a WHERE a.homework_id=h.id) AS attachment_count
  FROM homework h JOIN subjects s ON s.id=h.subject_id JOIN divisions d ON d.id=h.division_id JOIN classes c ON c.id=d.class_id LEFT JOIN teachers t ON t.id=h.teacher_id`;

export function statusFor(hw, sub, t = today()) {
  if (sub?.status === 'reviewed') return 'reviewed';
  if (sub) return 'submitted';
  if (hw.due_date < t) return 'overdue';
  if (hw.homework_date > t) return 'assigned';
  return 'pending';
}

export function studentHomework(studentId, { from, to, subject_id } = {}) {
  const st = get('SELECT division_id FROM students WHERE id=?', studentId);
  if (!st?.division_id) return [];
  const rows = all(`${HW_SELECT} WHERE h.division_id=? AND h.deleted_at IS NULL AND h.homework_date <= ?
        AND (h.assign_to='class' OR EXISTS (SELECT 1 FROM homework_assignments ha WHERE ha.homework_id=h.id AND ha.student_id=?))
        AND (? IS NULL OR h.homework_date >= ? OR h.due_date >= ?) AND (? IS NULL OR h.homework_date <= ?) AND (? IS NULL OR h.subject_id = ?)
        ORDER BY h.homework_date DESC, h.id DESC LIMIT 300`,
  st.division_id, today(), studentId, from || null, from || null, from || null, to || null, to || null, subject_id || null, subject_id || null);
  const t = today();
  return rows.map((h) => {
    const sub = get('SELECT id, status, submitted_at, reviewed_at, feedback, original_name FROM homework_submissions WHERE homework_id=? AND student_id=?', h.id, studentId);
    return { ...h, submission: sub || null, student_status: statusFor(h, sub, t) };
  });
}

function canTeach(user, divisionId, subjectId) {
  if (user.role === 'admin') { assertDivision(user, divisionId); return; }
  const ct = get('SELECT 1 FROM divisions WHERE id=? AND class_teacher_id=?', divisionId, user.teacher_id);
  const sub = get('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND division_id=? AND subject_id=?', user.teacher_id, divisionId, subjectId);
  if (!ct && !sub) throw forbidden('You are not assigned to teach this subject in this class');
}

function loadHomework(id, user) {
  const hw = get(`${HW_SELECT} WHERE h.id=? AND h.school_id=? AND h.deleted_at IS NULL`, id, user.school_id);
  if (!hw) throw notFound('Homework not found');
  return hw;
}
function canViewHomework(user, hw) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return teacherDivisionIds(user.teacher_id).includes(hw.division_id);
  const audience = new Set(homeworkAudience(hw.id));
  const mine = user.role === 'parent' ? parentStudentIds(user.parent_id) : [user.student_id];
  return mine.some((id) => audience.has(id)) && hw.homework_date <= today();
}
function canEditHomework(user, hw) {
  if (user.role === 'admin') return true;
  return user.role === 'teacher' && (hw.teacher_id === user.teacher_id || get('SELECT 1 FROM divisions WHERE id=? AND class_teacher_id=?', hw.division_id, user.teacher_id));
}

// ---------- list ----------
api.get('/api/homework', requireAuth, (ctx) => {
  const u = ctx.user;
  const q = ctx.query;
  const f = validate(q, { from: { type: 'date' }, to: { type: 'date' }, subject_id: { type: 'id' }, division_id: { type: 'id' }, student_id: { type: 'id' }, status: { type: 'string', max: 20 } });
  if (u.role === 'parent' || u.role === 'student') {
    const sid = u.role === 'student' ? u.student_id : f.student_id;
    if (!sid) throw bad('Select a child');
    assertStudent(u, sid);
    let rows = studentHomework(sid, f);
    if (f.status) rows = rows.filter((r) => (f.status === 'completed' ? ['submitted', 'reviewed'].includes(r.student_status) : f.status === 'open' ? ['pending', 'overdue'].includes(r.student_status) : r.student_status === f.status));
    return { rows };
  }
  let divs = null;
  if (u.role === 'teacher') divs = teacherDivisionIds(u.teacher_id);
  if (f.division_id) { assertDivision(u, f.division_id); divs = [f.division_id]; }
  const where = [`h.school_id=?`, `h.deleted_at IS NULL`];
  const params = [u.school_id];
  if (divs) where.push(`h.division_id IN (${divs.join(',') || 0})`);
  if (f.subject_id) { where.push('h.subject_id=?'); params.push(f.subject_id); }
  if (f.from) { where.push('h.homework_date>=?'); params.push(f.from); }
  if (f.to) { where.push('h.homework_date<=?'); params.push(f.to); }
  if (q.mine === '1' && u.role === 'teacher') { where.push('h.teacher_id=?'); params.push(u.teacher_id); }
  if (q.q) { where.push('(h.title LIKE ? OR h.instructions LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const rows = all(`${HW_SELECT} WHERE ${where.join(' AND ')} ORDER BY h.homework_date DESC, h.id DESC LIMIT 300`, ...params).map((h) => {
    const assigned = homeworkAudience(h.id).length;
    const sub = get(`SELECT COUNT(*) n, SUM(status='reviewed') r FROM homework_submissions WHERE homework_id=?`, h.id);
    return { ...h, assigned, submitted: sub.n, reviewed: sub.r || 0, status: h.due_date < today() ? 'closed' : 'active', can_edit: !!canEditHomework(u, h) };
  });
  return { rows };
});

// ---------- detail ----------
api.get('/api/homework/:id', requireAuth, (ctx) => {
  const u = ctx.user;
  const hw = loadHomework(+ctx.params.id, u);
  if (!canViewHomework(u, hw)) throw forbidden('This homework is not assigned to you');
  hw.attachments = all('SELECT id, original_name, mime_type, size_bytes, created_at FROM homework_attachments WHERE homework_id=? ORDER BY id', hw.id);
  hw.can_edit = !!canEditHomework(u, hw);
  if (hw.assign_to === 'selected') hw.selected_students = all('SELECT student_id FROM homework_assignments WHERE homework_id=?', hw.id).map((r) => r.student_id);
  if (u.role === 'admin' || u.role === 'teacher') {
    const ids = homeworkAudience(hw.id);
    const subs = new Map(all('SELECT * FROM homework_submissions WHERE homework_id=?', hw.id).map((s) => [s.student_id, s]));
    hw.roster = all(`SELECT id, full_name, roll_no FROM students WHERE id IN (${ids.join(',') || 0}) ORDER BY roll_no`).map((s) => {
      const sub = subs.get(s.id);
      return { ...s, submission: sub ? { id: sub.id, status: sub.status, submitted_at: sub.submitted_at, content: sub.content, original_name: sub.original_name, feedback: sub.feedback, late: sub.submitted_at.slice(0, 10) > hw.due_date } : null, status: statusFor(hw, sub) };
    });
    hw.counts = hw.roster.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  } else {
    const mine = u.role === 'parent' ? parentStudentIds(u.parent_id) : [u.student_id];
    const sid = ctx.query.student_id ? +ctx.query.student_id : mine.find((id) => homeworkAudience(hw.id).includes(id));
    if (!mine.includes(sid)) throw forbidden();
    const sub = get('SELECT id, status, content, original_name, feedback, submitted_at, reviewed_at FROM homework_submissions WHERE homework_id=? AND student_id=?', hw.id, sid);
    hw.student_id = sid;
    hw.submission = sub || null;
    hw.student_status = statusFor(hw, sub);
  }
  return hw;
});

// ---------- create / update ----------
const hwSchema = {
  division_id: { type: 'id', required: true, label: 'Class & division' }, subject_id: { type: 'id', required: true, label: 'Subject' },
  title: { type: 'string', required: true, max: 150 }, instructions: { type: 'text', max: 5000 },
  homework_date: { type: 'date', required: true, label: 'Homework date' }, due_date: { type: 'date', required: true, label: 'Submission deadline' },
  allow_submission: { type: 'bool' }, assign_to: { type: 'string', enum: ['class', 'selected'] },
};
function parseStudentIds(body) {
  let ids = body.student_ids;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = ids.split(','); } }
  return [...new Set([].concat(ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
function validateHw(ctx, v) {
  if (v.due_date < v.homework_date) throw bad('Submission deadline cannot be before the homework date');
  if (v.homework_date > addDays(today(), 60)) throw bad('Homework date is too far in the future');
  if (!get('SELECT 1 FROM subjects WHERE id=? AND school_id=? AND deleted_at IS NULL', v.subject_id, ctx.user.school_id)) throw bad('Subject not found');
  canTeach(ctx.user, v.division_id, v.subject_id);
  let studentIds = [];
  if (v.assign_to === 'selected') {
    studentIds = parseStudentIds(ctx.body);
    if (!studentIds.length) throw bad('Select at least one student, or assign to the whole class');
    const ok = all(`SELECT id FROM students WHERE division_id=? AND status='active' AND deleted_at IS NULL AND id IN (${studentIds.join(',')})`, v.division_id);
    if (ok.length !== studentIds.length) throw bad('Some selected students are not in this class');
  }
  if (ctx.files.length > 10) throw bad('Maximum 10 attachments per homework');
  return studentIds;
}

api.post('/api/homework', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.body, hwSchema);
  v.assign_to = v.assign_to || 'class';
  if (ctx.body.allow_submission === undefined) v.allow_submission = 1;
  const studentIds = validateHw(ctx, v);
  const stored = ctx.files.map((f) => storeUpload(f)); // validates all before DB write
  const year = currentYear(ctx.user.school_id);
  const id = tx(() => {
    const { id } = run(`INSERT INTO homework (school_id, academic_year_id, division_id, subject_id, teacher_id, created_by, title, instructions, homework_date, due_date, allow_submission, assign_to)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.user.school_id, year?.id, v.division_id, v.subject_id, ctx.user.teacher_id || null, ctx.user.id, v.title, v.instructions, v.homework_date, v.due_date, v.allow_submission, v.assign_to);
    for (const sid of studentIds) run('INSERT INTO homework_assignments (homework_id, student_id) VALUES (?,?)', id, sid);
    for (const f of stored) run('INSERT INTO homework_attachments (homework_id, original_name, stored_name, mime_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)', id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, ctx.user.id);
    return id;
  });
  if (v.homework_date <= today()) notifyHomework(ctx.user.school_id, id, get('SELECT name FROM subjects WHERE id=?', v.subject_id).name);
  audit(ctx, 'create', 'homework', id, { title: v.title, division_id: v.division_id, attachments: stored.length });
  return loadHomework(id, ctx.user);
});

api.put('/api/homework/:id', requireRole('admin', 'teacher'), (ctx) => {
  const hw = loadHomework(+ctx.params.id, ctx.user);
  if (!canEditHomework(ctx.user, hw)) throw forbidden('You can only edit homework you created');
  const v = validate({ ...hw, ...ctx.body }, hwSchema);
  v.assign_to = v.assign_to || 'class';
  const studentIds = validateHw(ctx, v);
  const removeIds = [].concat(ctx.body.remove_attachment_ids || []).flatMap((x) => String(x).split(',')).map(Number).filter(Boolean);
  const existingCount = get('SELECT COUNT(*) n FROM homework_attachments WHERE homework_id=?', hw.id).n;
  if (existingCount - removeIds.length + ctx.files.length > 10) throw bad('Maximum 10 attachments per homework');
  const stored = ctx.files.map((f) => storeUpload(f));
  const removed = tx(() => {
    run(`UPDATE homework SET division_id=?, subject_id=?, title=?, instructions=?, homework_date=?, due_date=?, allow_submission=?, assign_to=?, updated_at=datetime('now') WHERE id=?`,
      v.division_id, v.subject_id, v.title, v.instructions, v.homework_date, v.due_date, v.allow_submission, v.assign_to, hw.id);
    run('DELETE FROM homework_assignments WHERE homework_id=?', hw.id);
    for (const sid of studentIds) run('INSERT INTO homework_assignments (homework_id, student_id) VALUES (?,?)', hw.id, sid);
    for (const f of stored) run('INSERT INTO homework_attachments (homework_id, original_name, stored_name, mime_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)', hw.id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, ctx.user.id);
    const rm = removeIds.length ? all(`SELECT * FROM homework_attachments WHERE homework_id=? AND id IN (${removeIds.join(',')})`, hw.id) : [];
    for (const a of rm) run('DELETE FROM homework_attachments WHERE id=?', a.id);
    return rm;
  });
  for (const a of removed) { try { storage.remove(a.stored_name); } catch { /* ignore */ } }
  audit(ctx, 'update', 'homework', hw.id, { title: v.title, added: stored.length, removed: removed.length });
  return loadHomework(hw.id, ctx.user);
});

api.del('/api/homework/:id', requireRole('admin', 'teacher'), (ctx) => {
  const hw = loadHomework(+ctx.params.id, ctx.user);
  if (!canEditHomework(ctx.user, hw)) throw forbidden('You can only delete homework you created');
  run(`UPDATE homework SET deleted_at=datetime('now') WHERE id=?`, hw.id);
  audit(ctx, 'delete', 'homework', hw.id, { title: hw.title });
  return { ok: true };
});

// ---------- downloads ----------
api.get('/api/files/homework/:id', requireAuth, (ctx) => {
  const a = get('SELECT * FROM homework_attachments WHERE id=?', +ctx.params.id);
  if (!a) throw notFound('File not found');
  const hw = loadHomework(a.homework_id, ctx.user);
  if (!canViewHomework(ctx.user, hw)) throw forbidden();
  const full = storage.resolve(a.stored_name);
  if (!full) throw notFound('File is missing from storage');
  sendFile(ctx.res, { filePath: full, filename: a.original_name, mime: a.mime_type, inline: ctx.query.inline === '1' && /^(image\/|application\/pdf)/.test(a.mime_type) });
  return ctx.SENT;
});
api.get('/api/files/submission/:id', requireAuth, (ctx) => {
  const s = get('SELECT * FROM homework_submissions WHERE id=?', +ctx.params.id);
  if (!s?.stored_name) throw notFound('File not found');
  const hw = loadHomework(s.homework_id, ctx.user);
  const ok = ['admin', 'teacher'].includes(ctx.user.role) ? canViewHomework(ctx.user, hw) : canViewStudent(ctx.user, s.student_id);
  if (!ok) throw forbidden();
  const full = storage.resolve(s.stored_name);
  if (!full) throw notFound('File is missing from storage');
  sendFile(ctx.res, { filePath: full, filename: s.original_name, mime: s.mime_type });
  return ctx.SENT;
});

// ---------- submissions ----------
api.post('/api/homework/:id/submit', requireRole('student', 'parent'), (ctx) => {
  const u = ctx.user;
  const hw = loadHomework(+ctx.params.id, u);
  const sid = u.role === 'student' ? u.student_id : Number(ctx.body.student_id);
  if (!sid) throw bad('Select a child');
  assertStudent(u, sid);
  if (!homeworkAudience(hw.id).includes(sid) || hw.homework_date > today()) throw forbidden('This homework is not assigned to this student');
  const v = validate(ctx.body, { content: { type: 'text', max: 3000, label: 'Note' } });
  const file = ctx.files[0];
  if (file && !hw.allow_submission) throw bad('Online file submission is not enabled for this homework');
  if (ctx.files.length > 1) throw bad('Upload a single file (combine pages into one PDF if needed)');
  const existing = get('SELECT * FROM homework_submissions WHERE homework_id=? AND student_id=?', hw.id, sid);
  if (existing?.status === 'reviewed') throw bad('This homework has already been reviewed by the teacher');
  if (!file && !v.content && !existing) v.content = 'Marked as completed';
  const stored = file ? storeUpload(file) : null;
  if (existing) {
    run(`UPDATE homework_submissions SET content=COALESCE(?, content), original_name=COALESCE(?, original_name), stored_name=COALESCE(?, stored_name), mime_type=COALESCE(?, mime_type),
         size_bytes=COALESCE(?, size_bytes), submitted_by=?, submitted_at=datetime('now') WHERE id=?`,
    v.content, stored?.original_name, stored?.stored_name, stored?.mime_type, stored?.size_bytes, u.id, existing.id);
    if (stored && existing.stored_name) { try { storage.remove(existing.stored_name); } catch { /* ignore */ } }
  } else {
    run(`INSERT INTO homework_submissions (homework_id, student_id, content, original_name, stored_name, mime_type, size_bytes, submitted_by) VALUES (?,?,?,?,?,?,?,?)`,
      hw.id, sid, v.content, stored?.original_name, stored?.stored_name, stored?.mime_type, stored?.size_bytes, u.id);
  }
  audit(ctx, existing ? 'resubmit' : 'submit', 'homework_submission', hw.id, { student_id: sid, file: !!stored });
  return get('SELECT id, status, content, original_name, submitted_at FROM homework_submissions WHERE homework_id=? AND student_id=?', hw.id, sid);
});

api.post('/api/homework/submissions/:id/review', requireRole('admin', 'teacher'), (ctx) => {
  const s = get('SELECT * FROM homework_submissions WHERE id=?', +ctx.params.id);
  if (!s) throw notFound('Submission not found');
  const hw = loadHomework(s.homework_id, ctx.user);
  if (!canViewHomework(ctx.user, hw)) throw forbidden();
  const v = validate(ctx.body, { feedback: { type: 'text', max: 1000 } });
  run(`UPDATE homework_submissions SET status='reviewed', feedback=?, reviewed_at=datetime('now'), reviewed_by=? WHERE id=?`, v.feedback, ctx.user.id, s.id);
  const st = get('SELECT full_name FROM students WHERE id=?', s.student_id);
  notifyUsers(studentAudience(s.student_id).userIds, { type: 'homework', title: `Homework reviewed: ${hw.title}`, body: v.feedback ? `${st.full_name}: ${v.feedback}` : `${st.full_name}'s work was reviewed`, link: `#/homework/${hw.id}`, refKey: `rev:${s.id}` });
  audit(ctx, 'review', 'homework_submission', s.id);
  return { ok: true };
});
api.post('/api/homework/:id/review-all', requireRole('admin', 'teacher'), (ctx) => {
  const hw = loadHomework(+ctx.params.id, ctx.user);
  if (!canViewHomework(ctx.user, hw)) throw forbidden();
  const r = run(`UPDATE homework_submissions SET status='reviewed', reviewed_at=datetime('now'), reviewed_by=? WHERE homework_id=? AND status='submitted'`, ctx.user.id, hw.id);
  audit(ctx, 'review_all', 'homework', hw.id, { count: r.changes });
  return { reviewed: r.changes };
});

export { isDate };
