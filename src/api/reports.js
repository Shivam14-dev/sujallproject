// Reports with JSON preview and PDF / Excel / CSV export.
import { api, bad, forbidden, sendFile } from '../http.js';
import { all, get } from '../db.js';
import { requireRole, assertDivision, teacherDivisionIds, assertStudent } from '../auth.js';
import { validate, today, addDays, monthRange, eachDay, isMonth, pct, schoolSettings, audit, currentYear } from '../util.js';
import { toXlsx, toPdf, toCsv } from '../export.js';
import { homeworkAudience } from '../notify.js';

const L = { present: 'P', absent: 'A', late: 'L', half_day: 'H' };
const label = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day' };

function scopeDivisions(user, divisionId) {
  if (divisionId) { assertDivision(user, divisionId); return [divisionId]; }
  if (user.role === 'teacher') return teacherDivisionIds(user.teacher_id);
  return null; // all
}
const inList = (ids) => (ids === null ? '1=1' : `d.id IN (${ids.join(',') || 0})`);
function divLabel(id) { return get(`SELECT c.name || '-' || d.name AS l FROM divisions d JOIN classes c ON c.id=d.class_id WHERE d.id=?`, id)?.l || ''; }
function range(q, defDays = 30) {
  const t = today();
  const v = validate({ from: q.from || addDays(t, -defDays), to: q.to || t }, { from: { type: 'date', required: true }, to: { type: 'date', required: true } });
  if (v.to < v.from) throw bad('"To" date must be on or after "From" date');
  if (eachDay(v.from, v.to).length > 400) throw bad('Date range is too long (max ~13 months)');
  return v;
}

const REPORTS = {
  'daily-attendance': {
    title: 'Daily Attendance Report',
    build(user, q) {
      const date = validate({ date: q.date || today() }, { date: { type: 'date', required: true } }).date;
      const divs = scopeDivisions(user, q.division_id ? +q.division_id : null);
      const rows = all(`SELECT c.name || '-' || d.name AS division, s.roll_no, s.admission_no, s.full_name, a.status, a.remarks, u.full_name AS marked_by
          FROM students s JOIN divisions d ON d.id=s.division_id JOIN classes c ON c.id=d.class_id
          LEFT JOIN attendance a ON a.student_id=s.id AND a.date=? LEFT JOIN users u ON u.id=a.marked_by
          WHERE s.school_id=? AND s.status='active' AND s.deleted_at IS NULL AND ${inList(divs)} ORDER BY c.sort_order, d.name, s.roll_no`, date, user.school_id)
        .map((r) => ({ ...r, status: r.status ? label[r.status] : 'Not marked' }));
      const c = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
      return {
        subtitle: `Date: ${date}${q.division_id ? ` | Class ${divLabel(+q.division_id)}` : ''} | Present ${c.Present || 0}, Absent ${c.Absent || 0}, Late ${c.Late || 0}, Half Day ${c['Half Day'] || 0}, Not marked ${c['Not marked'] || 0}`,
        columns: [{ key: 'division', label: 'Class' }, { key: 'roll_no', label: 'Roll' }, { key: 'admission_no', label: 'Adm. No' }, { key: 'full_name', label: 'Student' }, { key: 'status', label: 'Status' }, { key: 'remarks', label: 'Remarks' }, { key: 'marked_by', label: 'Marked by' }],
        rows,
      };
    },
  },
  'monthly-attendance': {
    title: 'Monthly Attendance Register',
    build(user, q) {
      if (!q.division_id) throw bad('Select a class & division');
      const month = isMonth(q.month) ? q.month : today().slice(0, 7);
      const [from, to] = monthRange(month);
      assertDivision(user, +q.division_id);
      const days = eachDay(from, to);
      const marked = new Set(all('SELECT DISTINCT date FROM attendance WHERE division_id=? AND date BETWEEN ? AND ?', +q.division_id, from, to).map((r) => r.date));
      const workDays = days.filter((d) => marked.has(d));
      const studs = all(`SELECT id, roll_no, full_name FROM students WHERE division_id=? AND status='active' AND deleted_at IS NULL ORDER BY roll_no`, +q.division_id);
      const att = all('SELECT student_id, date, status FROM attendance WHERE division_id=? AND date BETWEEN ? AND ?', +q.division_id, from, to);
      const map = new Map(att.map((a) => [`${a.student_id}|${a.date}`, a.status]));
      const rows = studs.map((s) => {
        const r = { roll_no: s.roll_no, full_name: s.full_name };
        let p = 0, a = 0, l = 0, h = 0;
        for (const d of workDays) { const st = map.get(`${s.id}|${d}`); r[d] = st ? L[st] : '-'; if (st === 'present') p++; if (st === 'absent') a++; if (st === 'late') l++; if (st === 'half_day') h++; }
        const tot = p + a + l + h;
        return { ...r, present: p + l, absent: a, half: h, pct: pct(p + l + h * 0.5, tot) + '%' };
      });
      return {
        subtitle: `Class ${divLabel(+q.division_id)} | ${month} | Working days: ${workDays.length} | P=Present A=Absent L=Late H=Half day`,
        columns: [{ key: 'roll_no', label: 'Roll' }, { key: 'full_name', label: 'Student' }, ...workDays.map((d) => ({ key: d, label: d.slice(8) })),
          { key: 'present', label: 'P' }, { key: 'absent', label: 'A' }, { key: 'half', label: 'H' }, { key: 'pct', label: '%' }],
        rows,
      };
    },
  },
  'student-attendance': {
    title: 'Student Attendance Report',
    build(user, q) {
      if (!q.student_id) throw bad('Select a student');
      assertStudent(user, +q.student_id);
      const { from, to } = range(q, 90);
      const s = get(`SELECT s.full_name, s.admission_no, c.name || '-' || d.name AS division FROM students s LEFT JOIN divisions d ON d.id=s.division_id LEFT JOIN classes c ON c.id=d.class_id WHERE s.id=?`, +q.student_id);
      const rows = all('SELECT date, status, remarks FROM attendance WHERE student_id=? AND date BETWEEN ? AND ? ORDER BY date', +q.student_id, from, to);
      const c = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
      const p = pct((c.present || 0) + (c.late || 0) + (c.half_day || 0) * 0.5, rows.length);
      return {
        subtitle: `${s.full_name} (${s.admission_no}) | Class ${s.division} | ${from} to ${to} | Days ${rows.length}, Present ${c.present || 0}, Absent ${c.absent || 0}, Late ${c.late || 0}, Half ${c.half_day || 0} | ${p}%`,
        columns: [{ key: 'date', label: 'Date' }, { key: 'day', label: 'Day' }, { key: 'status', label: 'Status' }, { key: 'remarks', label: 'Remarks' }],
        rows: rows.map((r) => ({ ...r, day: new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }), status: label[r.status] })),
      };
    },
  },
  'class-attendance': {
    title: 'Class-wise Attendance Report',
    build(user, q) {
      const { from, to } = range(q);
      const divs = scopeDivisions(user, null);
      const rows = all(`SELECT c.name || '-' || d.name AS division, t.full_name AS class_teacher,
            (SELECT COUNT(*) FROM students s WHERE s.division_id=d.id AND s.status='active' AND s.deleted_at IS NULL) AS students,
            COUNT(DISTINCT a.date) AS days, SUM(a.status='present') AS present, SUM(a.status='absent') AS absent, SUM(a.status='late') AS late, SUM(a.status='half_day') AS half_day, COUNT(a.id) AS total
          FROM divisions d JOIN classes c ON c.id=d.class_id LEFT JOIN teachers t ON t.id=d.class_teacher_id
          LEFT JOIN attendance a ON a.division_id=d.id AND a.date BETWEEN ? AND ?
          WHERE c.school_id=? AND c.academic_year_id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND ${inList(divs)}
          GROUP BY d.id ORDER BY c.sort_order, d.name`, from, to, user.school_id, currentYear(user.school_id)?.id)
        .map((r) => ({ ...r, present: r.present || 0, absent: r.absent || 0, late: r.late || 0, half_day: r.half_day || 0, percentage: pct((r.present || 0) + (r.late || 0) + (r.half_day || 0) * 0.5, r.total) }));
      return {
        subtitle: `${from} to ${to}`,
        columns: [{ key: 'division', label: 'Class' }, { key: 'class_teacher', label: 'Class teacher' }, { key: 'students', label: 'Students' }, { key: 'days', label: 'Days marked' },
          { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'late', label: 'Late' }, { key: 'half_day', label: 'Half day' }, { key: 'percentage', label: 'Attendance %' }],
        rows,
      };
    },
  },
  absentee: {
    title: 'Student Absentee Report',
    build(user, q) {
      const { from, to } = range(q);
      const divs = scopeDivisions(user, q.division_id ? +q.division_id : null);
      const threshold = Number(q.threshold) || schoolSettings(user.school_id).low_attendance_threshold;
      const rows = all(`SELECT c.name || '-' || d.name AS division, s.roll_no, s.full_name, s.parent_name, s.parent_phone,
            COUNT(a.id) AS days, SUM(a.status='absent') AS absent, SUM(a.status='late') AS late,
            ROUND(100.0 * (SUM(a.status IN ('present','late')) + SUM(a.status='half_day')*0.5) / COUNT(a.id), 1) AS percentage,
            (SELECT GROUP_CONCAT(substr(a2.date,6), ' ') FROM (SELECT date FROM attendance WHERE student_id=s.id AND status='absent' AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT 8) a2) AS absent_dates
          FROM students s JOIN divisions d ON d.id=s.division_id JOIN classes c ON c.id=d.class_id JOIN attendance a ON a.student_id=s.id AND a.date BETWEEN ? AND ?
          WHERE s.school_id=? AND s.status='active' AND s.deleted_at IS NULL AND ${inList(divs)}
          GROUP BY s.id HAVING absent > 0 AND percentage < ? ORDER BY percentage, absent DESC`, from, to, from, to, user.school_id, threshold);
      return {
        subtitle: `${from} to ${to} | Students below ${threshold}% attendance with at least one absence`,
        columns: [{ key: 'division', label: 'Class' }, { key: 'roll_no', label: 'Roll' }, { key: 'full_name', label: 'Student' }, { key: 'days', label: 'Days' }, { key: 'absent', label: 'Absent' },
          { key: 'late', label: 'Late' }, { key: 'percentage', label: '%' }, { key: 'absent_dates', label: 'Recent absences (MM-DD)' }, { key: 'parent_name', label: 'Parent' }, { key: 'parent_phone', label: 'Phone' }],
        rows,
      };
    },
  },
  'homework-assigned': {
    title: 'Homework Assigned Report',
    build(user, q) {
      const { from, to } = range(q);
      const divs = scopeDivisions(user, q.division_id ? +q.division_id : null);
      const rows = all(`SELECT h.id, h.homework_date, h.due_date, c.name || '-' || d.name AS division, s.name AS subject, h.title, t.full_name AS teacher, h.assign_to,
            (SELECT COUNT(*) FROM homework_attachments x WHERE x.homework_id=h.id) AS attachments
          FROM homework h JOIN divisions d ON d.id=h.division_id JOIN classes c ON c.id=d.class_id JOIN subjects s ON s.id=h.subject_id LEFT JOIN teachers t ON t.id=h.teacher_id
          WHERE h.school_id=? AND h.deleted_at IS NULL AND h.homework_date BETWEEN ? AND ? AND ${inList(divs)} ${q.subject_id ? 'AND h.subject_id=' + Number(q.subject_id) : ''}
          ORDER BY h.homework_date DESC, c.sort_order, d.name`, user.school_id, from, to)
        .map((r) => ({ ...r, assign_to: r.assign_to === 'class' ? 'Whole class' : 'Selected students' }));
      return {
        subtitle: `${from} to ${to} | ${rows.length} homework entries`,
        columns: [{ key: 'homework_date', label: 'Date' }, { key: 'due_date', label: 'Due' }, { key: 'division', label: 'Class' }, { key: 'subject', label: 'Subject' }, { key: 'title', label: 'Title' },
          { key: 'teacher', label: 'Teacher' }, { key: 'assign_to', label: 'Assigned to' }, { key: 'attachments', label: 'Files' }],
        rows,
      };
    },
  },
  'homework-submission': {
    title: 'Homework Submission Report',
    build(user, q) {
      const { from, to } = range(q);
      const divs = scopeDivisions(user, q.division_id ? +q.division_id : null);
      const t = today();
      const hws = all(`SELECT h.id, h.homework_date, h.due_date, c.name || '-' || d.name AS division, s.name AS subject, h.title
          FROM homework h JOIN divisions d ON d.id=h.division_id JOIN classes c ON c.id=d.class_id JOIN subjects s ON s.id=h.subject_id
          WHERE h.school_id=? AND h.deleted_at IS NULL AND h.homework_date BETWEEN ? AND ? AND ${inList(divs)} ORDER BY h.homework_date DESC`, user.school_id, from, to);
      const rows = hws.map((h) => {
        const assigned = homeworkAudience(h.id).length;
        const sub = get(`SELECT COUNT(*) n, SUM(status='reviewed') r, SUM(substr(submitted_at,1,10) > ?) late FROM homework_submissions WHERE homework_id=?`, h.due_date, h.id);
        const pending = assigned - sub.n;
        return { ...h, assigned, submitted: sub.n, reviewed: sub.r || 0, late: sub.late || 0, pending, overdue: h.due_date < t ? pending : 0, rate: pct(sub.n, assigned) + '%' };
      });
      return {
        subtitle: `${from} to ${to}`,
        columns: [{ key: 'homework_date', label: 'Date' }, { key: 'due_date', label: 'Due' }, { key: 'division', label: 'Class' }, { key: 'subject', label: 'Subject' }, { key: 'title', label: 'Title' },
          { key: 'assigned', label: 'Assigned' }, { key: 'submitted', label: 'Submitted' }, { key: 'reviewed', label: 'Reviewed' }, { key: 'late', label: 'Late' }, { key: 'overdue', label: 'Overdue' }, { key: 'rate', label: 'Rate' }],
        rows,
      };
    },
  },
  'teacher-activity': {
    title: 'Teacher Activity Report',
    adminOnly: true,
    build(user, q) {
      const { from, to } = range(q);
      const rows = all(`SELECT t.teacher_code, t.full_name, u.last_login_at,
            (SELECT GROUP_CONCAT(c.name || '-' || d.name, ', ') FROM divisions d JOIN classes c ON c.id=d.class_id WHERE d.class_teacher_id=t.id AND d.deleted_at IS NULL) AS class_teacher_of,
            (SELECT COUNT(DISTINCT a.division_id || a.date) FROM attendance a WHERE a.marked_by=t.user_id AND a.date BETWEEN ? AND ?) AS attendance_sheets,
            (SELECT COUNT(*) FROM homework h WHERE h.teacher_id=t.id AND h.deleted_at IS NULL AND h.homework_date BETWEEN ? AND ?) AS homework_given,
            (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.reviewed_by=t.user_id AND substr(hs.reviewed_at,1,10) BETWEEN ? AND ?) AS submissions_reviewed,
            (SELECT COUNT(*) FROM student_remarks r WHERE r.author_user_id=t.user_id AND substr(r.created_at,1,10) BETWEEN ? AND ?) AS remarks,
            (SELECT COUNT(*) FROM announcements an WHERE an.published_by=t.user_id AND substr(an.published_at,1,10) BETWEEN ? AND ?) AS announcements
          FROM teachers t LEFT JOIN users u ON u.id=t.user_id WHERE t.school_id=? AND t.deleted_at IS NULL ORDER BY t.full_name`,
      from, to, from, to, from, to, from, to, from, to, user.school_id);
      return {
        subtitle: `${from} to ${to}`,
        columns: [{ key: 'teacher_code', label: 'ID' }, { key: 'full_name', label: 'Teacher' }, { key: 'class_teacher_of', label: 'Class teacher of' }, { key: 'attendance_sheets', label: 'Attendance sheets' },
          { key: 'homework_given', label: 'Homework given' }, { key: 'submissions_reviewed', label: 'Reviewed' }, { key: 'remarks', label: 'Remarks' }, { key: 'announcements', label: 'Announcements' }, { key: 'last_login_at', label: 'Last login' }],
        rows,
      };
    },
  },
};

api.get('/api/reports', requireRole('admin', 'teacher'), (ctx) => ({
  rows: Object.entries(REPORTS).filter(([, r]) => !r.adminOnly || ctx.user.role === 'admin').map(([key, r]) => ({ key, title: r.title })),
}));

api.get('/api/reports/:type', requireRole('admin', 'teacher'), (ctx) => {
  const def = REPORTS[ctx.params.type];
  if (!def) throw bad('Unknown report');
  if (def.adminOnly && ctx.user.role !== 'admin') throw forbidden();
  const built = def.build(ctx.user, ctx.query);
  const report = { title: def.title, ...built };
  const fmt = ctx.query.format || 'json';
  if (fmt === 'json') return { ...report, rows: report.rows.slice(0, 2000), total_rows: report.rows.length };
  const school = get('SELECT name FROM schools WHERE id=?', ctx.user.school_id)?.name;
  const base = `${ctx.params.type}_${today()}`;
  audit(ctx, 'export', 'report', null, { type: ctx.params.type, format: fmt, rows: report.rows.length });
  if (fmt === 'xlsx') sendFile(ctx.res, { buffer: toXlsx({ ...report, title: report.title, subtitle: [school, report.subtitle].filter(Boolean).join(' | ') }), filename: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  else if (fmt === 'pdf') sendFile(ctx.res, { buffer: toPdf(report, { schoolName: school }), filename: `${base}.pdf`, mime: 'application/pdf' });
  else if (fmt === 'csv') sendFile(ctx.res, { buffer: Buffer.from(toCsv(report), 'utf8'), filename: `${base}.csv`, mime: 'text/csv; charset=utf-8' });
  else throw bad('Format must be json, xlsx, pdf or csv');
  return ctx.SENT;
});
