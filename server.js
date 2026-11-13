import http from 'node:http';
import path from 'node:path';
import { config, ROOT } from './src/config.js';
import { migrate, get } from './src/db.js';
import { match, parseRequestBody, sendJson, serveStatic, HttpError } from './src/http.js';
import { loadUser } from './src/auth.js';
import { runDeadlineReminders, flushOutbox } from './src/notify.js';
import { run } from './src/db.js';

import './src/api/common.js';
import './src/api/admin.js';
import './src/api/homework.js';
import './src/api/attendance.js';
import './src/api/reports.js';

const SENT = Symbol('sent');
const PUBLIC = path.join(ROOT, 'public');

const applied = migrate();
if (applied.length) console.log('Applied migrations:', applied.join(', '));
if (!get('SELECT 1 FROM schools LIMIT 1')) {
  console.log('Database is empty — seeding demo data (run "npm run reset" to start over)…');
  const { seed } = await import('./scripts/seed.js');
  seed();
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function handler(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, PUBLIC, url.pathname);

  (async () => {
    const m = match(req.method, url.pathname);
    if (!m) throw new HttpError(404, 'API route not found');
    if (m.methodMismatch) throw new HttpError(405, 'Method not allowed');
    // CSRF defence: state-changing requests must come from our own origin (SameSite=Lax cookie + Origin check)
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
    }
    const { body, files } = await parseRequestBody(req);
    const ctx = {
      req, res, params: m.params, query: Object.fromEntries(url.searchParams), body, files,
      ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress, SENT,
    };
    ctx.user = loadUser(req);
    let out;
    for (const h of m.handlers) { out = await h(ctx); }
    if (out === SENT || res.headersSent) return;
    sendJson(res, 200, out ?? { ok: true });
  })().catch((err) => {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, details: err.details });
    if (/UNIQUE constraint failed/.test(err.message)) return sendJson(res, 409, { error: 'A record with these details already exists' });
    if (/FOREIGN KEY constraint failed/.test(err.message)) return sendJson(res, 400, { error: 'Referenced record does not exist or is still in use' });
    if (/CHECK constraint failed/.test(err.message)) return sendJson(res, 400, { error: 'Invalid value submitted' });
    console.error(new Date().toISOString(), req.method, req.url, err);
    sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  });
}

const server = http.createServer(handler);
server.requestTimeout = 120000;
server.listen(config.port, config.host, () => {
  console.log(`School Portal running at http://localhost:${config.port}  (env: ${config.nodeEnv})`);
});

// Background jobs: deadline reminders hourly, outbox every minute, expired session cleanup daily.
const every = (ms, fn) => setInterval(() => { try { const r = fn(); if (r?.catch) r.catch((e) => console.error('job', e)); } catch (e) { console.error('job', e); } }, ms).unref();
setTimeout(() => { try { runDeadlineReminders(); } catch (e) { console.error(e); } }, 5000).unref();
every(3600e3, runDeadlineReminders);
every(60e3, () => flushOutbox());
every(86400e3, () => run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString()));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
