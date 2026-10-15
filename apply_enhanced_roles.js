const fs = require('fs');
const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const db = new Database('data/timeon.sqlite');
const map = JSON.parse(fs.readFileSync('full_position_map.json', 'utf8'));
const users = db.prepare('SELECT id, empCode, name, role, department FROM users').all();

const updateStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');

const updatedUsers = [];

users.forEach(u => {
  const cleanName = u.name.replace(/\u200b/g, '').trim();

  // Find exact full keys first (multi-word keys like 'พรทิพย์ ธราพร', 'กนกกร ศิลา', 'ภานุวัฒน์ ตาลคง')
  let foundRole = null;
  for (const k of Object.keys(map)) {
    if (k.includes(' ') && cleanName.includes(k)) {
      foundRole = map[k];
      break;
    }
  }
  if (!foundRole) {
    for (const k of Object.keys(map)) {
      if (!k.includes(' ') && cleanName.includes(k)) {
        foundRole = map[k];
        break;
      }
    }
  }

  if (foundRole) {
    updateStmt.run(foundRole, u.id);
    u.role = foundRole;
    updatedUsers.push(u);
    console.log(`[UPDATED] ${u.empCode} ${cleanName} -> ${foundRole}`);
  } else {
    console.warn(`[UNMATCHED] ${u.empCode} ${cleanName}`);
  }
});

console.log('Total updated in SQLite:', updatedUsers.length);

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

console.log('All roles updated with full office/department names and levels successfully!');
