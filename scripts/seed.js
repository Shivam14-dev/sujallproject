// Seeds realistic demo data. Usage: npm run seed  (only if empty)  |  npm run reset  (wipe & reseed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--reset')) {
  for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  if (fs.existsSync(config.uploadDir)) fs.rmSync(config.uploadDir, { recursive: true, force: true });
  console.log('Database and uploads wiped.');
}

const { db, migrate, run, get, all } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { today, addDays, dayOfWeek, eachDay } = await import('../src/util.js');
const { toPdf } = await import('../src/export.js');
const { storage } = await import('../src/storage.js');

// deterministic PRNG
let seedVal = 20261113;
const rnd = () => { seedVal = (seedVal * 1103515245 + 12345) % 2147483648; return seedVal / 2147483648; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const BOYS = ['Aarav', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advait', 'Kabir', 'Aditya', 'Om', 'Pranav', 'Yash', 'Rudra', 'Siddharth', 'Tanmay', 'Varun', 'Harsh', 'Nikhil', 'Rohit', 'Aryan', 'Dhruv', 'Parth', 'Soham', 'Manas', 'Chinmay'];
const GIRLS = ['Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Ira', 'Myra', 'Kavya', 'Anika', 'Pari', 'Riya', 'Sneha', 'Shruti', 'Tanvi', 'Isha', 'Gauri', 'Mrunal', 'Sakshi', 'Pooja', 'Neha', 'Aditi', 'Janhavi', 'Rutuja', 'Siya', 'Avni', 'Kriti', 'Navya', 'Prisha', 'Vedika'];
const SURNAMES = ['Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Shinde', 'Pawar', 'Jadhav', 'Sharma', 'Gupta', 'Mehta', 'Nair', 'Iyer', 'Reddy', 'Chavan', 'More', 'Gaikwad', 'Bhosale', 'Kale', 'Shah', 'Verma', 'Rao', 'Naik', 'Sawant', 'Desai', 'Agarwal', 'Singh', 'Khan', 'Fernandes'];
const FATHER = ['Sanjay', 'Rajesh', 'Mahesh', 'Sunil', 'Anil', 'Vijay', 'Prakash', 'Amit', 'Rahul', 'Nitin', 'Sachin', 'Ganesh', 'Deepak', 'Manoj', 'Sandeep', 'Vikram'];
const MOTHER = ['Sunita', 'Kavita', 'Anita', 'Meena', 'Rekha', 'Priyanka', 'Swati', 'Manisha', 'Seema', 'Vaishali', 'Archana', 'Shilpa', 'Smita', 'Deepa'];

export function seed() {
  migrate();
  if (get('SELECT 1 FROM schools LIMIT 1')) { console.log('Database already has data. Use "npm run reset" to wipe and reseed.'); return; }
  const T = today();
  const started = Date.now();
  db.exec('BEGIN');
  try {
    const schoolId = run(`INSERT INTO schools (name, address, phone, email, website, settings) VALUES (?,?,?,?,?,?)`,
      'Sunrise Public School', 'Plot 14, Baner Road, Pune, Maharashtra 411045', '+912027291234', 'office@sunriseschool.edu.in', 'https://sunriseschool.edu.in',
      JSON.stringify({ teacher_edit_window_days: 3, notify_absent: true, notify_homework: true, whatsapp_enabled: false, email_enabled: false, sms_enabled: false, low_attendance_threshold: 75 })).id;

    // academic year spanning "today"
    const y = Number(T.slice(0, 4)) - (Number(T.slice(5, 7)) < 6 ? 1 : 0);
    const yearStart = `${y}-06-15`, yearEnd = `${y + 1}-04-30`;
    run(`INSERT INTO academic_years (school_id, name, start_date, end_date, is_current) VALUES (?,?,?,?,0)`, schoolId, `${y - 1}-${String(y).slice(2)}`, `${y - 1}-06-15`, `${y}-04-30`);
    const yearId = run(`INSERT INTO academic_years (school_id, name, start_date, end_date, is_current) VALUES (?,?,?,?,1)`, schoolId, `${y}-${String(y + 1).slice(2)}`, yearStart, yearEnd).id;

    const H = {
      admin: hashPassword('Admin@123'), teacher: hashPassword('Teacher@123'), parent: hashPassword('Parent@123'), student: hashPassword('Student@123'),
    };
    const user = (role, username, fullName, hash, email, phone) => run(
      `INSERT INTO users (school_id, role_id, username, email, phone, full_name, password_hash) VALUES (?,?,?,?,?,?,?)`,
      schoolId, { admin: 1, teacher: 2, parent: 3, student: 4 }[role], username, email || null, phone || null, fullName, hash).id;

    const adminId = user('admin', 'admin', 'Meera Kulkarni (Principal)', H.admin, 'principal@sunriseschool.edu.in', '+919822000001');
    user('admin', 'office', 'Office Administrator', H.admin, 'office@sunriseschool.edu.in', '+919822000002');

    // subjects
    const SUBJ = [['English', 'ENG'], ['Mathematics', 'MATH'], ['Science', 'SCI'], ['Social Studies', 'SST'], ['Hindi', 'HIN'], ['Marathi', 'MAR'], ['Computer Science', 'COMP']];
    const subjectIds = SUBJ.map(([n, c]) => run('INSERT INTO subjects (school_id, name, code) VALUES (?,?,?)', schoolId, n, c).id);

    // teachers: index k (subject) + 7*group
    const TEACHERS = [
      'Sneha Deshpande', 'Rakesh Jain', 'Anjali Kulkarni', 'Suresh Pawar', 'Kavita Mishra', 'Vandana Gokhale', 'Amol Bhide',
      'Priya Sharma', 'Rahul Mehta', 'Deepa Nair', 'Arvind Joshi', 'Pooja Tiwari', 'Shubhangi Patil', 'Nilesh Kadam',
    ];
    const teacherRows = TEACHERS.map((name, i) => {
      const username = name.toLowerCase().replace(' ', '.');
      const uid = user('teacher', username, name, H.teacher, `${username}@sunriseschool.edu.in`, `+9198${String(22001000 + i * 137).padStart(8, '0')}`);
      const tid = run(`INSERT INTO teachers (school_id, user_id, teacher_code, full_name, email, phone, qualification, joining_date) VALUES (?,?,?,?,?,?,?,?)`,
        schoolId, uid, `TCH${String(101 + i)}`, name, `${username}@sunriseschool.edu.in`, `+9198${String(22001000 + i * 137).padStart(8, '0')}`,
        pick(['M.A., B.Ed.', 'M.Sc., B.Ed.', 'B.Sc., B.Ed.', 'M.Com., B.Ed.', 'MCA']), `${2010 + (i % 12)}-06-${String(10 + (i % 15)).padStart(2, '0')}`).id;
      return { id: tid, uid, name, subject: subjectIds[i % 7] };
    });

    // classes & divisions
    const divisions = [];
    [5, 6, 7, 8, 9, 10].forEach((cn, ci) => {
      const cid = run('INSERT INTO classes (school_id, academic_year_id, name, sort_order) VALUES (?,?,?,?)', schoolId, yearId, String(cn), cn).id;
      ['A', 'B'].forEach((dn, di) => {
        const j = ci * 2 + di;
        const group = j < 6 ? 0 : 1;
        const ct = teacherRows[group * 7 + (j % 6)];
        const did = run('INSERT INTO divisions (class_id, name, class_teacher_id, room, capacity) VALUES (?,?,?,?,?)', cid, dn, ct.id, `${cn}${dn === 'A' ? '01' : '02'}`, 40).id;
        divisions.push({ id: did, label: `${cn}-${dn}`, cn, dn, group, ct });
        subjectIds.forEach((sid, k) => run('INSERT INTO teacher_assignments (teacher_id, division_id, subject_id) VALUES (?,?,?)', teacherRows[group * 7 + k].id, did, sid));
      });
    });

    // students & parents
    let adm = 1, phoneSeq = 1000;
    const parentsByKey = new Map();
    const students = [];
    const makeParent = (name, phone, email, username) => {
      const uid = user('parent', username || phone.replace('+91', ''), name, H.parent, email, phone);
      return run('INSERT INTO parents (school_id, user_id, full_name, phone, email, occupation) VALUES (?,?,?,?,?,?)', schoolId, uid, name, phone, email,
        pick(['Engineer', 'Business', 'Teacher', 'Doctor', 'Accountant', 'Homemaker', 'Govt. Service', 'Shop owner'])).id;
    };
    // the demo family: Sunita Patil — two children (8-A and 5-B)
    const demoParentPhone = '+919876543210';
    const demoParentId = makeParent('Sunita Patil', demoParentPhone, 'sunita.patil@example.com', 'sunita.patil');
    for (const d of divisions) {
      const list = [];
      const n = 22 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const g = rnd() < 0.5 ? 'M' : 'F';
        list.push({ g, first: pick(g === 'M' ? BOYS : GIRLS), last: pick(SURNAMES) });
      }
      if (d.label === '8-A') list.push({ g: 'M', first: 'Rohan', last: 'Patil', demo: 'student' });
      if (d.label === '5-B') list.push({ g: 'F', first: 'Ananya', last: 'Patil', demo: 'sibling' });
      list.sort((a, b) => (a.first + a.last).localeCompare(b.first + b.last));
      list.forEach((s, idx) => {
        const fullName = `${s.first} ${s.last}`;
        const admissionNo = `ADM${String(y).slice(2)}${String(adm++).padStart(4, '0')}`;
        const by = y - (d.cn + 5);
        const dob = `${by}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
        let parentId, parentName, phone, email;
        if (s.demo) { parentId = demoParentId; parentName = 'Sunita Patil'; phone = demoParentPhone; email = 'sunita.patil@example.com'; }
        else {
          // ~8% of students are siblings of an earlier student with the same surname in a different class
          const sibKey = [...parentsByKey.keys()].find((k) => k.startsWith(s.last + '|') && !k.includes(`|${d.cn}|`));
          if (sibKey && rnd() < 0.12) { ({ parentId, parentName, phone, email } = parentsByKey.get(sibKey)); parentsByKey.delete(sibKey); }
          else {
            parentName = `${rnd() < 0.6 ? pick(FATHER) : pick(MOTHER)} ${s.last}`;
            phone = `+9198${String(76500000 + phoneSeq++ * 7).padStart(8, '0')}`;
            email = `${parentName.toLowerCase().replace(' ', '.')}${phoneSeq}@example.com`;
            parentId = makeParent(parentName, phone, email);
            parentsByKey.set(`${s.last}|${d.cn}|${parentId}`, { parentId, parentName, phone, email });
          }
        }
        const suid = user('student', admissionNo, fullName, H.student, null, null);
        const sid = run(`INSERT INTO students (school_id, user_id, admission_no, full_name, dob, gender, division_id, roll_no, parent_name, parent_phone, parent_email, address, admission_date, blood_group)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        schoolId, suid, admissionNo, fullName, dob, s.g, d.id, idx + 1, parentName, phone, email,
        `${10 + Math.floor(rnd() * 200)}, ${pick(['Baner', 'Aundh', 'Pashan', 'Kothrud', 'Wakad', 'Balewadi', 'Sus Road'])}, Pune`, `${y - Math.floor(rnd() * 5)}-06-1${Math.floor(rnd() * 9)}`,
        pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'B-'])).id;
        run('INSERT INTO student_parent_mapping (student_id, parent_id, relation) VALUES (?,?,?)', sid, parentId, parentName.startsWith('Sunita') || MOTHER.some((m) => parentName.startsWith(m)) ? 'mother' : 'father');
        const rate = s.demo === 'student' ? 0.93 : rnd() < 0.07 ? 0.62 + rnd() * 0.1 : 0.86 + rnd() * 0.13;
        students.push({ id: sid, uid: suid, name: fullName, division: d, rate, admissionNo, demo: s.demo });
      });
    }

    // holidays
    const HOL = [[`${y}-08-15`, 'Independence Day'], [`${y}-09-14`, 'Ganesh Chaturthi'], [`${y}-10-02`, 'Gandhi Jayanti'], [`${y}-10-20`, 'Dussehra'],
      [`${y}-11-09`, 'Diwali Vacation'], [`${y}-11-10`, 'Diwali Vacation'], [`${y}-11-11`, 'Diwali Vacation'], [`${y}-12-25`, 'Christmas'],
      [`${y + 1}-01-26`, 'Republic Day'], [`${y + 1}-02-19`, 'Chhatrapati Shivaji Maharaj Jayanti'], [`${y + 1}-03-04`, 'Holi']];
    for (const [d, n] of HOL) run('INSERT INTO holidays (school_id, academic_year_id, name, date) VALUES (?,?,?,?)', schoolId, yearId, n, d);
    const holidaySet = new Set(HOL.map((h) => h[0]));

    // attendance from year start to today (Mon–Sat, skip holidays); some divisions not yet marked today
    const schoolDays = eachDay(yearStart, T).filter((d) => dayOfWeek(d) !== 0 && !holidaySet.has(d));
    const unmarkedToday = new Set(['8-A', '6-B', '10-B']);
    const REMARKS = ['Fever', 'Family function', 'Not informed', 'Medical appointment', 'Out of town', 'Cold & cough'];
    const insAtt = db.prepare(`INSERT INTO attendance (school_id, academic_year_id, student_id, division_id, date, status, remarks, marked_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insLog = db.prepare(`INSERT INTO attendance_audit_logs (attendance_id, student_id, date, new_status, new_remarks, reason, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const day of schoolDays) {
      for (const s of students) {
        if (day === T && unmarkedToday.has(s.division.label)) continue;
        const r = rnd();
        let status = 'present', remarks = null;
        if (r > s.rate) { status = 'absent'; remarks = rnd() < 0.6 ? pick(REMARKS) : null; }
        else if (r > s.rate - 0.03) status = 'late';
        else if (r > s.rate - 0.045) status = 'half_day';
        const ts = `${day} 03:${String(30 + Math.floor(rnd() * 25)).padStart(2, '0')}:00`;
        const res = insAtt.run(schoolId, yearId, s.id, s.division.id, day, status, remarks, s.division.ct.uid, ts, ts);
        insLog.run(Number(res.lastInsertRowid), s.id, day, status, remarks, 'Initial marking', s.division.ct.uid, ts);
      }
    }
    // a realistic edit with audit trail for the demo class yesterday-ish
    const editDay = schoolDays.filter((d) => d < T).slice(-1)[0];
    const rohan = students.find((s) => s.demo === 'student');
    const ra = get('SELECT * FROM attendance WHERE student_id=? AND date=?', rohan.id, editDay);
    if (ra) {
      run(`UPDATE attendance SET status='late', remarks='Reached at 8:20 AM (bus delay)' WHERE id=?`, ra.id);
      run(`INSERT INTO attendance_audit_logs (attendance_id, student_id, date, old_status, new_status, old_remarks, new_remarks, reason, changed_by) VALUES (?,?,?,?,?,?,?,?,?)`,
        ra.id, rohan.id, editDay, ra.status, 'late', ra.remarks, 'Reached at 8:20 AM (bus delay)', 'Parent informed — student arrived late, not absent', rohan.division.ct.uid);
    }

    // sample attachment PDFs
    const mkPdf = (title, lines) => {
      const buf = toPdf({ title, subtitle: 'Sunrise Public School — Homework worksheet', columns: [{ key: 'q', label: 'No.' }, { key: 't', label: 'Question' }], rows: lines.map((t, i) => ({ q: i + 1, t })) });
      return { name: storage.save(buf, '.pdf'), size: buf.length };
    };
    const HW = {
      ENG: [['Read Chapter %n and answer the questions', 'Read the lesson carefully. Answer Q1–Q5 from the exercise in your notebook. Underline new words and write their meanings.'], ['Essay: My favourite festival', 'Write an essay of 200–250 words. Use at least five adjectives and two similes.'], ['Grammar worksheet — Tenses', 'Complete the attached worksheet on present perfect and past perfect tense.'], ['Letter writing practice', 'Write a formal letter to the Principal requesting permission for a class picnic.']],
      MATH: [['Exercise %n.2 — Q1 to Q10', 'Solve all questions in the fair notebook. Show every step clearly.'], ['Practice sheet: Linear equations', 'Solve the attached practice sheet. Check your answers by substitution.'], ['Mental maths drill', 'Complete 30 questions in 15 minutes. Parents to sign the sheet.'], ['Geometry construction', 'Construct the triangles given in Exercise %n.4 using compass and ruler.']],
      SCI: [['Draw and label the human digestive system', 'Use a pencil. Label at least 8 parts. Write one function of each.'], ['Chapter %n — Back exercise', 'Answer the short and long answer questions of the back exercise.'], ['Project: Water conservation', 'Prepare a chart (A3) on methods of water conservation at home.'], ['Experiment report', 'Write the observation and conclusion of today\'s lab experiment.']],
      SST: [['Map work — Rivers of India', 'Mark the major rivers on the outline map provided in class.'], ['Chapter %n — Question answers', 'Write answers to the questions in the textbook exercise.'], ['Timeline of the freedom struggle', 'Prepare a timeline from 1857 to 1947 with 10 key events.']],
      HIN: [['पाठ %n — प्रश्न उत्तर', 'पाठ के अंत में दिए गए प्रश्नों के उत्तर लिखिए।'], ['निबंध लेखन', '"मेरा प्रिय खेल" विषय पर 150 शब्दों में निबंध लिखिए।']],
      MAR: [['धडा %n — स्वाध्याय', 'धड्याखालील स्वाध्याय वहीत पूर्ण करा.'], ['सुंदर हस्ताक्षर सराव', 'दोन पाने शुद्धलेखन लिहा.']],
      COMP: [['Write a flowchart', 'Draw a flowchart to find the largest of three numbers.'], ['Typing practice', 'Practice typing for 20 minutes and note your words-per-minute.'], ['MS Excel formulas', 'Create a marks sheet using SUM and AVERAGE formulas.']],
    };
    const codeOf = Object.fromEntries(SUBJ.map(([, c], i) => [subjectIds[i], c]));
    const hwDays = schoolDays.filter((d) => d >= addDays(T, -26));
    const insSub = db.prepare(`INSERT INTO homework_submissions (homework_id, student_id, content, status, feedback, submitted_by, submitted_at, reviewed_at, reviewed_by) VALUES (?,?,?,?,?,?,?,?,?)`);
    let hwCount = 0, pdfCount = 0;
    for (const d of divisions) {
      const divStudents = students.filter((s) => s.division.id === d.id);
      for (const day of hwDays) {
        const nHw = day === T ? 2 : 1 + Math.floor(rnd() * 2);
        const used = new Set();
        for (let k = 0; k < nHw; k++) {
          let sidx; do { sidx = Math.floor(rnd() * 7); } while (used.has(sidx)); used.add(sidx);
          const subj = subjectIds[sidx];
          const tch = teacherRows[d.group * 7 + sidx];
          const [title, ins] = pick(HW[codeOf[subj]]);
          const ch = 1 + Math.floor(rnd() * 9);
          const due = addDays(day, 1 + Math.floor(rnd() * 3));
          const selected = rnd() < 0.06;
          const hid = run(`INSERT INTO homework (school_id, academic_year_id, division_id, subject_id, teacher_id, created_by, title, instructions, homework_date, due_date, allow_submission, assign_to, created_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          schoolId, yearId, d.id, subj, tch.id, tch.uid, title.replace('%n', ch), ins.replace('%n', ch), day, due, rnd() < 0.8 ? 1 : 0, selected ? 'selected' : 'class', `${day} 09:${String(10 + k * 7).padStart(2, '0')}:00`).id;
          hwCount++;
          let audience = divStudents;
          if (selected) { audience = divStudents.filter(() => rnd() < 0.3).slice(0, 6); if (!audience.length) audience = divStudents.slice(0, 3); audience.forEach((s) => run('INSERT INTO homework_assignments (homework_id, student_id) VALUES (?,?)', hid, s.id)); }
          if (rnd() < 0.3 || (d.label === '8-A' && day >= addDays(T, -3))) {
            const p = mkPdf(title.replace('%n', ch), [ins.replace('%n', ch), 'Write neatly and submit on time.', 'Ask your teacher if you have doubts.']);
            run('INSERT INTO homework_attachments (homework_id, original_name, stored_name, mime_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)',
              hid, `${codeOf[subj]}_worksheet_${day}.pdf`, p.name, 'application/pdf', p.size, tch.uid);
            pdfCount++;
          }
          for (const s of audience) {
            const passed = due < T;
            const chance = passed ? 0.75 + (s.rate - 0.8) : day < T ? 0.4 : 0.1;
            if (rnd() < chance) {
              const subAt = `${addDays(day, rnd() < 0.85 ? 1 : 4)} 1${Math.floor(rnd() * 9)}:00:00`;
              const reviewed = passed && rnd() < 0.65;
              insSub.run(hid, s.id, pick(['Completed in notebook', 'Done', 'Completed. Please check.', 'Submitted the worksheet']), reviewed ? 'reviewed' : 'submitted',
                reviewed ? pick(['Good work!', 'Well done', 'Neat handwriting', 'Improve presentation', 'Excellent', null]) : null, s.uid, subAt, reviewed ? `${due} 15:00:00` : null, reviewed ? tch.uid : null);
            }
          }
        }
      }
    }

    // remarks
    const demoCT = divisions.find((d) => d.label === '8-A').ct;
    const REM = [['appreciation', 'Participated actively in the class debate. Keep it up!'], ['academic', 'Needs to practise algebraic expressions more regularly.'], ['behaviour', 'Very helpful to classmates and polite.'], ['general', 'Please ensure the school diary is signed daily.'], ['academic', 'Handwriting has improved a lot this month.']];
    for (const s of students.filter((x) => x.division.label === '8-A' || x.demo)) {
      if (s.demo || rnd() < 0.4) {
        const [cat, txt] = pick(REM);
        run(`INSERT INTO student_remarks (student_id, author_user_id, category, remark, created_at) VALUES (?,?,?,?,?)`, s.id, (s.division.ct).uid, cat, txt, `${addDays(T, -Math.floor(rnd() * 20))} 11:00:00`);
      }
    }
    run(`INSERT INTO student_remarks (student_id, author_user_id, category, remark, created_at) VALUES (?,?,?,?,?)`, rohan.id, demoCT.uid, 'appreciation', 'Scored the highest in the English unit test. Excellent reading skills.', `${addDays(T, -2)} 12:30:00`);

    // announcements
    const ANN = [
      ['Unit Test 2 timetable published', 'Unit Test 2 for Classes 5–10 will be held from the 23rd to 27th of this month. The detailed timetable has been shared with class teachers. Students must carry their ID cards.', 'all', null, 1, adminId, -1],
      ['Parent–Teacher Meeting', 'The PTM for all classes is scheduled on Saturday the 28th from 9:00 AM to 12:30 PM. Parents are requested to meet the class teacher and collect the progress report.', 'parents', null, 1, adminId, -3],
      ['School reopens after Diwali vacation', 'School reopens on Thursday after the Diwali vacation. Regular timings 7:45 AM – 1:30 PM will be followed.', 'all', null, 0, adminId, -5],
      ['Annual Sports Day registrations', 'Registrations for the Annual Sports Day events are open till the 20th. Students can register with their PE teacher.', 'students', null, 0, adminId, -6],
      ['Staff meeting on Monday', 'All teachers are requested to attend a staff meeting in the conference room at 2:00 PM on Monday to discuss the Unit Test 2 plan.', 'teachers', null, 0, adminId, -2],
      ['8-A: Bring science project material', 'Students of 8-A should bring chart paper, sketch pens and glue on Monday for the water conservation project.', 'all', divisions.find((d) => d.label === '8-A').id, 0, demoCT.uid, 0],
    ];
    for (const [title, body, aud, div, imp, by, off] of ANN) {
      run(`INSERT INTO announcements (school_id, title, body, audience, division_id, is_important, published_by, published_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        schoolId, title, body, aud, div, imp, by, `${addDays(T, off)} 0${4 + Math.abs(off % 4)}:15:00`, `${addDays(T, off)} 04:00:00`);
    }

    // calendar events
    const m = T.slice(0, 7);
    const EV = [
      ['Unit Test 2', 'exam', `${m}-23`, `${m}-27`, null, 'Unit Test 2 for Classes 5–10'],
      ['Parent–Teacher Meeting', 'meeting', `${m}-28`, `${m}-28`, null, 'Collect progress reports. 9:00 AM – 12:30 PM'],
      ['Science Exhibition', 'event', addDays(`${m}-01`, 34), addDays(`${m}-01`, 34), null, 'Inter-house science exhibition in the auditorium'],
      ['Annual Sports Day', 'event', addDays(`${m}-01`, 41), addDays(`${m}-01`, 41), null, 'Track and field events. Parents are welcome.'],
      ['8-A Maths class test', 'test', addDays(T, 4), addDays(T, 4), divisions.find((d) => d.label === '8-A').id, 'Chapter 4 & 5'],
      ['Semester 2 begins', 'other', addDays(`${m}-01`, 50), addDays(`${m}-01`, 50), null, ''],
    ];
    for (const [title, type, s, e, div, desc] of EV) {
      run(`INSERT INTO school_calendar (school_id, academic_year_id, title, description, event_type, start_date, end_date, division_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
        schoolId, yearId, title, desc, type, s, e, div, div ? demoCT.uid : adminId);
    }

    // a few notifications for demo accounts
    const demoParentUid = get('SELECT user_id FROM parents WHERE id=?', demoParentId).user_id;
    const lastAbsent = get(`SELECT date FROM attendance WHERE student_id=? AND status='absent' ORDER BY date DESC LIMIT 1`, rohan.id);
    const NOTIF = [
      [demoParentUid, 'notice', 'Important notice: Unit Test 2 timetable published', 'Unit Test 2 for Classes 5–10 will be held from the 23rd…', '#/announcements'],
      [demoParentUid, 'homework', 'New English homework for Rohan', 'Due soon — check the homework section', '#/homework'],
      [demoParentUid, 'remark', 'New teacher remark for Rohan Patil', 'Scored the highest in the English unit test.', '#/remarks'],
      [rohan.uid, 'homework', 'New homework assigned today', 'Open the homework page to see details', '#/homework'],
      [demoCT.uid, 'announcement', 'Staff meeting on Monday', 'All teachers are requested to attend…', '#/announcements'],
    ];
    if (lastAbsent) NOTIF.unshift([demoParentUid, 'attendance', 'Rohan Patil was marked absent', `Attendance for ${lastAbsent.date}: ABSENT`, '#/attendance']);
    for (const [u, type, title, body, link] of NOTIF) run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)', u, type, title, body, link);

    db.exec('COMMIT');
    const counts = Object.fromEntries(['students', 'teachers', 'parents', 'attendance', 'homework', 'homework_submissions'].map((t) => [t, get(`SELECT COUNT(*) n FROM ${t}`).n]));
    console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s:`, counts, `PDF attachments: ${pdfCount}`);
    console.log(`
Demo logins (User ID / Password)
  Admin          : admin            / Admin@123
  Class teacher  : priya.sharma     / Teacher@123   (class teacher of 8-A, teaches English in 8-A…10-B)
  Parent         : sunita.patil     / Parent@123    (children: Rohan 8-A, Ananya 5-B)
  Student        : ${rohan.admissionNo.padEnd(16)} / Student@123   (Rohan Patil, 8-A)
`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

if (isMain) seed();
