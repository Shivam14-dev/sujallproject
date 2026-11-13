import { config } from './config.js';
import { run, get } from './db.js';
import { bad } from './http.js';

// ---------- dates (school-local) ----------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => fmt.format(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayOfWeek = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
export const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]; };
export function eachDay(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// ---------- validation ----------
/**
 * validate(input, schema) — schema: { field: { type, required, max, min, enum, pattern, label } }
 * types: string | int | bool | date | email | phone | id | text
 * Returns a clean object containing only declared fields. Throws 400 with field errors.
 */
export function validate(input = {}, schema) {
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key.replace(/_/g, ' ');
    let v = input[key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (rule.required) errors[key] = `${label} is required`;
      else if (key in input) out[key] = rule.type === 'bool' ? 0 : null;
      continue;
    }
    switch (rule.type) {
      case 'int': case 'id': {
        const n = Number(v);
        if (!Number.isInteger(n) || (rule.type === 'id' && n <= 0)) { errors[key] = `${label} must be a whole number`; continue; }
        if (rule.min !== undefined && n < rule.min) { errors[key] = `${label} must be at least ${rule.min}`; continue; }
        if (rule.max !== undefined && n > rule.max) { errors[key] = `${label} must be at most ${rule.max}`; continue; }
        v = n; break;
      }
      case 'bool': v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0; break;
      case 'date': if (!isDate(v)) { errors[key] = `${label} must be a valid date (YYYY-MM-DD)`; continue; } break;
      case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || v.length > 120) { errors[key] = `${label} must be a valid email`; continue; } v = v.toLowerCase(); break;
      case 'phone': v = String(v).replace(/[\s-]/g, ''); if (!/^\+?\d{10,13}$/.test(v)) { errors[key] = `${label} must be a valid phone number (10–13 digits)`; continue; } break;
      default: {
        v = String(v);
        const max = rule.max ?? (rule.type === 'text' ? 5000 : 200);
        if (v.length > max) { errors[key] = `${label} must be at most ${max} characters`; continue; }
        if (rule.min && v.length < rule.min) { errors[key] = `${label} must be at least ${rule.min} characters`; continue; }
        if (rule.pattern && !rule.pattern.test(v)) { errors[key] = rule.patternMsg || `${label} has an invalid format`; continue; }
      }
    }
    if (rule.enum && !rule.enum.includes(v)) { errors[key] = `${label} must be one of: ${rule.enum.join(', ')}`; continue; }
    out[key] = v;
  }
  if (Object.keys(errors).length) throw bad(Object.values(errors)[0], errors);
  return out;
}

export function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) throw bad('Password must be 8–128 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain letters and numbers');
}

// ---------- audit ----------
export function audit(ctx, action, entity, entityId, details) {
  run(
    'INSERT INTO audit_logs (school_id, user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)',
    ctx.user?.school_id, ctx.user?.id, action, entity, entityId ?? null,
    details ? JSON.stringify(details).slice(0, 4000) : null, ctx.ip,
  );
}

export function currentYear(schoolId) {
  return get('SELECT * FROM academic_years WHERE school_id = ? AND is_current = 1', schoolId)
    || get('SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC LIMIT 1', schoolId);
}

export function schoolSettings(schoolId) {
  const s = get('SELECT settings FROM schools WHERE id = ?', schoolId);
  const defaults = { teacher_edit_window_days: 3, notify_absent: true, notify_homework: true, whatsapp_enabled: false, email_enabled: false, sms_enabled: false, low_attendance_threshold: 75 };
  try { return { ...defaults, ...JSON.parse(s?.settings || '{}') }; } catch { return defaults; }
}

export const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
export const page = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 500);
  const p = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (p - 1) * limit, page: p };
};
