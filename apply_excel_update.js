const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const excelPath = path.join(__dirname, 'name-center.xlsx');
const dbPath = path.join(__dirname, 'data', 'timeon.sqlite');

const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets['ส่วนกลาง'];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('Read', rows.length, 'rows from name-center.xlsx');

const deptMap = {
  'ผออ.': 'สำนักงานอำนวยการ',
  'สนอ.': 'สำนักงานอำนวยการ',
  'สลข.ผอ.': 'สำนักงานเลขานุการผู้อำนวยการ',
  'รผอ.บร': 'สำนักงานเลขานุการผู้อำนวยการ',
  'ฝตน.': 'ฝ่ายตรวจสอบภายใน',
  'ฝบร.': 'ฝ่ายบริหารและพัฒนาองค์กร',
  'ฝบง.': 'ฝ่ายบัญชีการเงิน',
  'ฝยศ.': 'ฝ่ายยุทธศาสตร์การพัฒนา',
  'ฝสช.': 'ฝ่ายสินเชื่อ',
  'ฝสบ.': 'ฝ่ายสินเชื่อ',
  'ฝสศ.': 'ฝ่ายส่งเสริมและโครงการพิเศษ',
  'ฝสป.ทร.1': 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1',
  'ฝสป.ทร.2': 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2',
  'สบน.': 'สำนักงานบริหารหนี้'
};

function resolveDept(d, s) {
  d = (d || '').trim();
  s = (s || '').trim();
  if (s === 'สบน.' || d === 'สบน.') return 'สำนักงานบริหารหนี้';
  if (deptMap[d]) return deptMap[d];
  return 'สำนักงานอำนวยการ';
}

function getAvatar(name) {
  if (/^(น\.ส\.|นางสาว|นาง|ด\.ญ\.)/i.test(name)) return '/assets/avatar-female.svg';
  return '/assets/avatar-male.svg';
}

const db = new Database(dbPath);

const updateStmt = db.prepare(`
  UPDATE users 
  SET empCode = @empCode,
      name = @name,
      nickname = @nickname,
      role = @role,
      department = @department,
      email = @email,
      avatar = @avatar,
      isAdmin = @isAdmin,
      isHR = @isHR
  WHERE id = @id
`);

const insertStmt = db.prepare(`
  INSERT INTO users (
    id, empCode, name, nickname, role, department, avatar, phone, email,
    status, statusChangedAt, note, lastHeartbeat, isTabActive, isAdmin, isHR,
    attendanceStatus, attendanceLocation, attendanceCheckInTime, attendanceCheckInTimestamp
  ) VALUES (
    @id, @empCode, @name, @nickname, @role, @department, @avatar, @phone, @email,
    @status, @statusChangedAt, @note, @lastHeartbeat, @isTabActive, @isAdmin, @isHR,
    @attendanceStatus, @attendanceLocation, @attendanceCheckInTime, @attendanceCheckInTimestamp
  )
`);

const allUsers = db.prepare('SELECT * FROM users').all();
const userByCode = new Map();
const userByName = new Map();
allUsers.forEach(u => {
  if (u.empCode) userByCode.set(u.empCode, u);
  const cleanName = u.name.replace(/^(นาย|น\.ส\.|นาง|ว่าที่\s*ร\.ต\.)\s*/, '').trim();
  userByName.set(cleanName, u);
});

let updated = 0;
let inserted = 0;

const runTx = db.transaction(() => {
  rows.forEach((r, idx) => {
    const rawCode = String(r['รหัสพนักงาน']).trim();
    if (!rawCode) return;
    const title = String(r['คำนำหน้า']).trim();
    const fName = String(r['ชื่อ']).trim();
    const lName = String(r['นามสกุล']).trim();
    const fullName = `${title}${fName} ${lName}`.trim();
    const email = String(r['E-mail']).trim().replace(/[\t\r\n]/g, '');
    let role = String(r['ตำแหน่ง']).trim();
    if (rawCode === '07170164') role = 'หัวหน้าสำนักงานบริหารหนี้ (ระดับ 8)';
    const dept = resolveDept(r['สังกัด'], r['__EMPTY_1']);

    let user = userByCode.get(rawCode);
    if (!user) {
      if (rawCode === '07171111') user = userByCode.get('07170001');
      if (!user) user = userByName.get(`${fName} ${lName}`);
    }

    const nick = String(r['ชื่อเล่น']).trim() || user?.nickname || fName.slice(0, 4);
    const avatar = (user && user.avatar && !user.avatar.includes('images.unsplash.com'))
      ? user.avatar
      : getAvatar(fullName);

    const isAdmin = (/แอดมิน|สารสนเทศ|คอมพิวเตอร์|admin/i.test(role) || ['07170065', '07170183', '07171111', '07170184', '07170185', '07170209'].includes(rawCode)) ? 1 : 0;
    const isHR = (/HR|ทรัพยากรบุคคล/i.test(role) || ['07170185', '07170209'].includes(rawCode)) ? 1 : 0;

    if (user) {
      updateStmt.run({
        id: user.id,
        empCode: rawCode,
        name: fullName,
        nickname: nick,
        role,
        department: dept,
        email,
        avatar,
        isAdmin,
        isHR
      });
      updated++;
    } else {
      const newId = 'u' + (allUsers.length + inserted + 1);
      const now = Date.now();
      insertStmt.run({
        id: newId,
        empCode: rawCode,
        name: fullName,
        nickname: nick,
        role,
        department: dept,
        avatar,
        phone: '02-211-7300 ต่อ ' + String(100 + idx).padStart(3, '0'),
        email,
        status: 'available',
        statusChangedAt: now,
        note: 'พร้อมปฏิบัติงาน 💻',
        lastHeartbeat: now,
        isTabActive: 1,
        isAdmin,
        isHR,
        attendanceStatus: 'checked_in',
        attendanceLocation: 'WFH',
        attendanceCheckInTime: '08:30',
        attendanceCheckInTimestamp: now - 3600 * 1000
      });
      inserted++;
    }
  });
});

runTx();
console.log('Update complete. Updated:', updated, 'Inserted:', inserted);
