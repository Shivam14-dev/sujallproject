# School Attendance & Daily Homework Management System

A web portal for one school with four kinds of login (**Admin**, **Class/Subject Teacher**, **Parent**, **Student**). Each user signs in with a User ID and password and lands on their own dashboard.

- **Runs on Node.js 22.13 or later only.** There is nothing to `npm install`: no dependencies, no build step.
- **Database:** SQLite, using Node's built-in `node:sqlite`. A PostgreSQL version of the schema is in `db/schema.postgres.sql`.
- **Frontend:** responsive single-page app (vanilla ES modules). Sidebar on desktop, bottom navigation on mobile.

---

## 1. Quick start

```bash
cd school-portal
cp .env.example .env        # optional — sensible defaults are built in
npm start                   # first run creates the database and loads demo data
```

Open **http://localhost:3000**

| Role | User ID | Password | What they see |
|---|---|---|---|
| Admin | `admin` | `Admin@123` | Whole school |
| **Class teacher** | `priya.sharma` | `Teacher@123` | Class teacher of 8-A; teaches English in 8-A … 10-B |
| Parent | `sunita.patil` | `Parent@123` | Two children: Rohan (8-A) and Ananya (5-B) |
| Student | `ADM260163` | `Student@123` | Rohan Patil, 8-A |

All seeded teachers use `Teacher@123`. Their User IDs are `firstname.lastname`, e.g. `rahul.mehta`, class teacher of 8-B. All seeded parents use `Parent@123`, and their User ID is their mobile number without +91. All students use `Student@123`, and their User ID is their admission number.

Other commands:

```bash
npm run dev      # auto-restart on file changes
npm run reset    # wipe database + uploads and reseed demo data
npm run migrate  # apply new migrations only
npm test         # end-to-end API tests (uses a temporary database)
```

## 2. Giving a class teacher access

1. Sign in as **admin**, then go to **Teachers → Add teacher**. Enter the Teacher ID, name, a **Login User ID** (e.g. `anita.joshi`) and an initial password. If you leave the password blank, it is `Teacher@123` and the teacher must change it at first login.
2. Go to **Classes & Subjects** and pick the teacher in the *Class teacher* dropdown for their division.
3. Optionally, go to **Teachers → Assign** to add the subjects they teach in other classes.
4. The teacher signs in with that User ID and password and lands on the **Teacher Dashboard**. It shows today's attendance status, the classes they're assigned, homework submissions and students who need attention.

Only the **class teacher** (or an admin) can mark attendance for a division. Subject teachers can view it and give homework for their subjects.

## 3. Features

**Attendance**
- Pick academic year, class and date. Mark each student Present, Absent, Late or Half Day, or use **Mark all present** in one tap.
- Add remarks per student.
- Duplicate records are impossible: each student has one row per date, enforced by a unique key.
- Editing saved attendance requires a reason, and every change is written to `attendance_audit_logs`.
- Teachers can edit only within the last *N* days (configurable). Older records need an admin.
- Holiday and Sunday warnings; future dates are blocked.
- Records view with Today / This week / This month / Custom filters, plus class-wise and student-wise views with per-student history.

**Homework**
- Choose class, subject, date and deadline. Add title, instructions and up to 10 attachments (PDF, image, Office files; 10 MB each).
- Assign to the whole class or to selected students.
- Edit or delete homework; browse history.
- Statuses: **Assigned, Pending, Submitted, Reviewed, Overdue**.
- Parents and students can filter by date or subject, see pending vs completed, download files, and mark work done or upload it.
- Teachers review submissions and can leave feedback.

**Dashboards**
- **Admin:** totals, today's attendance, present-vs-absent chart, 30-day trend, class-wise table, recent homework and announcements.
- **Teacher:** assigned classes, pending attendance, today's donut chart, 2-week trend, submission overview, students below the threshold, upcoming events.
- **Parent:** child switcher, today's status, monthly and yearly %, today's homework, deadlines, remarks, notices.
- **Student:** the same as Parent, for themselves.

**Management**
- Full create/edit/delete for students, teachers, parents, classes, divisions, subjects, assignments, academic years and holidays.
- Bulk student import from **CSV or Excel (.xlsx)**, with a preview step. Student and parent logins are created automatically.
- One parent can have many children.

**Communication**
- Announcements to the whole school or a single class; important notices are flagged.
- Monthly school calendar (exams, tests, PTMs, events, holidays, homework deadlines).
- In-app notification centre.

**Notifications fire when:**
- a student is marked absent, late or half day;
- new homework is assigned;
- a deadline is tomorrow (hourly job);
- an announcement or important notice is published;
- a teacher adds a remark;
- homework is reviewed.

WhatsApp, SMS and Email go through a queued outbox with retries. Providers are configured **only** through environment variables (see `.env.example`); nothing is hardcoded.

**Reports**
- Daily, monthly register, individual student, class-wise, absentee, homework assigned, homework submission and teacher activity.
- Preview in the browser and export to **PDF, Excel (.xlsx) or CSV**.

## 4. Security
- Passwords are hashed with **scrypt** and a per-user salt. Demo seed accounts share one hash per role for fast seeding. Every account created in the app gets a unique salt.
- Sessions use a random 256-bit token stored only as a SHA-256 hash, in an HttpOnly, SameSite=Lax cookie (add `Secure` with `COOKIE_SECURE=true`).
- Login is throttled: 5 failures lock that ID/IP pair for 10 minutes.
- **Role-based authorization on every API route:**
  - teachers only reach classes they're assigned to;
  - parents only reach their linked children;
  - students only reach their own records.
- Server-side validation on every input.
- Parameterised SQL everywhere.
- Output escaping on the frontend through a tagged-template helper.
- Strict Content-Security-Policy, frame denial, nosniff, and an Origin check on writes.
- File uploads are checked against an extension whitelist, a size limit and magic bytes. Files are stored under random names outside the web root and served only through an authorised download endpoint.
- Audit log (`audit_logs`) for logins, edits, deletes, imports, exports and password resets. You can view it in **Settings → Audit log**.
- Deletes are soft deletes (`deleted_at`) for students, teachers, parents, classes, homework, announcements and events.

## 5. Project structure
```
server.js                 HTTP server, security headers, routing, background jobs
src/config.js             env loading      src/db.js       SQLite + migrations
src/auth.js               hashing, sessions, RBAC scope helpers
src/http.js               router, JSON/multipart parsing
src/notify.js             in-app notifications + outbox (WhatsApp/SMS/Email)
src/storage.js            file storage driver (local; add S3/GCS here)
src/export.js             XLSX writer/reader, PDF writer, CSV
src/api/*.js              common, admin, attendance, homework, reports
src/migrations/*.sql      schema (23 required tables + sessions, remarks, outbox)
db/schema.postgres.sql    PostgreSQL version of the schema
scripts/seed.js           realistic demo data
public/                   SPA (index.html, css/app.css, js/app.js, js/pages/*)
test/api.test.js          end-to-end API tests
```

## 6. Deployment

**Any Linux server / VPS**
```bash
# Node 22.13+ required
git clone <repo> && cd school-portal
cp .env.example .env && nano .env      # set NODE_ENV=production, COOKIE_SECURE=true
npm run migrate
npm start                              # or: pm2 start server.js --name school --node-args="--disable-warning=ExperimentalWarning"
```
Put Nginx or Caddy in front for HTTPS, with `proxy_pass http://127.0.0.1:3000; client_max_body_size 60m;`.

**Docker**
```bash
docker build -t school-portal .
docker run -d -p 3000:3000 -v school_data:/app/data -v school_uploads:/app/uploads --env-file .env school-portal
```

**Backups:** copy `data/school.db` (safe while running in WAL mode with `sqlite3 data/school.db ".backup backup.db"`) and the `uploads/` folder.

**First real use:**
1. Sign in as `admin` and change the password (Profile → Change password).
2. Run `npm run reset` beforehand if you want to start from the demo data, or delete `data/` to start completely empty.
3. Set the school profile and academic year in **Settings**.
4. Create classes, subjects and teachers, then import students from Excel.

## 7. Notes and limits
- Built on Node built-ins only, because package installs were unavailable when this was built. The modules are written so they can move onto Next.js API routes or Express later if wanted. `db/schema.postgres.sql` is the starting point for PostgreSQL; the SQL in `src/api` uses standard features apart from SQLite's `GROUP_CONCAT` (`STRING_AGG` in PostgreSQL).
- PDF exports use standard PDF fonts, so Devanagari text (Hindi/Marathi homework titles) is dropped in **PDF only**. Excel and CSV exports keep it intact.
- Recharts and Lucide are replaced by lightweight built-in SVG charts and Lucide-style icons, to keep the app dependency-free.
