// Tiny HTTP toolkit: router, body parsing (JSON + multipart), responses, errors.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

const routes = [];
export function route(method, pattern, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handlers });
}
export const api = {
  get: (p, ...h) => route('GET', p, ...h),
  post: (p, ...h) => route('POST', p, ...h),
  put: (p, ...h) => route('PUT', p, ...h),
  del: (p, ...h) => route('DELETE', p, ...h),
};

export function match(method, pathname) {
  let methodMismatch = false;
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (!m) continue;
    if (r.method !== method) { methodMismatch = true; continue; }
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { handlers: r.handlers, params };
  }
  return methodMismatch ? { methodMismatch: true } : null;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `Request too large (max ${Math.round(limit / 1048576)} MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseMultipart(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw bad('Malformed multipart body');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {};
  const files = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing --
    pos += 2; // CRLF
    const headerEnd = buf.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const headers = buf.slice(pos, headerEnd).toString('utf8');
    const next = buf.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const data = buf.slice(headerEnd + 4, next - 2);
    const name = (headers.match(/name="([^"]*)"/i) || [])[1];
    const filename = (headers.match(/filename="([^"]*)"/i) || [])[1];
    const type = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1];
    if (name) {
      if (filename !== undefined) {
        if (filename) files.push({ field: name, filename: path.basename(filename), mime: (type || 'application/octet-stream').trim(), data });
      } else if (fields[name] !== undefined) {
        fields[name] = [].concat(fields[name], data.toString('utf8'));
      } else {
        fields[name] = data.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

export async function parseRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return { body: {}, files: [] };
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) {
    const buf = await readBody(req, (config.maxUploadMb * 5 + 1) * 1048576);
    const { fields, files } = parseMultipart(buf, ct);
    return { body: fields, files };
  }
  const buf = await readBody(req, 2 * 1048576);
  if (!buf.length) return { body: {}, files: [] };
  if (ct.includes('application/json')) {
    try { return { body: JSON.parse(buf.toString('utf8')), files: [] }; }
    catch { throw bad('Invalid JSON body'); }
  }
  if (ct.includes('text/csv') || ct.includes('text/plain')) return { body: { text: buf.toString('utf8') }, files: [] };
  throw new HttpError(415, 'Unsupported content type');
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendFile(res, { buffer, filePath, filename, mime, inline = false }) {
  const safeName = String(filename || 'download').replace(/[^\w.\- ()]/g, '_');
  res.writeHead(200, {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
    'Cache-Control': 'private, no-store',
  });
  if (buffer) res.end(buffer);
  else fs.createReadStream(filePath).pipe(res);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
export function serveStatic(res, publicDir, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA fallback
  const full = path.normalize(path.join(publicDir, rel));
  if (!full.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(full).pipe(res);
  });
}
