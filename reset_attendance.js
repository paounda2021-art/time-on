// Script to reset attendance and mock data, keeping the 4 real users:
// u6  (น.ส.กนกกร ศิลา) - เช็คอิน 08:51
// u20 (น.ส.ภาพิมน ทรัพย์ประเสริฐ) - เช็คอิน 09:11
// u89 (น.ส.รณิดา โชติธนาอุดม) - เช็คอิน 08:02
// u90 (น.ส.ณัฐอนงค์ แสงจันทร์งาม) - เช็คอิน 11:22

const Database = require('better-sqlite3');
const path = require('path');

const dbFile = path.join(__dirname, 'data', 'timeon.sqlite');
console.log('Connecting to database:', dbFile);
const db = new Database(dbFile);

const keepIds = ['u6', 'u20', 'u89', 'u90'];
const now = Date.now();

console.log('Keeping active users intact:', keepIds.join(', '));

// 1. Reset all other 94 employees to fresh offline / not_checked_in state
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

// 2. Explicitly ensure the 4 active users are in 'available' status with check-in time
const setRealStmt = db.prepare(`
  UPDATE users SET
    status = 'available',
    statusChangedAt = ?,
    lastHeartbeat = ?,
    attendanceStatus = 'checked_in',
    attendanceLocation = 'WFH',
    attendanceCheckInTime = ?,
    attendanceCheckInTimestamp = COALESCE(attendanceCheckInTimestamp, ?),
    note = ?
  WHERE id = ?
`);

setRealStmt.run(now, now, '08:51', now, 'พร้อมทำงาน 🟢', 'u6');
setRealStmt.run(now, now, '09:11', now, 'พร้อมทำงาน 🟢', 'u20');
setRealStmt.run(now, now, '08:02', now, 'พร้อมคุยแล้ว 🟢', 'u89');
setRealStmt.run(now, now, '11:22', now, 'พร้อมทำงาน 🟢', 'u90');

// 3. Clean attendance_logs for all other users
const delAttStmt = db.prepare(`DELETE FROM attendance_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`);
const resAtt = delAttStmt.run();
console.log(`Deleted ${resAtt.changes} mock attendance logs.`);

// 4. Clean activity_logs for all other users
const delActStmt = db.prepare(`DELETE FROM activity_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`);
const resAct = delActStmt.run();
console.log(`Deleted ${resAct.changes} mock activity logs.`);

// 5. Verify kept users
const keptUsers = db.prepare(`
  SELECT id, empCode, name, nickname, status, note, breakUntil, attendanceStatus, attendanceCheckInTime, attendanceLocation
  FROM users
  WHERE id IN ('u6', 'u20', 'u89', 'u90')
  ORDER BY attendanceCheckInTime ASC
`).all();

console.log('\nVerified Kept Users (4 ท่าน):');
console.table(keptUsers);

// 6. Verify total counts
const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
const checkedIn = db.prepare(`SELECT COUNT(*) as count FROM users WHERE attendanceStatus = 'checked_in'`).get().count;
const notCheckedIn = db.prepare(`SELECT COUNT(*) as count FROM users WHERE attendanceStatus = 'not_checked_in'`).get().count;

console.log('\nSummary:');
console.log('- Total Users in system:', totalUsers);
console.log('- Checked In (Active):', checkedIn);
console.log('- Not Checked In (Waiting to check in):', notCheckedIn);

db.close();
console.log('\nDone successfully!');
