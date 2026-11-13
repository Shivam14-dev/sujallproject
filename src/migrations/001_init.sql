-- School Attendance & Homework Management System — initial schema (SQLite dialect)
-- A PostgreSQL equivalent lives in db/schema.postgres.sql

CREATE TABLE schools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  website       TEXT,
  logo          TEXT,
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE academic_years (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (school_id, name),
  CHECK (end_date > start_date)
);

CREATE TABLE roles (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT
);

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role_id               INTEGER NOT NULL REFERENCES roles(id),
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email                 TEXT,
  phone                 TEXT,
  full_name             TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_school ON users(school_id);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE teachers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  teacher_code    TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  photo           TEXT,
  qualification   TEXT,
  joining_date    TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (school_id, teacher_code)
);

CREATE TABLE parents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  occupation    TEXT,
  address       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX idx_parents_phone ON parents(phone);

CREATE TABLE classes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);
CREATE UNIQUE INDEX ux_classes_year_name ON classes(academic_year_id, name) WHERE deleted_at IS NULL;

CREATE TABLE divisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  class_teacher_id  INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  room              TEXT,
  capacity          INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);
CREATE UNIQUE INDEX ux_divisions_class_name ON divisions(class_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_divisions_class_teacher ON divisions(class_teacher_id);

CREATE TABLE subjects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_subjects_code ON subjects(school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE teacher_assignments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id        INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  division_id       INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  subject_id        INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (teacher_id, division_id, subject_id)
);
CREATE INDEX idx_ta_division ON teacher_assignments(division_id);

CREATE TABLE students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  admission_no    TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  photo           TEXT,
  dob             TEXT,
  gender          TEXT CHECK (gender IN ('M','F','O')),
  division_id     INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  roll_no         INTEGER,
  parent_name     TEXT,
  parent_phone    TEXT,
  parent_email    TEXT,
  address         TEXT,
  admission_date  TEXT,
  blood_group     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','transferred','alumni')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (school_id, admission_no)
);
CREATE INDEX idx_students_division ON students(division_id);
CREATE UNIQUE INDEX ux_students_roll ON students(division_id, roll_no) WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE student_parent_mapping (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id     INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL DEFAULT 'guardian',
  is_primary    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, parent_id)
);
CREATE INDEX idx_spm_parent ON student_parent_mapping(parent_id);

CREATE TABLE attendance (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id),
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  division_id       INTEGER NOT NULL REFERENCES divisions(id),
  date              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('present','absent','late','half_day')),
  remarks           TEXT,
  marked_by         INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, date)
);
CREATE INDEX idx_attendance_div_date ON attendance(division_id, date);
CREATE INDEX idx_attendance_date ON attendance(date);

CREATE TABLE attendance_audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id   INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  old_status      TEXT,
  new_status      TEXT NOT NULL,
  old_remarks     TEXT,
  new_remarks     TEXT,
  reason          TEXT,
  changed_by      INTEGER REFERENCES users(id),
  changed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_aal_attendance ON attendance_audit_logs(attendance_id);

CREATE TABLE student_remarks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  author_user_id    INTEGER NOT NULL REFERENCES users(id),
  category          TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','academic','behaviour','appreciation')),
  remark            TEXT NOT NULL,
  visible_to_parent INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);
CREATE INDEX idx_remarks_student ON student_remarks(student_id);

CREATE TABLE homework (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id),
  division_id       INTEGER NOT NULL REFERENCES divisions(id),
  subject_id        INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id        INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  created_by        INTEGER REFERENCES users(id),
  title             TEXT NOT NULL,
  instructions      TEXT,
  homework_date     TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  allow_submission  INTEGER NOT NULL DEFAULT 1,
  assign_to         TEXT NOT NULL DEFAULT 'class' CHECK (assign_to IN ('class','selected')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT,
  CHECK (due_date >= homework_date)
);
CREATE INDEX idx_homework_div_date ON homework(division_id, homework_date);
CREATE INDEX idx_homework_due ON homework(due_date);

CREATE TABLE homework_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id     INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL UNIQUE,
  mime_type       TEXT,
  size_bytes      INTEGER,
  uploaded_by     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_hwatt_homework ON homework_attachments(homework_id);

CREATE TABLE homework_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id   INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (homework_id, student_id)
);

CREATE TABLE homework_submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id     INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content         TEXT,
  original_name   TEXT,
  stored_name     TEXT UNIQUE,
  mime_type       TEXT,
  size_bytes      INTEGER,
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed')),
  feedback        TEXT,
  submitted_by    INTEGER REFERENCES users(id),
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at     TEXT,
  reviewed_by     INTEGER REFERENCES users(id),
  UNIQUE (homework_id, student_id)
);
CREATE INDEX idx_hwsub_student ON homework_submissions(student_id);

CREATE TABLE announcements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','teachers','parents','students')),
  division_id     INTEGER REFERENCES divisions(id) ON DELETE CASCADE,
  is_important    INTEGER NOT NULL DEFAULT 0,
  published_by    INTEGER REFERENCES users(id),
  published_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX idx_announcements_pub ON announcements(published_at);

CREATE TABLE notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,
  ref_key       TEXT,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE UNIQUE INDEX ux_notifications_ref ON notifications(user_id, ref_key) WHERE ref_key IS NOT NULL;

CREATE TABLE notification_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp','sms')),
  recipient     TEXT NOT NULL,
  subject       TEXT,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT
);
CREATE INDEX idx_outbox_status ON notification_outbox(status);

CREATE TABLE school_calendar (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER REFERENCES academic_years(id),
  title             TEXT NOT NULL,
  description       TEXT,
  event_type        TEXT NOT NULL DEFAULT 'event' CHECK (event_type IN ('exam','test','meeting','event','other')),
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  division_id       INTEGER REFERENCES divisions(id) ON DELETE CASCADE,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_calendar_dates ON school_calendar(start_date, end_date);

CREATE TABLE holidays (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER REFERENCES academic_years(id),
  name              TEXT NOT NULL,
  date              TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (school_id, date)
);

CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     INTEGER,
  details       TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

INSERT INTO roles (id, name, description) VALUES
  (1, 'admin',   'School administrator'),
  (2, 'teacher', 'Class / subject teacher'),
  (3, 'parent',  'Parent or guardian'),
  (4, 'student', 'Student');
