// End-to-end API tests. Spins up the server on a throwaway database and port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 't.db'), UPLOAD_DIR: path.join(tmp, 'up') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (String(d).includes('running at')) { clearTimeout(t); res(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
});
after(() => { proc?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function session(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(r.status, 200, `login ${username}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (p, opts = {}) => {
    const headers = { cookie, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(BASE + p, { ...opts, headers, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return call;
}

test('login rejects bad credentials and unauthenticated access', async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${BASE}/api/admin/dashboard`)).status, 401);
});

test('class teacher: marks attendance, duplicate-safe, audited edits', async () => {
  const t = await session('priya.sharma', 'Teacher@123');
  const me = (await t('/api/auth/me')).data;
  assert.equal(me.role, 'teacher');
  const div = me.class_teacher_of[0].id;
  const today = (await t('/api/meta')).data.today;
  const sheet = (await t(`/api/attendance/sheet?division_id=${div}&date=${today}`)).data;
  assert.equal(sheet.can_mark, true);
  const records = sheet.students.map((s, i) => ({ student_id: s.id, status: i === 0 ? 'absent' : 'present' }));
  const r1 = await t('/api/attendance/save', { method: 'POST', body: { division_id: div, date: today, records } });
  assert.equal(r1.status, 200);
  const r2 = await t('/api/attendance/save', { method: 'POST', body: { division_id: div, date: today, records } });
  assert.equal(r2.data.created, 0, 'no duplicate rows');
  records[0].status = 'late';
  const r3 = await t('/api/attendance/save', { method: 'POST', body: { division_id: div, date: today, records, reason: 'test' } });
  assert.equal(r3.data.updated, 1);
  const audit = (await t(`/api/attendance/audit?division_id=${div}&date=${today}`)).data.rows;
  assert.ok(audit.some((a) => a.old_status === 'absent' && a.new_status === 'late' && a.reason === 'test'));
  const future = await t('/api/attendance/save', { method: 'POST', body: { division_id: div, date: '2999-01-01', records } });
  assert.equal(future.status, 400);
});

test('teacher cannot mark another class or see unassigned class', async () => {
  const t = await session('priya.sharma', 'Teacher@123');
  const r = await t('/api/attendance/sheet?division_id=1&date=2026-11-02');
  assert.equal(r.status, 403);
  const admin = await t('/api/admin/students');
  assert.equal(admin.status, 403);
});

test('homework with attachment → parent sees, downloads and submits; other parents blocked', async () => {
  const t = await session('priya.sharma', 'Teacher@123');
  const me = (await t('/api/auth/me')).data;
  const today = (await t('/api/meta')).data.today;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const fd = new FormData();
  Object.entries({ division_id: me.class_teacher_of[0].id, subject_id: 1, title: 'Test HW', homework_date: today, due_date: today }).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append('files', new Blob([pdf], { type: 'application/pdf' }), 'sheet.pdf');
  const hw = await t('/api/homework', { method: 'POST', body: fd });
  assert.equal(hw.status, 200, JSON.stringify(hw.data));
  const bad = new FormData();
  Object.entries({ division_id: me.class_teacher_of[0].id, subject_id: 1, title: 'X', homework_date: today, due_date: today }).forEach(([k, v]) => bad.append(k, String(v)));
  bad.append('files', new Blob(['MZ evil'], { type: 'application/pdf' }), 'evil.exe');
  assert.equal((await t('/api/homework', { method: 'POST', body: bad })).status, 400);

  const p = await session('sunita.patil', 'Parent@123');
  const kids = (await p('/api/parent/children')).data.rows;
  assert.equal(kids.length, 2, 'one parent, multiple children');
  const rohan = kids.find((k) => k.full_name === 'Rohan Patil');
  const list = (await p(`/api/homework?student_id=${rohan.id}&status=open`)).data.rows;
  const mine = list.find((h) => h.id === hw.data.id);
  assert.ok(mine);
  const det = (await p(`/api/homework/${mine.id}?student_id=${rohan.id}`)).data;
  const file = await p(`/api/files/homework/${det.attachments[0].id}`);
  assert.equal(file.status, 200);
  const sub = new FormData(); sub.append('student_id', String(rohan.id)); sub.append('content', 'done');
  assert.equal((await p(`/api/homework/${mine.id}/submit`, { method: 'POST', body: sub })).status, 200);
  const notifs = (await p('/api/notifications')).data.rows;
  assert.ok(notifs.some((n) => n.title.includes('Test HW')));

  assert.equal((await p('/api/students/1/overview')).status, 403);
});

test('admin CRUD: create teacher who can log in; reports export', async () => {
  const a = await session('admin', 'Admin@123');
  const r = await a('/api/admin/teachers', { method: 'POST', body: { teacher_code: 'T-NEW', full_name: 'New Teacher', username: 'new.teacher', password: 'NewPass123' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = await session('new.teacher', 'NewPass123');
  assert.equal((await t('/api/auth/me')).data.role, 'teacher');
  const dup = await a('/api/admin/teachers', { method: 'POST', body: { teacher_code: 'T-NEW', full_name: 'Dup' } });
  assert.equal(dup.status, 400);
  const val = await a('/api/admin/students', { method: 'POST', body: { full_name: 'No Admission' } });
  assert.equal(val.status, 400);
  for (const fmt of ['pdf', 'xlsx', 'csv']) {
    const x = await a(`/api/reports/class-attendance?format=${fmt}`);
    assert.equal(x.status, 200);
  }
  const csv = `admission_no,full_name,class,division,roll_no,parent_name,parent_phone\nIMP001,Import Kid,5,A,90,Imp Parent,9000000001\n,Missing,5,A,91,,`;
  const fd = new FormData(); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'kids.csv'); fd.append('dry_run', '0');
  const imp = await a('/api/admin/students-import', { method: 'POST', body: fd });
  assert.equal(imp.data.created, 1); assert.equal(imp.data.failed, 1);
});
