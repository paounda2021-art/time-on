// TimeOn - SQLite Database Module (better-sqlite3)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'timeon.sqlite');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'avatars');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// Helper to save Base64 avatar as image file in public/uploads/avatars/
function saveAvatarFile(empCodeOrId, base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return base64Data;
  if (!base64Data.startsWith('data:image/')) return base64Data; // Already a URL / path

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return base64Data;
    const buffer = Buffer.from(matches[2], 'base64');
    const safeCode = (empCodeOrId || 'user_' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${safeCode}.jpg`;
    const fullPath = path.join(UPLOADS_DIR, fileName);
    fs.writeFileSync(fullPath, buffer);
    return `/uploads/avatars/${fileName}?v=${Date.now()}`;
  } catch (err) {
    console.error('Error saving avatar image file:', err.message);
    return base64Data;
  }
}

// Get default silhouette avatar based on title prefix (คำนำหน้าชื่อ)
function getDefaultAvatarByName(name) {
  const n = (name || '').trim();
  // Female prefixes: น.ส., นางสาว, นาง, ด.ญ.
  if (/^(น\.ส\.|นางสาว|นาง|ด\.ญ\.)/i.test(n)) {
    return '/assets/avatar-female.svg';
  }
  // Male prefixes (นาย, ว่าที่ ร.ต., etc.) or fallback
  return '/assets/avatar-male.svg';
}

// Update existing users with gender-based default avatars if not custom-uploaded
function applyDefaultGenderAvatars() {
  const rows = db.prepare('SELECT id, name, avatar FROM users').all();
  const updateStmt = db.prepare('UPDATE users SET avatar = ? WHERE id = ?');
  const updateMany = db.transaction(() => {
    rows.forEach(r => {
      if (!r.avatar || r.avatar.includes('images.unsplash.com') || r.avatar.includes('placeholder')) {
        updateStmt.run(getDefaultAvatarByName(r.name), r.id);
      }
    });
  });
  updateMany();
}

// Initialize SQLite Schema
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      empCode TEXT UNIQUE,
      name TEXT NOT NULL,
      nickname TEXT,
      role TEXT,
      department TEXT,
      avatar TEXT,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'available',
      statusChangedAt INTEGER,
      note TEXT DEFAULT '',
      breakUntil INTEGER,
      lastHeartbeat INTEGER,
      isTabActive INTEGER DEFAULT 1,
      isAdmin INTEGER DEFAULT 0,
      isHR INTEGER DEFAULT 0,
      attendanceStatus TEXT DEFAULT 'not_checked_in',
      attendanceLocation TEXT DEFAULT 'WFH',
      attendanceCheckInTime TEXT,
      attendanceCheckInTimestamp INTEGER,
      attendanceCheckOutTime TEXT,
      attendanceCheckOutTimestamp INTEGER,
      attendanceNote TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      action TEXT,
      location TEXT,
      time TEXT,
      timestamp INTEGER,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      type TEXT,
      fromStatus TEXT,
      toStatus TEXT,
      note TEXT,
      timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS nudges (
      id TEXT PRIMARY KEY,
      fromUserId TEXT,
      fromUserName TEXT,
      fromUserNickname TEXT,
      fromUserAvatar TEXT,
      fromUserRole TEXT,
      toUserId TEXT,
      toUserName TEXT,
      message TEXT,
      timestamp INTEGER,
      read INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_users_dept ON users(department);
    CREATE INDEX IF NOT EXISTS idx_users_empCode ON users(empCode);
    CREATE INDEX IF NOT EXISTS idx_att_timestamp ON attendance_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_act_timestamp ON activity_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_nudges_toUser ON nudges(toUserId, read);
  `);
}

initSchema();

// User mapper: SQLite row -> Frontend JSON model
function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    empCode: row.empCode,
    name: row.name,
    nickname: row.nickname || '',
    role: row.role || '',
    department: row.department || '',
    avatar: row.avatar || '',
    phone: row.phone || '',
    email: row.email || '',
    status: row.status || 'available',
    statusChangedAt: row.statusChangedAt || Date.now(),
    note: row.note || '',
    breakUntil: row.breakUntil || null,
    lastHeartbeat: row.lastHeartbeat || Date.now(),
    isTabActive: row.isTabActive === 1,
    isAdmin: row.isAdmin === 1,
    isHR: row.isHR === 1,
    attendance: {
      status: row.attendanceStatus || 'not_checked_in',
      location: row.attendanceLocation || 'WFH',
      checkInTime: row.attendanceCheckInTime || null,
      checkInTimestamp: row.attendanceCheckInTimestamp || null,
      checkOutTime: row.attendanceCheckOutTime || null,
      checkOutTimestamp: row.attendanceCheckOutTimestamp || null,
      note: row.attendanceNote || ''
    }
  };
}

// User Operations
const getUsersStmt = db.prepare('SELECT * FROM users ORDER BY id ASC');
function getAllUsers() {
  const rows = getUsersStmt.all();
  return rows.map(mapUserRow);
}

const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
function getUserById(id) {
  const row = getUserByIdStmt.get(id);
  return mapUserRow(row);
}

const getUserByEmpCodeStmt = db.prepare('SELECT * FROM users WHERE empCode = ?');
function getUserByEmpCode(code) {
  const row = getUserByEmpCodeStmt.get(code);
  return mapUserRow(row);
}

const insertOrReplaceUserStmt = db.prepare(`
  INSERT OR REPLACE INTO users (
    id, empCode, name, nickname, role, department, avatar, phone, email,
    status, statusChangedAt, note, breakUntil, lastHeartbeat, isTabActive,
    isAdmin, isHR, attendanceStatus, attendanceLocation, attendanceCheckInTime,
    attendanceCheckInTimestamp, attendanceCheckOutTime, attendanceCheckOutTimestamp, attendanceNote
  ) VALUES (
    @id, @empCode, @name, @nickname, @role, @department, @avatar, @phone, @email,
    @status, @statusChangedAt, @note, @breakUntil, @lastHeartbeat, @isTabActive,
    @isAdmin, @isHR, @attendanceStatus, @attendanceLocation, @attendanceCheckInTime,
    @attendanceCheckInTimestamp, @attendanceCheckOutTime, @attendanceCheckOutTimestamp, @attendanceNote
  )
`);

function saveUser(u) {
  // If avatar is base64, save to image file in uploads/avatars
  let avatarPath = u.avatar;
  if (avatarPath && avatarPath.startsWith('data:image/')) {
    avatarPath = saveAvatarFile(u.empCode || u.id, avatarPath);
    u.avatar = avatarPath;
  } else if (!avatarPath || avatarPath.includes('images.unsplash.com') || avatarPath.includes('placeholder')) {
    avatarPath = getDefaultAvatarByName(u.name);
    u.avatar = avatarPath;
  }

  const att = u.attendance || {};
  insertOrReplaceUserStmt.run({
    id: u.id,
    empCode: u.empCode,
    name: u.name,
    nickname: u.nickname || '',
    role: u.role || '',
    department: u.department || '',
    avatar: avatarPath || '',
    phone: u.phone || '',
    email: u.email || '',
    status: u.status || 'available',
    statusChangedAt: u.statusChangedAt || Date.now(),
    note: u.note || '',
    breakUntil: u.breakUntil || null,
    lastHeartbeat: u.lastHeartbeat || Date.now(),
    isTabActive: u.isTabActive ? 1 : 0,
    isAdmin: u.isAdmin ? 1 : 0,
    isHR: u.isHR ? 1 : 0,
    attendanceStatus: att.status || 'not_checked_in',
    attendanceLocation: att.location || 'WFH',
    attendanceCheckInTime: att.checkInTime || null,
    attendanceCheckInTimestamp: att.checkInTimestamp || null,
    attendanceCheckOutTime: att.checkOutTime || null,
    attendanceCheckOutTimestamp: att.checkOutTimestamp || null,
    attendanceNote: att.note || ''
  });
  return getUserById(u.id);
}

const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');
function deleteUser(id) {
  try {
    deleteUserStmt.run(id);
    return true;
  } catch (err) {
    console.error('Error deleting user:', err.message);
    return false;
  }
}

// Attendance Logs
const getAttendanceLogsStmt = db.prepare('SELECT * FROM attendance_logs ORDER BY timestamp DESC LIMIT ?');
function getAttendanceLogs(limit = 100) {
  try {
    return getAttendanceLogsStmt.all(limit);
  } catch (err) {
    console.error('Error fetching attendance logs:', err.message);
    return [];
  }
}

const getAttendanceLogsByRangeStmt = db.prepare('SELECT * FROM attendance_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC');
function getAttendanceLogsByDateRange(startTs, endTs) {
  try {
    return getAttendanceLogsByRangeStmt.all(startTs, endTs);
  } catch (err) {
    console.error('Error fetching attendance logs by range:', err.message);
    return [];
  }
}

const insertAttendanceLogStmt = db.prepare(`
  INSERT INTO attendance_logs (id, userId, userName, action, location, time, timestamp, note)
  VALUES (@id, @userId, @userName, @action, @location, @time, @timestamp, @note)
`);
function addAttendanceLog(log) {
  try {
    insertAttendanceLogStmt.run(log);
  } catch (err) {
    console.error('Error adding attendance log:', err.message);
  }
}

// Activity Logs
const getActivityLogsStmt = db.prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?');
function getActivityLogs(limit = 50) {
  try {
    return getActivityLogsStmt.all(limit);
  } catch (err) {
    console.error('Error fetching activity logs:', err.message);
    return [];
  }
}

const insertActivityLogStmt = db.prepare(`
  INSERT INTO activity_logs (id, userId, userName, type, fromStatus, toStatus, note, timestamp)
  VALUES (@id, @userId, @userName, @type, @fromStatus, @toStatus, @note, @timestamp)
`);
function addActivityLog(log) {
  try {
    insertActivityLogStmt.run(log);
  } catch (err) {
    console.error('Error adding activity log:', err.message);
  }
}

// Nudges
const getNudgesStmt = db.prepare('SELECT * FROM nudges ORDER BY timestamp DESC LIMIT 200');
function getNudges() {
  const rows = getNudgesStmt.all();
  return rows.map(r => ({
    id: r.id,
    fromUser: {
      id: r.fromUserId,
      name: r.fromUserName,
      nickname: r.fromUserNickname,
      avatar: r.fromUserAvatar,
      role: r.fromUserRole
    },
    toUserId: r.toUserId,
    toUserName: r.toUserName,
    message: r.message,
    timestamp: r.timestamp,
    read: r.read === 1
  }));
}

const insertNudgeStmt = db.prepare(`
  INSERT INTO nudges (
    id, fromUserId, fromUserName, fromUserNickname, fromUserAvatar, fromUserRole,
    toUserId, toUserName, message, timestamp, read
  ) VALUES (
    @id, @fromUserId, @fromUserName, @fromUserNickname, @fromUserAvatar, @fromUserRole,
    @toUserId, @toUserName, @message, @timestamp, @read
  )
`);
function addNudge(nudge) {
  insertNudgeStmt.run({
    id: nudge.id,
    fromUserId: nudge.fromUser?.id || '',
    fromUserName: nudge.fromUser?.name || '',
    fromUserNickname: nudge.fromUser?.nickname || '',
    fromUserAvatar: nudge.fromUser?.avatar || '',
    fromUserRole: nudge.fromUser?.role || '',
    toUserId: nudge.toUserId,
    toUserName: nudge.toUserName || '',
    message: nudge.message,
    timestamp: nudge.timestamp || Date.now(),
    read: nudge.read ? 1 : 0
  });
}

const markNudgesReadStmt = db.prepare('UPDATE nudges SET read = 1 WHERE toUserId = ?');
function markNudgesAsRead(userId) {
  markNudgesReadStmt.run(userId);
}

// Migration from store.json into SQLite
function migrateFromStoreJson(storeJsonPath) {
  if (!fs.existsSync(storeJsonPath)) return false;

  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (countRow.count >= 90) {
    console.log(`SQLite already populated with ${countRow.count} users.`);
    return false;
  }

  try {
    const raw = fs.readFileSync(storeJsonPath, 'utf8');
    const data = JSON.parse(raw);

    console.log(`Migrating ${data.users ? data.users.length : 0} users to SQLite...`);

    const insertMany = db.transaction((users, attLogs, actLogs, nudges) => {
      if (users) {
        users.forEach(u => saveUser(u));
      }
      if (attLogs) {
        attLogs.forEach(l => {
          try { addAttendanceLog(l); } catch(e) {}
        });
      }
      if (actLogs) {
        actLogs.forEach(l => {
          try { addActivityLog(l); } catch(e) {}
        });
      }
      if (nudges) {
        nudges.forEach(n => {
          try { addNudge(n); } catch(e) {}
        });
      }
    });

    insertMany(data.users || [], data.attendanceLogs || [], data.activityLogs || [], data.nudges || []);
    console.log('Migration to SQLite completed successfully!');
    return true;
  } catch (err) {
    console.error('Migration failed:', err);
    return false;
  }
}

module.exports = {
  db,
  saveAvatarFile,
  getAllUsers,
  getUserById,
  getUserByEmpCode,
  saveUser,
  deleteUser,
  getAttendanceLogs,
  getAttendanceLogsByDateRange,
  addAttendanceLog,
  getActivityLogs,
  addActivityLog,
  getNudges,
  addNudge,
  markNudgesAsRead,
  migrateFromStoreJson,
  getDefaultAvatarByName,
  applyDefaultGenderAvatars
};
