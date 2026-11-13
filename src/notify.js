// Notification service: in-app notifications + an outbox for Email / WhatsApp / SMS.
// External providers are configured via environment variables only — never hardcoded.
import { all, get, run } from './db.js';
import { config } from './config.js';
import { schoolSettings, today, addDays } from './util.js';

export function notifyUsers(userIds, { type, title, body, link, refKey }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const uid of ids) {
    run(`INSERT INTO notifications (user_id, type, title, body, link, ref_key) VALUES (?,?,?,?,?,?)
         ON CONFLICT DO NOTHING`, uid, type, title, body || null, link || null, refKey ? `${refKey}` : null);
  }
  return ids.length;
}

export function enqueue(channel, recipient, message, subject) {
  if (!recipient) return;
  run('INSERT INTO notification_outbox (channel, recipient, subject, message) VALUES (?,?,?,?)', channel, recipient, subject || null, message);
}

/** Users (parent accounts + student account) who should hear about a student. */
export function studentAudience(studentId) {
  const parents = all(`SELECT p.user_id, p.phone, p.email FROM student_parent_mapping m JOIN parents p ON p.id = m.parent_id
                       WHERE m.student_id = ? AND p.deleted_at IS NULL`, studentId);
  const st = get('SELECT user_id, parent_phone, parent_email FROM students WHERE id = ?', studentId);
  return {
    userIds: [...parents.map((p) => p.user_id), st?.user_id],
    parentUserIds: parents.map((p) => p.user_id),
    phones: [...new Set([...parents.map((p) => p.phone), st?.parent_phone].filter(Boolean))],
    emails: [...new Set([...parents.map((p) => p.email), st?.parent_email].filter(Boolean))],
  };
}

export function notifyAbsent(schoolId, student, date, status) {
  const s = schoolSettings(schoolId);
  if (!s.notify_absent) return;
  const aud = studentAudience(student.id);
  const label = status === 'absent' ? 'absent' : status === 'late' ? 'late' : 'on half day';
  const title = `${student.full_name} was marked ${label}`;
  const body = `Attendance for ${date}: ${label.toUpperCase()}${student.remarks ? ` — ${student.remarks}` : ''}`;
  notifyUsers(aud.parentUserIds, { type: 'attendance', title, body, link: '#/attendance', refKey: `att:${student.id}:${date}:${status}` });
  if (status === 'absent') {
    const msg = `Dear Parent, ${student.full_name} was marked ABSENT on ${date}. Please contact the class teacher if this is unexpected.`;
    if (s.whatsapp_enabled) aud.phones.forEach((p) => enqueue('whatsapp', p, msg));
    if (s.sms_enabled) aud.phones.forEach((p) => enqueue('sms', p, msg));
    if (s.email_enabled) aud.emails.forEach((e) => enqueue('email', e, msg, 'Absence notification'));
  }
}

export function homeworkAudience(homeworkId) {
  const hw = get('SELECT * FROM homework WHERE id = ?', homeworkId);
  if (!hw) return [];
  const students = hw.assign_to === 'selected'
    ? all('SELECT student_id AS id FROM homework_assignments WHERE homework_id = ?', homeworkId)
    : all(`SELECT id FROM students WHERE division_id = ? AND status = 'active' AND deleted_at IS NULL`, hw.division_id);
  return students.map((s) => s.id);
}

export function notifyHomework(schoolId, homeworkId, subjectName) {
  const s = schoolSettings(schoolId);
  if (!s.notify_homework) return;
  const hw = get('SELECT * FROM homework WHERE id = ?', homeworkId);
  for (const sid of homeworkAudience(homeworkId)) {
    const aud = studentAudience(sid);
    notifyUsers(aud.userIds, {
      type: 'homework', title: `New ${subjectName} homework: ${hw.title}`,
      body: `Due ${hw.due_date}`, link: `#/homework/${homeworkId}`, refKey: `hw:${homeworkId}`,
    });
  }
}

export function audienceUserIds(schoolId, audience, divisionId) {
  const roleFilter = { all: ['teacher', 'parent', 'student', 'admin'], teachers: ['teacher', 'admin'], parents: ['parent'], students: ['student'] }[audience] || [];
  if (divisionId) {
    const ids = [];
    const studs = all(`SELECT id, user_id FROM students WHERE division_id = ? AND deleted_at IS NULL AND status='active'`, divisionId);
    for (const st of studs) {
      if (roleFilter.includes('student')) ids.push(st.user_id);
      if (roleFilter.includes('parent')) ids.push(...studentAudience(st.id).parentUserIds);
    }
    if (roleFilter.includes('teacher')) {
      ids.push(...all(`SELECT t.user_id FROM teachers t WHERE t.id IN (SELECT class_teacher_id FROM divisions WHERE id = ?
                       UNION SELECT teacher_id FROM teacher_assignments WHERE division_id = ?)`, divisionId, divisionId).map((r) => r.user_id));
    }
    return ids;
  }
  const marks = roleFilter.map(() => '?').join(',');
  return all(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.school_id = ? AND u.status='active' AND u.deleted_at IS NULL AND r.name IN (${marks})`,
    schoolId, ...roleFilter).map((r) => r.id);
}

export function notifyAnnouncement(schoolId, ann, authorId) {
  const ids = audienceUserIds(schoolId, ann.audience, ann.division_id).filter((id) => id !== authorId);
  notifyUsers(ids, {
    type: ann.is_important ? 'notice' : 'announcement',
    title: (ann.is_important ? 'Important notice: ' : 'Announcement: ') + ann.title,
    body: ann.body.slice(0, 160), link: '#/announcements', refKey: `ann:${ann.id}`,
  });
}

/** Hourly job: remind about homework due tomorrow (deduplicated by ref_key). */
export function runDeadlineReminders() {
  const tomorrow = addDays(today(), 1);
  const hws = all(`SELECT h.*, s.name AS subject_name FROM homework h JOIN subjects s ON s.id = h.subject_id
                   WHERE h.due_date = ? AND h.deleted_at IS NULL`, tomorrow);
  let sent = 0;
  for (const hw of hws) {
    for (const sid of homeworkAudience(hw.id)) {
      if (get('SELECT 1 FROM homework_submissions WHERE homework_id = ? AND student_id = ?', hw.id, sid)) continue;
      sent += notifyUsers(studentAudience(sid).userIds, {
        type: 'deadline', title: `Homework due tomorrow: ${hw.title}`, body: `${hw.subject_name} — due ${hw.due_date}`,
        link: `#/homework/${hw.id}`, refKey: `due:${hw.id}`,
      });
    }
  }
  return sent;
}

// ---------- outbox dispatcher ----------
async function deliver(item) {
  const provider = item.channel === 'email' ? config.email : item.channel === 'whatsapp' ? config.whatsapp : config.sms;
  if (provider.provider === 'none') return { status: 'skipped', error: `${item.channel} provider not configured` };
  if (provider.provider === 'console') { console.log(`[${item.channel}] → ${item.recipient}: ${item.message}`); return { status: 'sent' }; }
  let url, headers = { 'Content-Type': 'application/json' }, body;
  if (item.channel === 'whatsapp' && provider.provider === 'cloud-api') {
    url = `${provider.apiUrl.replace(/\/$/, '')}/${provider.phoneNumberId}/messages`;
    headers.Authorization = `Bearer ${provider.token}`;
    body = { messaging_product: 'whatsapp', to: item.recipient.replace(/^\+/, ''), type: 'text', text: { body: item.message } };
  } else {
    url = provider.webhookUrl || provider.apiUrl;
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { to: item.recipient, subject: item.subject, message: item.message, from: provider.from };
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return r.ok ? { status: 'sent' } : { status: 'failed', error: `HTTP ${r.status}` };
}

export async function flushOutbox(limit = 25) {
  const items = all(`SELECT * FROM notification_outbox WHERE status = 'pending' AND attempts < 3 ORDER BY id LIMIT ?`, limit);
  for (const it of items) {
    let res;
    try { res = await deliver(it); } catch (e) { res = { status: 'failed', error: e.message }; }
    const status = res.status === 'failed' && it.attempts + 1 < 3 ? 'pending' : res.status;
    run(`UPDATE notification_outbox SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') END WHERE id = ?`,
      status, res.error || null, res.status, it.id);
  }
  return items.length;
}
