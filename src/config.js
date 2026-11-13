import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = process.env;
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  nodeEnv: env.NODE_ENV || 'development',
  dbPath: abs(env.DB_PATH || 'data/school.db'),
  uploadDir: abs(env.UPLOAD_DIR || 'uploads'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 10),
  sessionDays: Number(env.SESSION_DAYS || 7),
  cookieSecure: env.COOKIE_SECURE === 'true',
  timezone: env.SCHOOL_TIMEZONE || 'Asia/Kolkata',
  storageDriver: env.STORAGE_DRIVER || 'local',
  email: {
    provider: env.EMAIL_PROVIDER || 'none',       // none | smtp-webhook | console
    webhookUrl: env.EMAIL_WEBHOOK_URL || '',
    apiKey: env.EMAIL_API_KEY || '',
    from: env.EMAIL_FROM || 'no-reply@school.local',
  },
  whatsapp: {
    provider: env.WHATSAPP_PROVIDER || 'none',    // none | cloud-api | console
    apiUrl: env.WHATSAPP_API_URL || '',
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
  },
  sms: {
    provider: env.SMS_PROVIDER || 'none',
    apiUrl: env.SMS_API_URL || '',
    apiKey: env.SMS_API_KEY || '',
  },
};
