import crypto from 'node:crypto';
import { get, all, run } from './db.js';
import { config } from './config.js';
import { HttpError, forbidden } from './http.js';

// ---------- passwords (scrypt) ----------
const N = 16384, R = 8, P = 1, KEYLEN = 64;
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

// ---------- sessions ----------
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)',
    sha(token), userId, req.socket.remoteAddress, String(req.headers['user-agent'] || '').slice(0, 250), expires);
  return { token, expires };
}
export function destroySession(token) { if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token)); }
export function cookieHeader(token, expires) {
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (config.cookieSecure) parts.push('Secure');
  parts.push(token ? `Expires=${new Date(expires).toUTCString()}` : 'Max-Age=0');
  return parts.join('; ');
}
export function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function loadUser(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  const u = get(`
    SELECT u.id, u.school_id, u.username, u.full_name, u.email, u.phone, u.must_change_password, r.name AS role
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active' AND u.deleted_at IS NULL`,
    sha(token), new Date().toISOString());
  if (!u) return null;
  u.token = token;
  if (u.role === 'teacher') u.teacher_id = get('SELECT id FROM teachers WHERE user_id = ? AND deleted_at IS NULL', u.id)?.id ?? null;
  if (u.role === 'parent') u.parent_id = get('SELECT id FROM parents WHERE user_id = ? AND deleted_at IS NULL', u.id)?.id ?? null;
  if (u.role === 'student') u.student_id = get('SELECT id FROM students WHERE user_id = ? AND deleted_at IS NULL', u.id)?.id ?? null;
  return u;
}

// login attempt throttling (in-memory, per username+ip)
const attempts = new Map();
export function checkThrottle(key) {
  const a = attempts.get(key);
  if (a && a.lockedUntil > Date.now()) {
    const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute(s).`);
  }
}
export function recordFailure(key) {
  const a = attempts.get(key) || { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= 5) { a.lockedUntil = Date.now() + 10 * 60000; a.count = 0; }
  attempts.set(key, a);
}
export const clearFailures = (key) => attempts.delete(key);

export function authenticate(username, password) {
  const u = get(`SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
                 WHERE u.username = ? AND u.deleted_at IS NULL`, String(username || '').trim());
  if (!u) { verifyPassword(password, DUMMY_HASH); return null; }
  if (!verifyPassword(password, u.password_hash)) return null;
  if (u.status !== 'active') throw new HttpError(403, 'This account is inactive. Please contact the school office.');
  return u;
}

// ---------- guards ----------
export const requireAuth = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Please sign in'); };
export const requireRole = (...roles) => (ctx) => {
  requireAuth(ctx);
  if (!roles.includes(ctx.user.role)) throw forbidden();
};

// ---------- data-scope helpers ----------
/** Divisions a teacher can work with. classTeacherOnly → only divisions where they are class teacher. */
export function teacherDivisionIds(teacherId, classTeacherOnly = false) {
  if (!teacherId) return [];
  const ct = all('SELECT id FROM divisions WHERE class_teacher_id = ? AND deleted_at IS NULL', teacherId).map((r) => r.id);
  if (classTeacherOnly) return ct;
  const sub = all('SELECT DISTINCT division_id AS id FROM teacher_assignments WHERE teacher_id = ?', teacherId).map((r) => r.id);
  return [...new Set([...ct, ...sub])];
}
export function canAccessDivision(user, divisionId, { classTeacherOnly = false } = {}) {
  if (user.role === 'admin') return !!get(`SELECT d.id FROM divisions d JOIN classes c ON c.id = d.class_id WHERE d.id = ? AND c.school_id = ?`, divisionId, user.school_id);
  if (user.role === 'teacher') return teacherDivisionIds(user.teacher_id, classTeacherOnly).includes(Number(divisionId));
  return false;
}
export function assertDivision(user, divisionId, opts) {
  if (!canAccessDivision(user, divisionId, opts)) {
    throw forbidden(opts?.classTeacherOnly ? 'Only the class teacher of this division (or an admin) can do this' : 'You are not assigned to this class');
  }
}
export function parentStudentIds(parentId) {
  if (!parentId) return [];
  return all(`SELECT m.student_id AS id FROM student_parent_mapping m JOIN students s ON s.id = m.student_id
              WHERE m.parent_id = ? AND s.deleted_at IS NULL`, parentId).map((r) => r.id);
}
/** Who may VIEW a student's records. */
export function canViewStudent(user, studentId) {
  studentId = Number(studentId);
  const s = get('SELECT id, school_id, division_id FROM students WHERE id = ? AND deleted_at IS NULL', studentId);
  if (!s || s.school_id !== user.school_id) return false;
  switch (user.role) {
    case 'admin': return true;
    case 'teacher': return s.division_id != null && teacherDivisionIds(user.teacher_id).includes(s.division_id);
    case 'parent': return parentStudentIds(user.parent_id).includes(studentId);
    case 'student': return user.student_id === studentId;
    default: return false;
  }
}
export function assertStudent(user, studentId) {
  if (!canViewStudent(user, studentId)) throw forbidden('You can only view records of students linked to your account');
}
