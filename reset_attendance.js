// Script to reset attendance and mock data, keeping ONLY the 3 active users:
// u20 (น.ส.ภาพิมน ทรัพย์ประเสริฐ)
// u89 (น.ส.รณิดา โชติธนาอุดม)
// u90 (น.ส.ณัฐอนงค์ แสงจันทร์งาม)

const Database = require('better-sqlite3');
const path = require('path');

const dbFile = path.join(__dirname, 'data', 'timeon.sqlite');
console.log('Connecting to database:', dbFile);
const db = new Database(dbFile);

const keepIds = ['u20', 'u89', 'u90'];
const now = Date.now();

console.log('Keeping active users intact:', keepIds.join(', '));

// 1. Reset all other 95 employees to fresh state
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
  WHERE id NOT IN ('u20', 'u89', 'u90')
`);

const resUsers = resetStmt.run(now);
console.log(`Reset ${resUsers.changes} users to 'not_checked_in' / 'offline'.`);

// 2. Clean attendance_logs for all other users
const delAttStmt = db.prepare(`DELETE FROM attendance_logs WHERE userId NOT IN ('u20', 'u89', 'u90')`);
const resAtt = delAttStmt.run();
console.log(`Deleted ${resAtt.changes} mock attendance logs.`);

// 3. Clean activity_logs for all other users
const delActStmt = db.prepare(`DELETE FROM activity_logs WHERE userId NOT IN ('u20', 'u89', 'u90')`);
const resAct = delActStmt.run();
console.log(`Deleted ${resAct.changes} mock activity logs.`);

// 4. Verify kept users
const keptUsers = db.prepare(`SELECT id, empCode, name, status, note, breakUntil, attendanceStatus, attendanceCheckInTime FROM users WHERE id IN ('u20', 'u89', 'u90')`).all();
console.log('\nVerified Kept Users:');
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
