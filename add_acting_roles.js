const fs = require('fs');
const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const db = new Database('data/timeon.sqlite');

const actingUpdates = [
  {
    empCode: '07170184',
    name: 'นายศุภชาติ ชาสมบัติ',
    actingRole: 'ด้านบริหาร (ระดับ 10) (รักษาการ รผอ.สป.ทร. / ปฏิบัติหน้าที่ รผอ.พกป.)'
  },
  {
    empCode: '07170078',
    name: 'นายธนชัย ฉายศรี',
    actingRole: 'เจ้าหน้าที่ตรวจสอบภายใน (ระดับ 8) (รักษาการในตำแหน่ง ผฝ.ตน.)'
  },
  {
    empCode: '07170200',
    name: 'น.ส.เขมิกา สกุลแพทย์',
    actingRole: 'เจ้าหน้าที่บริหารงานทั่วไป (ระดับ 7) (รักษาการในตำแหน่ง หผ.อร.)'
  },
  {
    empCode: '07170034',
    name: 'นางสุรนีย์ วรรณประพัฒน์',
    actingRole: 'หัวหน้าสำนักงานยุทธศาสตร์และแผนงาน (ระดับ 8) (รักษาการในตำแหน่ง หส.วส.)'
  },
  {
    empCode: '07170062',
    name: 'นายปฏิยุทธ์ กิจไพบูลทวี',
    actingRole: 'เจ้าหน้าที่สินเชื่อ (ระดับ 7) (รักษาการในตำแหน่ง หส.ธสช. และ หส.สวสช.)'
  },
  {
    empCode: '07170063',
    name: 'ว่าที่ร.ต.สุภชัย เจริญอินทร์',
    actingRole: 'เจ้าหน้าที่สินเชื่อ (ระดับ 7) (รักษาการในตำแหน่ง หส.บสช.)'
  },
  {
    empCode: '07170175',
    name: 'นายวสันต์ชัย ใจน้อย',
    actingRole: 'หัวหน้าสำนักงานบริหารโครงการพิเศษ (ระดับ 8) (รักษาการในตำแหน่ง ผฝ.สศ.)'
  },
  {
    empCode: '07170174',
    name: 'นางพรทิพย์ ธราพร',
    actingRole: 'หัวหน้าสำนักงานบริหารสะพานปลาและท่าเทียบเรือประมง 1 (ระดับ 8) (รักษาการแทน หส.บ.2)'
  },
  {
    empCode: '07170046',
    name: 'นายอิทธิชัย โพธิ์งาม',
    actingRole: 'เจ้าหน้าที่ธุรการ (ระดับ 5) (รักษาการในตำแหน่ง หผ.ธส.)'
  }
];

const updateStmt = db.prepare('UPDATE users SET role = ? WHERE empCode = ?');

actingUpdates.forEach(item => {
  const res = updateStmt.run(item.actingRole, item.empCode);
  console.log(`Updated ${item.empCode} ${item.name} -> ${item.actingRole} (changes: ${res.changes})`);
});

// Update name-center.xlsx
const allRows = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
const newWb = xlsx.utils.book_new();
const wsData = allRows.map((u, i) => ({
  'No.': i + 1,
  'รหัสพนักงาน': u.empCode,
  'ชื่อ-สกุล': u.name,
  'ชื่อเล่น': u.nickname || '',
  'ตำแหน่ง': u.role,
  'สังกัด': u.department,
  'E-mail': u.email || ''
}));
const ws = xlsx.utils.json_to_sheet(wsData);
xlsx.utils.book_append_sheet(newWb, ws, 'ส่วนกลาง');
xlsx.writeFile(newWb, 'name-center.xlsx');
console.log('Saved name-center.xlsx');

// Update data/store.json
const storePath = 'data/store.json';
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  allRows.forEach(u => {
    const target = (store.users || []).find(su => su.empCode === u.empCode || su.id === u.id);
    if (target) {
      target.role = u.role;
      target.department = u.department;
    }
  });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  console.log('Saved data/store.json');
}

console.log('Acting roles updated successfully!');
