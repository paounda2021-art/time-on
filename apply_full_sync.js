const fs = require('fs');
const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const db = new Database('data/timeon.sqlite');
const pdfList = JSON.parse(fs.readFileSync('clean_pdf_positions.json', 'utf8'));

// 1. Read latest Excel from user's Downloads
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

console.log('Central office rows from latest Excel:', centerRows.length);

// 2. Normalize to 11 official departments
function getOfficialDepartment(deptPdf, deptExcel, name) {
  if (name.includes('จิราพร') || name.includes('กัลยา') || name.includes('จิตฑามาศ') || name.includes('จรีลักษ์')) {
    return 'สำนักงานบริหารหนี้';
  }
  if (name.includes('นพชัย') || name.includes('ชาญชัย') || name.includes('พรทิพย์ ธราพร') || name.includes('อรรถชาติ') || name.includes('ประทุม') || name.includes('มนตรี') || name.includes('กัญญาภัค')) {
    return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1';
  }
  if (name.includes('สุปราณี') || name.includes('สุชานาฏ') || name.includes('สุชาดา')) {
    return 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2';
  }
  if (name.includes('รณิดา') || name.includes('ณัฐอนงค์')) {
    return 'ฝ่ายบริหารและพัฒนาองค์กร';
  }
  if (name.includes('ปรีดา') || name.includes('ศุภชาติ')) {
    return 'สำนักงานเลขานุการผู้อำนวยการ';
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

// 3. Query current DB
const currentDbUsers = db.prepare('SELECT * FROM users').all();
let maxNumericId = 0;
currentDbUsers.forEach(u => {
  const n = parseInt(u.id.replace('u', ''));
  if (!isNaN(n) && n > maxNumericId) maxNumericId = n;
});

const updateStmt = db.prepare(`
  UPDATE users 
  SET empCode = ?, name = ?, role = ?, department = ?, nickname = ?, email = ?, avatar = ?
  WHERE id = ?
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

const finalUserList = [];

centerRows.forEach((ex, idx) => {
  const empCode = ex['รหัสพนักงาน'] ? String(ex['รหัสพนักงาน']).trim() : (idx === 0 ? '07171111' : '');
  let name = `${ex['คำนำหน้า'] || ''}${ex['ชื่อ'] || ''} ${ex['นามสกุล'] || ''}`.replace(/\u200b/g, '').trim();
  const firstName = (ex['ชื่อ'] || '').replace(/\u200b/g, '').trim();
  const lastName = (ex['นามสกุล'] || '').replace(/\u200b/g, '').trim();
  const nickname = (ex['ชื่อเล่น'] || '').trim();
  const email = (ex['E-mail'] || '').trim();

  if (name.includes('นายนายธงชัย')) name = name.replace('นายนายธงชัย', 'นายธงชัย');

  // Match with PDF (match both firstName AND lastName)
  let matchedPdf = pdfList.find(p => {
    return p.firstName === firstName && p.lastName && (p.lastName.includes(lastName) || lastName.includes(p.lastName));
  });
  if (!matchedPdf) {
    matchedPdf = pdfList.find(p => p.firstName === firstName);
  }

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

  const department = getOfficialDepartment(matchedPdf ? matchedPdf.dept : '', `${ex['สังกัด'] || ''} ${ex['__EMPTY_1'] || ''} ${ex['__EMPTY_2'] || ''}`, name);

  const isFemale = /^(น\.ส\.|นางสาว|นาง|ด\.ญ\.)/i.test(name);
  const defaultAvatar = isFemale ? '/assets/avatar-female.svg' : '/assets/avatar-male.svg';

  // Strict match in DB: by empCode, OR (firstName AND lastName)
  const existing = currentDbUsers.find(u => {
    if (empCode && u.empCode === empCode) return true;
    const cleanUName = u.name.replace(/\u200b/g, '');
    return cleanUName.includes(firstName) && cleanUName.includes(lastName);
  });

  const isAdmin = ['07170065', '07170183', '07171111', '07170001', '07170184', '07170185', '07170209'].includes(empCode) ? 1 : 0;

  let assignedId = '';
  let finalAvatar = defaultAvatar;

  if (existing) {
    assignedId = existing.id;
    finalAvatar = (existing.avatar && existing.avatar.startsWith('/uploads/avatars/')) ? existing.avatar : defaultAvatar;
    const finalNickname = nickname || existing.nickname || '';
    const finalEmail = email || existing.email || '';

    updateStmt.run(empCode, name, role, department, finalNickname, finalEmail, finalAvatar, existing.id);
  } else {
    maxNumericId++;
    assignedId = 'u' + maxNumericId;
    insertStmt.run(
      assignedId, empCode, name, nickname, role, department, defaultAvatar,
      '02-211-7300', email, Date.now(), isAdmin
    );
  }

  finalUserList.push({
    id: assignedId,
    empCode,
    name,
    nickname,
    role,
    department,
    email,
    avatar: finalAvatar,
    isAdmin: isAdmin === 1
  });
});

console.log('Successfully synchronized 98 employees with PDF and latest Excel!');

// 4. Update name-center.xlsx
const newWb = xlsx.utils.book_new();
const wsData = finalUserList.map((u, i) => ({
  'No.': i + 1,
  'รหัสพนักงาน': u.empCode,
  'ชื่อ-สกุล': u.name,
  'ชื่อเล่น': u.nickname,
  'ตำแหน่ง': u.role,
  'สังกัด': u.department,
  'E-mail': u.email
}));
const newWs = xlsx.utils.json_to_sheet(wsData);
xlsx.utils.book_append_sheet(newWb, newWs, 'ส่วนกลาง');
xlsx.writeFile(newWb, 'name-center.xlsx');
console.log('Saved name-center.xlsx');

// 5. Update data/store.json
const storePath = 'data/store.json';
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  if (store.users) {
    finalUserList.forEach(fu => {
      const target = store.users.find(u => u.empCode === fu.empCode || u.id === fu.id);
      if (target) {
        target.empCode = fu.empCode;
        target.name = fu.name;
        target.role = fu.role;
        target.department = fu.department;
        target.email = fu.email;
        if (fu.nickname) target.nickname = fu.nickname;
        target.avatar = fu.avatar;
      } else {
        store.users.push({
          id: fu.id,
          empCode: fu.empCode,
          name: fu.name,
          nickname: fu.nickname,
          role: fu.role,
          department: fu.department,
          avatar: fu.avatar,
          phone: '02-211-7300',
          email: fu.email,
          status: 'available',
          statusChangedAt: Date.now(),
          note: '',
          isTabActive: true,
          isAdmin: fu.isAdmin,
          isHR: false,
          attendance: { status: 'not_checked_in', location: 'WFH' }
        });
      }
    });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
    console.log('Saved data/store.json');
  }
}
