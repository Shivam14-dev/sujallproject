// File storage abstraction. "local" stores under UPLOAD_DIR with random names.
// To add cloud storage (S3, GCS, Azure), implement the same four functions and select via STORAGE_DRIVER.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { bad } from './http.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = {
  '.pdf': ['application/pdf'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.gif': ['image/gif'],
  '.doc': ['application/msword'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'], '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['text/plain'],
};
const MAGIC = {
  '.pdf': (b) => b.slice(0, 4).toString('latin1') === '%PDF',
  '.png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8, '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.gif': (b) => b.slice(0, 3).toString('latin1') === 'GIF', '.webp': (b) => b.slice(8, 12).toString('latin1') === 'WEBP',
  '.docx': (b) => b[0] === 0x50 && b[1] === 0x4b, '.xlsx': (b) => b[0] === 0x50 && b[1] === 0x4b, '.pptx': (b) => b[0] === 0x50 && b[1] === 0x4b,
};

export function checkFile(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if (!ALLOWED[ext]) throw bad(`"${file.filename}": file type not allowed. Allowed: ${Object.keys(ALLOWED).join(' ')}`);
  if (file.data.length === 0) throw bad(`"${file.filename}" is empty`);
  if (file.data.length > config.maxUploadMb * 1048576) throw bad(`"${file.filename}" is larger than ${config.maxUploadMb} MB`);
  if (MAGIC[ext] && !MAGIC[ext](file.data)) throw bad(`"${file.filename}" does not look like a valid ${ext} file`);
  return { ext, mime: ALLOWED[ext][0] };
}

const localDriver = {
  save(buffer, ext) {
    const name = `${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(16).toString('hex')}${ext}`;
    const full = path.join(config.uploadDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer, { mode: 0o640 });
    return name;
  },
  resolve(name) {
    const full = path.normalize(path.join(config.uploadDir, name));
    if (!full.startsWith(config.uploadDir) || !fs.existsSync(full)) return null;
    return full;
  },
  remove(name) { const f = this.resolve(name); if (f) fs.unlinkSync(f); },
};

const drivers = { local: localDriver };
export const storage = drivers[config.storageDriver] || localDriver;

export function storeUpload(file) {
  const { ext, mime } = checkFile(file);
  const stored = storage.save(file.data, ext);
  return { original_name: file.filename.slice(0, 200), stored_name: stored, mime_type: mime, size_bytes: file.data.length };
}
