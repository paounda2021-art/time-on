// Script to reset attendance and mock data, keeping the 4 real users:
// u6  (น.ส.กนกกร ศิลา) - เช็คอิน 08:51
// u20 (น.ส.ภาพิมน ทรัพย์ประเสริฐ) - เช็คอิน 09:11
// u89 (น.ส.รณิดา โชติธนาอุดม) - เช็คอิน 08:02
// u90 (น.ส.ณัฐอนงค์ แสงจันทร์งาม) - เช็คอิน 11:22 (ทานข้าวกลางวัน 1 ชม.)

const Database = require('better-sqlite3');
const path = require('path');

const dbFile = path.join(__dirname, 'data', 'timeon.sqlite');
console.log('Connecting to database:', dbFile);
const db = new Database(dbFile);

const keepIds = ['u6', 'u20', 'u89', 'u90'];
const now = Date.now();

console.log('Keeping active users intact:', keepIds.join(', '));

// 1. Reset all other 94 employees to fresh state
const resetStmt = db.prepare(`
  UPDATE users SET
    status = 'offline',
    statusChangedAt = ?,
    note = '',
    breakUntil = NULL,
    isTabActive = 0,
    attendanceStatus = 'not_checked_in',
    attendanceLocation = 'WFH',
    attendanceCheckInTime = NULL,
    attendanceCheckInTimestamp = NULL,
    attendanceCheckOutTime = NULL,
    attendanceCheckOutTimestamp = NULL,
    attendanceNote = ''
  WHERE id NOT IN ('u6', 'u20', 'u89', 'u90')
`);

const resUsers = resetStmt.run(now);
console.log(`Reset ${resUsers.changes} users to 'not_checked_in' / 'offline'.`);

// 2. Clean attendance_logs for all other users
const delAttStmt = db.prepare(`DELETE FROM attendance_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`);
const resAtt = delAttStmt.run();
console.log(`Deleted ${resAtt.changes} mock attendance logs.`);

// 3. Clean activity_logs for all other users
const delActStmt = db.prepare(`DELETE FROM activity_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`);
const resAct = delActStmt.run();
console.log(`Deleted ${resAct.changes} mock activity logs.`);

// 4. Verify kept users
const keptUsers = db.prepare(`
  SELECT id, empCode, name, nickname, status, note, breakUntil, attendanceStatus, attendanceCheckInTime, attendanceLocation
  FROM users
  WHERE id IN ('u6', 'u20', 'u89', 'u90')
  ORDER BY attendanceCheckInTime ASC
`).all();

console.log('\nVerified Kept Users (4 ท่าน):');
console.table(keptUsers);

// 5. Verify total counts
const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
const checkedIn = db.prepare(`SELECT COUNT(*) as count FROM users WHERE attendanceStatus = 'checked_in'`).get().count;
const notCheckedIn = db.prepare(`SELECT COUNT(*) as count FROM users WHERE attendanceStatus = 'not_checked_in'`).get().count;

console.log('\nSummary:');
console.log('- Total Users in system:', totalUsers);
console.log('- Checked In (Active):', checkedIn);
console.log('- Not Checked In (Waiting to check in):', notCheckedIn);

db.close();
console.log('\nDone successfully!');
