-- School Attendance & Homework Management System — initial schema (PostgreSQL dialect)
-- Generated from src/migrations/001_init.sql. Requires PostgreSQL 13+ and the citext extension.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE schools (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  website       TEXT,
  logo          TEXT,
  settings      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE academic_years (
  id            BIGSERIAL PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  CHECK (end_date > start_date)
);

CREATE TABLE roles (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT
);

CREATE TABLE users (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role_id               BIGINT NOT NULL REFERENCES roles(id),
  username              CITEXT NOT NULL UNIQUE,
  email                 TEXT,
  phone                 TEXT,
  full_name             TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_school ON users(school_id);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE teachers (
  id              BIGSERIAL PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id         BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  teacher_code    TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  photo           TEXT,
  qualification   TEXT,
  joining_date    DATE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (school_id, teacher_code)
);

CREATE TABLE parents (
  id            BIGSERIAL PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  occupation    TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_parents_phone ON parents(phone);

CREATE TABLE classes (
  id                BIGSERIAL PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_classes_year_name ON classes(academic_year_id, name) WHERE deleted_at IS NULL;

CREATE TABLE divisions (
  id                BIGSERIAL PRIMARY KEY,
  class_id          BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  class_teacher_id  BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  room              TEXT,
  capacity          INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_divisions_class_name ON divisions(class_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_divisions_class_teacher ON divisions(class_teacher_id);

CREATE TABLE subjects (
  id            BIGSERIAL PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_subjects_code ON subjects(school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE teacher_assignments (
  id                BIGSERIAL PRIMARY KEY,
  teacher_id        BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  division_id       BIGINT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  subject_id        BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, division_id, subject_id)
);
CREATE INDEX idx_ta_division ON teacher_assignments(division_id);

CREATE TABLE students (
  id              BIGSERIAL PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id         BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  admission_no    TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  photo           TEXT,
  dob             DATE,
  gender          TEXT CHECK (gender IN ('M','F','O')),
  division_id     BIGINT REFERENCES divisions(id) ON DELETE SET NULL,
  roll_no         INTEGER,
  parent_name     TEXT,
  parent_phone    TEXT,
  parent_email    TEXT,
  address         TEXT,
  admission_date  DATE,
  blood_group     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','transferred','alumni')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (school_id, admission_no)
);
CREATE INDEX idx_students_division ON students(division_id);
CREATE UNIQUE INDEX ux_students_roll ON students(division_id, roll_no) WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE student_parent_mapping (
  id            BIGSERIAL PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id     BIGINT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL DEFAULT 'guardian',
  is_primary    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, parent_id)
);
CREATE INDEX idx_spm_parent ON student_parent_mapping(parent_id);

CREATE TABLE attendance (
  id                BIGSERIAL PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  student_id        BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  division_id       BIGINT NOT NULL REFERENCES divisions(id),
  date              DATE NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('present','absent','late','half_day')),
  remarks           TEXT,
  marked_by         BIGINT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, date)
);
CREATE INDEX idx_attendance_div_date ON attendance(division_id, date);
CREATE INDEX idx_attendance_date ON attendance(date);

CREATE TABLE attendance_audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  attendance_id   BIGINT NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  student_id      BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  old_status      TEXT,
  new_status      TEXT NOT NULL,
  old_remarks     TEXT,
  new_remarks     TEXT,
  reason          TEXT,
  changed_by      BIGINT REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_aal_attendance ON attendance_audit_logs(attendance_id);

CREATE TABLE student_remarks (
  id                BIGSERIAL PRIMARY KEY,
  student_id        BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  author_user_id    BIGINT NOT NULL REFERENCES users(id),
  category          TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','academic','behaviour','appreciation')),
  remark            TEXT NOT NULL,
  visible_to_parent BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_remarks_student ON student_remarks(student_id);

CREATE TABLE homework (
  id                BIGSERIAL PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  division_id       BIGINT NOT NULL REFERENCES divisions(id),
  subject_id        BIGINT NOT NULL REFERENCES subjects(id),
  teacher_id        BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  created_by        BIGINT REFERENCES users(id),
  title             TEXT NOT NULL,
  instructions      TEXT,
  homework_date     DATE NOT NULL,
  due_date          DATE NOT NULL,
  allow_submission  BOOLEAN NOT NULL DEFAULT TRUE,
  assign_to         TEXT NOT NULL DEFAULT 'class' CHECK (assign_to IN ('class','selected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK (due_date >= homework_date)
);
CREATE INDEX idx_homework_div_date ON homework(division_id, homework_date);
CREATE INDEX idx_homework_due ON homework(due_date);

CREATE TABLE homework_attachments (
  id              BIGSERIAL PRIMARY KEY,
  homework_id     BIGINT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL UNIQUE,
  mime_type       TEXT,
  size_bytes      INTEGER,
  uploaded_by     BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hwatt_homework ON homework_attachments(homework_id);

CREATE TABLE homework_assignments (
  id            BIGSERIAL PRIMARY KEY,
  homework_id   BIGINT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);

CREATE TABLE homework_submissions (
  id              BIGSERIAL PRIMARY KEY,
  homework_id     BIGINT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id      BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content         TEXT,
  original_name   TEXT,
  stored_name     TEXT UNIQUE,
  mime_type       TEXT,
  size_bytes      INTEGER,
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed')),
  feedback        TEXT,
  submitted_by    BIGINT REFERENCES users(id),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     BIGINT REFERENCES users(id),
  UNIQUE (homework_id, student_id)
);
CREATE INDEX idx_hwsub_student ON homework_submissions(student_id);

CREATE TABLE announcements (
  id              BIGSERIAL PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','teachers','parents','students')),
  division_id     BIGINT REFERENCES divisions(id) ON DELETE CASCADE,
  is_important    BOOLEAN NOT NULL DEFAULT FALSE,
  published_by    BIGINT REFERENCES users(id),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_announcements_pub ON announcements(published_at);

CREATE TABLE notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,
  ref_key       TEXT,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE UNIQUE INDEX ux_notifications_ref ON notifications(user_id, ref_key) WHERE ref_key IS NOT NULL;

CREATE TABLE notification_outbox (
  id            BIGSERIAL PRIMARY KEY,
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp','sms')),
  recipient     TEXT NOT NULL,
  subject       TEXT,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX idx_outbox_status ON notification_outbox(status);

CREATE TABLE school_calendar (
  id                BIGSERIAL PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  BIGINT REFERENCES academic_years(id),
  title             TEXT NOT NULL,
  description       TEXT,
  event_type        TEXT NOT NULL DEFAULT 'event' CHECK (event_type IN ('exam','test','meeting','event','other')),
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  division_id       BIGINT REFERENCES divisions(id) ON DELETE CASCADE,
  created_by        BIGINT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_calendar_dates ON school_calendar(start_date, end_date);

CREATE TABLE holidays (
  id                BIGSERIAL PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  BIGINT REFERENCES academic_years(id),
  name              TEXT NOT NULL,
  date              DATE NOT NULL,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, date)
);

CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  school_id     BIGINT,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     BIGINT,
  details       TEXT,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

INSERT INTO roles (id, name, description) VALUES
  (1, 'admin',   'School administrator'),
  (2, 'teacher', 'Class / subject teacher'),
  (3, 'parent',  'Parent or guardian'),
  (4, 'student', 'Student');
