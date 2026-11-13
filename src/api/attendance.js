// Attendance marking, editing with audit history, summaries, student history; teacher/parent/student dashboards; remarks.
import { api, bad, forbidden, notFound } from '../http.js';
import { all, get, run, tx } from '../db.js';
import { requireAuth, requireRole, assertDivision, assertStudent, teacherDivisionIds, parentStudentIds, canAccessDivision } from '../auth.js';
import { validate, audit, today, addDays, isDate, pct, currentYear, schoolSettings, dayOfWeek } from '../util.js';
import { notifyAbsent, notifyUsers, studentAudience } from '../notify.js';
import { divisionsFor, visibleAnnouncements } from './common.js';
import { studentHomework } from './homework.js';

const STATUSES = ['present', 'absent', 'late', 'half_day'];

export function summarize(rows) {
  const s = { present: 0, absent: 0, late: 0, half_day: 0, total: 0 };
  for (const r of rows) { s[r.status] = (s[r.status] || 0) + (r.n ?? 1); s.total += r.n ?? 1; }
  s.attended = s.present + s.late + s.half_day * 0.5;
  s.percentage = pct(s.attended, s.total);
  return s;
}
function divisionInfo(id) {
  return get(`SELECT d.id, d.name, c.name AS class_name, c.name || '-' || d.name AS label, d.class_teacher_id, t.full_name AS class_teacher_name, c.academic_year_id
              FROM divisions d JOIN classes c ON c.id=d.class_id LEFT JOIN teachers t ON t.id=d.class_teacher_id WHERE d.id=? AND d.deleted_at IS NULL`, id);
}
/** Can this user edit an already-saved attendance sheet for this date? */
function editPolicy(user, date) {
  if (user.role === 'admin') return { can_edit: true };
  const win = schoolSettings(user.school_id).teacher_edit_window_days;
  const oldest = addDays(today(), -win);
  return date >= oldest ? { can_edit: true, window_days: win } : { can_edit: false, window_days: win, reason: `Teachers can edit attendance only for the last ${win} day(s). Ask an admin to make this change.` };
}

// ---------- sheet ----------
api.get('/api/attendance/sheet', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.query, { division_id: { type: 'id', required: true, label: 'Division' }, date: { type: 'date', required: true } });
  assertDivision(ctx.user, v.division_id);
  const div = divisionInfo(v.division_id);
  const canMark = canAccessDivision(ctx.user, v.division_id, { classTeacherOnly: true });
  const students = all(`SELECT s.id, s.full_name, s.roll_no, s.admission_no, s.gender, a.id AS attendance_id, a.status, a.remarks, a.updated_at, u.full_name AS marked_by_name
                        FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.date=? LEFT JOIN users u ON u.id=a.marked_by
                        WHERE s.division_id=? AND s.status='active' AND s.deleted_at IS NULL ORDER BY s.roll_no, s.full_name`, v.date, v.division_id);
  const marked = students.filter((s) => s.status);
  const holiday = get('SELECT name FROM holidays WHERE school_id=? AND date=?', ctx.user.school_id, v.date);
  const edits = get(`SELECT COUNT(*) n FROM attendance_audit_logs l JOIN attendance a ON a.id=l.attendance_id WHERE a.division_id=? AND a.date=? AND l.old_status IS NOT NULL`, v.division_id, v.date).n;
  return {
    division: div, date: v.date, students, is_marked: marked.length > 0, marked_count: marked.length,
    summary: summarize(marked.map((s) => ({ status: s.status }))), total_students: students.length,
    holiday: holiday?.name || null, is_sunday: dayOfWeek(v.date) === 0, is_future: v.date > today(),
    can_mark: canMark, edit_count: edits, ...(marked.length ? editPolicy(ctx.user, v.date) : { can_edit: canMark }),
  };
});

// ---------- save (create or edit, upsert per student with audit trail) ----------
api.post('/api/attendance/save', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.body, { division_id: { type: 'id', required: true, label: 'Division' }, date: { type: 'date', required: true }, reason: { type: 'string', max: 300 } });
  assertDivision(ctx.user, v.division_id, { classTeacherOnly: true });
  if (v.date > today()) throw bad('Attendance cannot be marked for a future date');
  const year = currentYear(ctx.user.school_id);
  if (year && (v.date < year.start_date || v.date > year.end_date)) throw bad(`Date is outside the academic year ${year.name}`);
  const holiday = get('SELECT name FROM holidays WHERE school_id=? AND date=?', ctx.user.school_id, v.date);
  if (holiday && ctx.user.role !== 'admin') throw bad(`${v.date} is a school holiday (${holiday.name})`);
  const records = Array.isArray(ctx.body.records) ? ctx.body.records : [];
  if (!records.length) throw bad('No attendance records were submitted');
  if (records.length > 300) throw bad('Too many records');
  const valid = new Map(all(`SELECT id, full_name FROM students WHERE division_id=? AND status='active' AND deleted_at IS NULL`, v.division_id).map((s) => [s.id, s]));
  const clean = records.map((r, i) => {
    const sid = Number(r.student_id);
    if (!valid.has(sid)) throw bad(`Record ${i + 1}: student does not belong to this division`);
    if (!STATUSES.includes(r.status)) throw bad(`Record ${i + 1}: status must be one of ${STATUSES.join(', ')}`);
    const remarks = r.remarks == null ? null : String(r.remarks).trim().slice(0, 300) || null;
    return { student_id: sid, status: r.status, remarks };
  });
  if (new Set(clean.map((c) => c.student_id)).size !== clean.length) throw bad('Duplicate student in submission');

  const existing = new Map(all('SELECT * FROM attendance WHERE division_id=? AND date=?', v.division_id, v.date).map((a) => [a.student_id, a]));
  const isEdit = existing.size > 0;
  if (isEdit) {
    const pol = editPolicy(ctx.user, v.date);
    if (!pol.can_edit) throw forbidden(pol.reason);
  }
  const changes = [];
  const result = tx(() => {
    let created = 0, updated = 0, unchanged = 0;
    for (const r of clean) {
      const ex = existing.get(r.student_id);
      if (!ex) {
        const { id } = run(`INSERT INTO attendance (school_id, academic_year_id, student_id, division_id, date, status, remarks, marked_by) VALUES (?,?,?,?,?,?,?,?)`,
          ctx.user.school_id, year?.id, r.student_id, v.division_id, v.date, r.status, r.remarks, ctx.user.id);
        run(`INSERT INTO attendance_audit_logs (attendance_id, student_id, date, old_status, new_status, new_remarks, reason, changed_by) VALUES (?,?,?,?,?,?,?,?)`,
          id, r.student_id, v.date, null, r.status, r.remarks, isEdit ? (v.reason || 'Added later') : 'Initial marking', ctx.user.id);
        created++;
        if (r.status !== 'present') changes.push(r);
      } else if (ex.status !== r.status || (ex.remarks || null) !== r.remarks) {
        run(`UPDATE attendance SET status=?, remarks=?, marked_by=?, updated_at=datetime('now') WHERE id=?`, r.status, r.remarks, ctx.user.id, ex.id);
        run(`INSERT INTO attendance_audit_logs (attendance_id, student_id, date, old_status, new_status, old_remarks, new_remarks, reason, changed_by) VALUES (?,?,?,?,?,?,?,?,?)`,
          ex.id, r.student_id, v.date, ex.status, r.status, ex.remarks, r.remarks, v.reason || null, ctx.user.id);
        updated++;
        if (ex.status !== r.status && r.status !== 'present') changes.push(r);
      } else unchanged++;
    }
    return { created, updated, unchanged };
  });
  for (const r of changes) notifyAbsent(ctx.user.school_id, { id: r.student_id, full_name: valid.get(r.student_id).full_name, remarks: r.remarks }, v.date, r.status);
  audit(ctx, isEdit ? 'edit' : 'mark', 'attendance', v.division_id, { date: v.date, ...result, reason: v.reason });
  const rows = all('SELECT status FROM attendance WHERE division_id=? AND date=?', v.division_id, v.date);
  return { ...result, is_edit: isEdit, summary: summarize(rows) };
});

// ---------- audit history for a division/date ----------
api.get('/api/attendance/audit', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.query, { division_id: { type: 'id', required: true }, date: { type: 'date', required: true } });
  assertDivision(ctx.user, v.division_id);
  return {
    rows: all(`SELECT l.*, s.full_name AS student_name, s.roll_no, u.full_name AS changed_by_name FROM attendance_audit_logs l
               JOIN attendance a ON a.id=l.attendance_id JOIN students s ON s.id=l.student_id LEFT JOIN users u ON u.id=l.changed_by
               WHERE a.division_id=? AND a.date=? ORDER BY l.id DESC`, v.division_id, v.date),
  };
});

// ---------- summary by student over range (class-wise view) ----------
api.get('/api/attendance/summary', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.query, { division_id: { type: 'id', required: true }, from: { type: 'date', required: true }, to: { type: 'date', required: true } });
  if (v.to < v.from) throw bad('"To" date must be after "From" date');
  assertDivision(ctx.user, v.division_id);
  const rows = all(`SELECT s.id, s.full_name, s.roll_no, s.admission_no,
        SUM(a.status='present') present, SUM(a.status='absent') absent, SUM(a.status='late') late, SUM(a.status='half_day') half_day, COUNT(a.id) total
      FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.date BETWEEN ? AND ?
      WHERE s.division_id=? AND s.status='active' AND s.deleted_at IS NULL GROUP BY s.id ORDER BY s.roll_no`, v.from, v.to, v.division_id)
    .map((r) => ({ ...r, percentage: pct(r.present + r.late + r.half_day * 0.5, r.total) }));
  const daily = all(`SELECT date, SUM(status='present') present, SUM(status='absent') absent, SUM(status='late') late, SUM(status='half_day') half_day, COUNT(*) total
                     FROM attendance WHERE division_id=? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, v.division_id, v.from, v.to)
    .map((d) => ({ ...d, percentage: pct(d.present + d.late + d.half_day * 0.5, d.total) }));
  const tot = rows.reduce((a, r) => { for (const k of ['present', 'absent', 'late', 'half_day', 'total']) a[k] += r[k] || 0; return a; }, { present: 0, absent: 0, late: 0, half_day: 0, total: 0 });
  tot.percentage = pct(tot.present + tot.late + tot.half_day * 0.5, tot.total);
  return { division: divisionInfo(v.division_id), from: v.from, to: v.to, rows, daily, totals: tot, working_days: daily.length };
});

// ---------- one student's attendance ----------
api.get('/api/attendance/student/:id', requireAuth, (ctx) => {
  const sid = +ctx.params.id;
  assertStudent(ctx.user, sid);
  const t = today();
  const v = validate({ from: ctx.query.from || addDays(t, -30), to: ctx.query.to || t }, { from: { type: 'date', required: true }, to: { type: 'date', required: true } });
  const records = all(`SELECT a.date, a.status, a.remarks, a.updated_at FROM attendance a WHERE a.student_id=? AND a.date BETWEEN ? AND ? ORDER BY a.date DESC`, sid, v.from, v.to);
  const history = ctx.user.role === 'admin' || ctx.user.role === 'teacher'
    ? all(`SELECT l.date, l.old_status, l.new_status, l.reason, l.changed_at, u.full_name AS changed_by_name FROM attendance_audit_logs l LEFT JOIN users u ON u.id=l.changed_by
           WHERE l.student_id=? AND l.date BETWEEN ? AND ? AND l.old_status IS NOT NULL ORDER BY l.id DESC`, sid, v.from, v.to)
    : [];
  return { student: studentCard(sid), from: v.from, to: v.to, records, summary: summarize(records), history };
});

function studentCard(id) {
  return get(`SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.gender, s.dob, s.division_id, s.photo, s.blood_group, c.name || '-' || d.name AS division_label,
                     t.full_name AS class_teacher_name, t.phone AS class_teacher_phone
              FROM students s LEFT JOIN divisions d ON d.id=s.division_id LEFT JOIN classes c ON c.id=d.class_id LEFT JOIN teachers t ON t.id=d.class_teacher_id WHERE s.id=?`, id);
}

// ---------- teacher dashboard ----------
api.get('/api/teacher/dashboard', requireRole('teacher'), (ctx) => {
  const u = ctx.user;
  const t = today();
  const divs = divisionsFor(u);
  const ctIds = divs.filter((d) => d.is_class_teacher).map((d) => d.id);
  const classes = divs.map((d) => {
    const rows = all('SELECT status, COUNT(*) n FROM attendance WHERE division_id=? AND date=? GROUP BY status', d.id, t);
    const s = summarize(rows);
    const subjects = all('SELECT s.name FROM teacher_assignments ta JOIN subjects s ON s.id=ta.subject_id WHERE ta.teacher_id=? AND ta.division_id=?', u.teacher_id, d.id).map((r) => r.name);
    return { ...d, subjects, today: s, attendance_marked: s.total > 0 };
  });
  const ids = divs.map((d) => d.id);
  const inIds = ids.join(',') || '0';
  const recentHomework = all(`SELECT h.id, h.title, h.homework_date, h.due_date, s.name AS subject, c.name || '-' || d.name AS division, h.division_id, h.assign_to
        FROM homework h JOIN subjects s ON s.id=h.subject_id JOIN divisions d ON d.id=h.division_id JOIN classes c ON c.id=d.class_id
        WHERE h.teacher_id=? AND h.deleted_at IS NULL ORDER BY h.homework_date DESC, h.id DESC LIMIT 8`, u.teacher_id)
    .map((h) => {
      const assigned = h.assign_to === 'selected'
        ? get('SELECT COUNT(*) n FROM homework_assignments WHERE homework_id=?', h.id).n
        : get(`SELECT COUNT(*) n FROM students WHERE division_id=? AND status='active' AND deleted_at IS NULL`, h.division_id).n;
      const sub = get(`SELECT COUNT(*) n, SUM(status='reviewed') r FROM homework_submissions WHERE homework_id=?`, h.id);
      return { ...h, assigned, submitted: sub.n, reviewed: sub.r || 0 };
    });
  const pendingReview = get(`SELECT COUNT(*) n FROM homework_submissions hs JOIN homework h ON h.id=hs.homework_id WHERE h.teacher_id=? AND hs.status='submitted' AND h.deleted_at IS NULL`, u.teacher_id).n;
  const trend = ctIds.length ? all(`SELECT date, SUM(status IN ('present','late')) + SUM(status='half_day')*0.5 AS present, COUNT(*) total FROM attendance
                    WHERE division_id IN (${ctIds.join(',')}) AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, addDays(t, -13), t).map((r) => ({ ...r, percentage: pct(r.present, r.total) })) : [];
  const lowAttendance = ctIds.length ? all(`SELECT s.id, s.full_name, s.roll_no, c.name || '-' || d.name AS division,
          ROUND(100.0 * (SUM(a.status IN ('present','late')) + SUM(a.status='half_day')*0.5) / COUNT(a.id), 1) AS percentage, COUNT(a.id) days
        FROM students s JOIN attendance a ON a.student_id=s.id JOIN divisions d ON d.id=s.division_id JOIN classes c ON c.id=d.class_id
        WHERE s.division_id IN (${ctIds.join(',')}) AND a.date BETWEEN ? AND ? AND s.deleted_at IS NULL AND s.status='active'
        GROUP BY s.id HAVING percentage < ? ORDER BY percentage LIMIT 8`, addDays(t, -30), t, schoolSettings(u.school_id).low_attendance_threshold) : [];
  return {
    date: t, classes, student_count: get(`SELECT COUNT(*) n FROM students WHERE division_id IN (${inIds}) AND status='active' AND deleted_at IS NULL`).n,
    pending_attendance: classes.filter((c) => c.is_class_teacher && !c.attendance_marked).map((c) => ({ id: c.id, label: c.label })),
    recent_homework: recentHomework, pending_review: pendingReview, trend, low_attendance: lowAttendance,
    announcements: visibleAnnouncements(u, 5),
    upcoming: all(`SELECT * FROM school_calendar WHERE school_id=? AND deleted_at IS NULL AND end_date >= ? AND (division_id IS NULL OR division_id IN (${inIds})) ORDER BY start_date LIMIT 5`, u.school_id, t),
  };
});

// ---------- students list for teacher ----------
api.get('/api/teacher/students', requireRole('admin', 'teacher'), (ctx) => {
  const v = validate(ctx.query, { division_id: { type: 'id', required: true } });
  assertDivision(ctx.user, v.division_id);
  const t = today();
  const from = addDays(t, -30);
  return {
    division: divisionInfo(v.division_id),
    rows: all(`SELECT s.id, s.full_name, s.roll_no, s.admission_no, s.gender, s.parent_name, s.parent_phone,
                 (SELECT COUNT(*) FROM attendance a WHERE a.student_id=s.id AND a.date BETWEEN ? AND ?) AS days,
                 (SELECT SUM(a.status IN ('present','late')) + SUM(a.status='half_day')*0.5 FROM attendance a WHERE a.student_id=s.id AND a.date BETWEEN ? AND ?) AS attended,
                 (SELECT COUNT(*) FROM student_remarks r WHERE r.student_id=s.id AND r.deleted_at IS NULL) AS remarks
               FROM students s WHERE s.division_id=? AND s.status='active' AND s.deleted_at IS NULL ORDER BY s.roll_no`, from, t, from, t, v.division_id)
      .map((r) => ({ ...r, percentage: pct(r.attended || 0, r.days) })),
  };
});

// ---------- parent: children ----------
api.get('/api/parent/children', requireRole('parent'), (ctx) => ({
  rows: parentStudentIds(ctx.user.parent_id).map((id) => studentCard(id)),
}));

// ---------- student overview (parent & student dashboards, teacher/admin profile view) ----------
api.get('/api/students/:id/overview', requireAuth, (ctx) => {
  const sid = +ctx.params.id;
  assertStudent(ctx.user, sid);
  const t = today();
  const card = studentCard(sid);
  const month = t.slice(0, 7);
  const year = currentYear(ctx.user.school_id);
  const monthRows = all(`SELECT status, COUNT(*) n FROM attendance WHERE student_id=? AND date LIKE ? GROUP BY status`, sid, `${month}%`);
  const yearRows = all(`SELECT status, COUNT(*) n FROM attendance WHERE student_id=? AND date BETWEEN ? AND ? GROUP BY status`, sid, year?.start_date || '0000', year?.end_date || '9999');
  const todayAtt = get('SELECT status, remarks FROM attendance WHERE student_id=? AND date=?', sid, t);
  const recent = all('SELECT date, status, remarks FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 14', sid);
  const monthly = all(`SELECT substr(date,1,7) AS month, SUM(status IN ('present','late')) + SUM(status='half_day')*0.5 AS attended, COUNT(*) total
                       FROM attendance WHERE student_id=? AND date BETWEEN ? AND ? GROUP BY month ORDER BY month`, sid, year?.start_date || '0000', year?.end_date || '9999')
    .map((m) => ({ ...m, percentage: pct(m.attended, m.total) }));
  const hw = studentHomework(sid, { from: addDays(t, -21), to: addDays(t, 30) });
  const remarks = all(`SELECT r.id, r.category, r.remark, r.created_at, u.full_name AS author FROM student_remarks r JOIN users u ON u.id=r.author_user_id
                       WHERE r.student_id=? AND r.deleted_at IS NULL ${['parent', 'student'].includes(ctx.user.role) ? 'AND r.visible_to_parent=1' : ''} ORDER BY r.id DESC LIMIT 10`, sid);
  const upcoming = all(`SELECT * FROM school_calendar WHERE school_id=? AND deleted_at IS NULL AND end_date >= ? AND (division_id IS NULL OR division_id=?) ORDER BY start_date LIMIT 6`,
    ctx.user.school_id, t, card.division_id);
  const holidays = all('SELECT * FROM holidays WHERE school_id=? AND date >= ? ORDER BY date LIMIT 4', ctx.user.school_id, t);
  return {
    student: card, date: t, today: todayAtt || null,
    month: summarize(monthRows), year: summarize(yearRows), recent, monthly,
    homework_today: hw.filter((h) => h.homework_date === t),
    pending: hw.filter((h) => ['pending', 'overdue'].includes(h.student_status)).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    homework_counts: hw.reduce((a, h) => ({ ...a, [h.student_status]: (a[h.student_status] || 0) + 1 }), {}),
    remarks, upcoming, holidays, announcements: visibleAnnouncements(ctx.user, 5),
  };
});

// ---------- remarks ----------
api.get('/api/students/:id/remarks', requireAuth, (ctx) => {
  const sid = +ctx.params.id;
  assertStudent(ctx.user, sid);
  const hidden = ['parent', 'student'].includes(ctx.user.role) ? 'AND r.visible_to_parent=1' : '';
  return { rows: all(`SELECT r.*, u.full_name AS author FROM student_remarks r JOIN users u ON u.id=r.author_user_id WHERE r.student_id=? AND r.deleted_at IS NULL ${hidden} ORDER BY r.id DESC`, sid) };
});
api.post('/api/students/:id/remarks', requireRole('admin', 'teacher'), (ctx) => {
  const sid = +ctx.params.id;
  assertStudent(ctx.user, sid);
  const v = validate(ctx.body, { remark: { type: 'text', required: true, max: 1000 }, category: { type: 'string', enum: ['general', 'academic', 'behaviour', 'appreciation'] }, visible_to_parent: { type: 'bool' } });
  const vis = ctx.body.visible_to_parent === undefined ? 1 : v.visible_to_parent;
  const { id } = run('INSERT INTO student_remarks (student_id, author_user_id, category, remark, visible_to_parent) VALUES (?,?,?,?,?)', sid, ctx.user.id, v.category || 'general', v.remark, vis);
  if (vis) {
    const s = get('SELECT full_name FROM students WHERE id=?', sid);
    notifyUsers(studentAudience(sid).parentUserIds, { type: 'remark', title: `New teacher remark for ${s.full_name}`, body: v.remark.slice(0, 140), link: '#/remarks', refKey: `rem:${id}` });
  }
  audit(ctx, 'create', 'student_remark', id, { student_id: sid });
  return get('SELECT * FROM student_remarks WHERE id=?', id);
});
api.del('/api/remarks/:id', requireRole('admin', 'teacher'), (ctx) => {
  const r = get('SELECT * FROM student_remarks WHERE id=? AND deleted_at IS NULL', +ctx.params.id);
  if (!r) throw notFound();
  if (ctx.user.role !== 'admin' && r.author_user_id !== ctx.user.id) throw forbidden('You can only delete your own remarks');
  run(`UPDATE student_remarks SET deleted_at=datetime('now') WHERE id=?`, r.id);
  audit(ctx, 'delete', 'student_remark', r.id);
  return { ok: true };
});

export { studentCard, isDate };
