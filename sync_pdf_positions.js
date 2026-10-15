const fs = require('fs');
const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const db = new Database('data/timeon.sqlite');
const pdfList = JSON.parse(fs.readFileSync('clean_pdf_positions.json', 'utf8'));

// Normalize to one of the 11 official departments
function getOfficialDepartment(deptPdf, deptExcel, name) {
  // Explicit debt management office staff
  if (name.includes('จิราพร') || name.includes('กัลยา') || name.includes('จิตฑามาศ') || name.includes('จรีลักษ์')) {
    return 'สำนักงานบริหารหนี้';
  }
  // Explicit port 1 staff
  if (name.includes('นพชัย') || name.includes('ชาญชัย') || name.includes('พรทิพย์ ธราพร') || name.includes('อรรถชาติ') || name.includes('ประทุม') || name.includes('มนตรี') || name.includes('กัญญาภัค')) {
    return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1';
  }
  // Port 2 staff
  if (name.includes('สุปราณี') || name.includes('สุชานาฏ') || name.includes('สุชาดา')) {
    return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2';
  }

  const text = `${deptPdf || ''} ${deptExcel || ''}`.trim();

  if (/สบน|บริหารหนี้/i.test(text)) return 'สำนักงานบริหารหนี้';
  if (/ตรวจสอบภายใน|ฝตน/i.test(text)) return 'ฝ่ายตรวจสอบภายใน';
  if (/เลขานุการ|ผออ/i.test(text)) return 'สำนักงานเลขานุการผู้อำนวยการ';
  if (/อำนวยการ|สารบรรณ|ประชาสัมพันธ์|ประชุม|สนอ/i.test(text)) return 'สำนักงานอำนวยการ';
  if (/พัฒนาองค์กร|บุคคล|เจ้าหน้าที่|ฝึกอบรม|สวัสดิการ|วินัย|กฎหมาย|สารสนเทศ|ไอที|ฝบร/i.test(text)) return 'ฝ่ายบริหารและพัฒนาองค์กร';
  if (/บัญชี|การเงิน|พัสดุ|งบประมาณ|ฝบง/i.test(text)) return 'ฝ่ายบัญชีการเงิน';
  if (/ยุทธศาสตร์|แผนงาน|ประเมินผล|วิศวกรรม|ฝยศ/i.test(text)) return 'ฝ่ายยุทธศาสตร์การพัฒนา';
  if (/สินเชื่อ|ฝสช/i.test(text)) return 'ฝ่ายสินเชื่อ';
  if (/ส่งเสริม|ประมง|วิจัย|การตลาด|กิจกรรมสังคม|ฝสศ/i.test(text)) return 'ฝ่ายส่งเสริมและโครงการพิเศษ';
  if (/สะพานปลา.*1|ฝสป\.ทร\.1|สป\.กท|สบ\.1/i.test(text)) return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1';
  if (/สะพานปลา.*2|ฝสป\.ทร\.2|สบ\.2/i.test(text)) return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2';

  return 'สำนักงานอำนวยการ';
}

// Read latest Excel
const wb = xlsx.readFile('C:/Users/FMO-10/Downloads/อัพเดตรายชื่อ 141069-11.57น.xlsx');
const excelRows = xlsx.utils.sheet_to_json(wb.Sheets['Sheet1']);

const centerRows = [];
let isCenter = false;
for (const r of excelRows) {
  if (r['No.'] === 'ส่วนกลาง') {
    isCenter = true;
    continue;
  }
  if (r['No.'] === 'ส่วนภูมิภาค') {
    break;
  }
  if (isCenter && r['ชื่อ'] && r['นามสกุล']) {
    centerRows.push(r);
  }
}

console.log('Center rows from latest Excel:', centerRows.length);

// Read current SQLite users
const currentDbUsers = db.prepare('SELECT * FROM users').all();
let maxNumericId = 0;
currentDbUsers.forEach(u => {
  const n = parseInt(u.id.replace('u', ''));
  if (!isNaN(n) && n > maxNumericId) maxNumericId = n;
});

const updateStmt = db.prepare(`
  UPDATE users 
  SET name = ?, role = ?, department = ?, nickname = ?, email = ?, avatar = ?
  WHERE empCode = ? OR id = ?
`);

const insertStmt = db.prepare(`
  INSERT INTO users (
    id, empCode, name, nickname, role, department, avatar, phone, email,
    status, statusChangedAt, note, isTabActive, isAdmin, isHR, attendanceStatus, attendanceLocation
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?,
    'available', ?, '', 1, ?, 0, 'not_checked_in', 'WFH'
  )
`);

let updatedCount = 0;
let insertedCount = 0;

centerRows.forEach((ex, idx) => {
  const empCode = ex['รหัสพนักงาน'] ? String(ex['รหัสพนักงาน']).trim() : (idx === 0 ? '07171111' : '');
  let name = `${ex['คำนำหน้า'] || ''}${ex['ชื่อ'] || ''} ${ex['นามสกุล'] || ''}`.replace(/\u200b/g, '').trim();
  const firstName = (ex['ชื่อ'] || '').replace(/\u200b/g, '').trim();
  const lastName = (ex['นามสกุล'] || '').replace(/\u200b/g, '').trim();
  const nickname = (ex['ชื่อเล่น'] || '').trim();
  const email = (ex['E-mail'] || '').trim();

  // Fix typos
  if (name.includes('นายนายธงชัย')) name = name.replace('นายนายธงชัย', 'นายธงชัย');

  // Match with PDF
  let matchedPdf = pdfList.find(p => {
    return p.firstName === firstName || 
      (lastName.length >= 3 && p.lastName && (p.lastName.includes(lastName) || lastName.includes(p.lastName)));
  });

  // Determine official Role according to PDF & User specifics
  let role = '';
  if (empCode === '07170090' || name.includes('นพชัย')) {
    role = 'เจ้าหน้าที่นโยบายและแผน'; // Explicit user prompt
  } else if (empCode === '07170164' || name.includes('จิราพร พงษ์ศิริ')) {
    role = 'หัวหน้าสำนักงานบริหารหนี้ (ระดับ 8)'; // Explicit user prompt 6
  } else if (empCode === '07170115' || name.includes('กัลยา วงศ์สุวรรณ')) {
    role = 'เจ้าหน้าที่นโยบายและแผน';
  } else if (empCode === '07170167' || name.includes('จิตฑามาศ ผลงาม')) {
    role = 'เจ้าหน้าที่บริหารงานทั่วไป';
  } else if (empCode === '07170041' || name.includes('จรีลักษ์ เมืองอุดม')) {
    role = 'เจ้าหน้าที่การเงินและบัญชี(ก/ง)';
  } else if (matchedPdf) {
    role = matchedPdf.role;
  } else {
    role = (ex['ตำแหน่ง'] || '').trim();
  }

  // Normalize Department
  const department = getOfficialDepartment(matchedPdf ? matchedPdf.dept : '', `${ex['สังกัด'] || ''} ${ex['__EMPTY_1'] || ''} ${ex['__EMPTY_2'] || ''}`, name);

  // Avatar
  const isFemale = /^(น\.ส\.|นางสาว|นาง|ด\.ญ\.)/i.test(name);
  const avatar = isFemale ? '/assets/avatar-female.svg' : '/assets/avatar-male.svg';

  // Check if exists in DB
  const existing = currentDbUsers.find(u => 
    (empCode && u.empCode === empCode) || 
    u.name.replace(/\u200b/g, '').includes(firstName)
  );

  const isAdmin = ['07170065', '07170183', '07171111', '07170001', '07170184', '07170185', '07170209'].includes(empCode) ? 1 : 0;

  if (existing) {
    // Preserve custom avatar if uploaded, otherwise use gender avatar
    const finalAvatar = (existing.avatar && existing.avatar.startsWith('/uploads/avatars/')) ? existing.avatar : avatar;
    const finalNickname = nickname || existing.nickname || '';
    const finalEmail = email || existing.email || '';

    updateStmt.run(name, role, department, finalNickname, finalEmail, finalAvatar, existing.empCode, existing.id);
    updatedCount++;
    console.log(`[UPDATE] ${empCode} ${name} -> Role: "${role}" | Dept: "${department}"`);
  } else {
    maxNumericId++;
    const newId = 'u' + maxNumericId;
    insertStmt.run(
      newId, empCode, name, nickname, role, department, avatar,
      '02-211-7300', email, Date.now(), isAdmin
    );
    insertedCount++;
    console.log(`[INSERT] ${newId} ${empCode} ${name} -> Role: "${role}" | Dept: "${department}"`);
  }
});

console.log(`Done! Updated: ${updatedCount}, Inserted: ${insertedCount}`);

// Verify total count in DB
const totalNow = db.prepare('SELECT count(*) as count FROM users').get();
console.log('Total users in DB now:', totalNow.count);
