const db = require('better-sqlite3')('data/timeon.sqlite');
const fs = require('fs');

const excelCenter = JSON.parse(fs.readFileSync('center_employees.json', 'utf8'));
const dbUsers = db.prepare('SELECT * FROM users').all();

console.log('Excel Center count:', excelCenter.length);
console.log('DB Users count:', dbUsers.length);

const inExcelNotDB = [];
excelCenter.forEach(ex => {
  const match = dbUsers.find(u => 
    (ex.empCode && u.empCode === ex.empCode) ||
    u.name.replace(/\u200b/g, '').includes(ex.firstName)
  );
  if (!match) {
    inExcelNotDB.push(ex);
  }
});

const inDBNotExcel = [];
dbUsers.forEach(u => {
  const cleanName = u.name.replace(/\u200b/g, '');
  const match = excelCenter.find(ex => 
    (u.empCode && ex.empCode === u.empCode) ||
    cleanName.includes(ex.firstName)
  );
  if (!match) {
    inDBNotExcel.push(u);
  }
});

console.log('In latest Excel (Center) but NOT in DB:', inExcelNotDB.length);
inExcelNotDB.forEach(e => console.log(' +', e.empCode, e.fullName, e.role, e.dept));

console.log('In DB but NOT in latest Excel (Center):', inDBNotExcel.length);
inDBNotExcel.forEach(u => console.log(' -', u.empCode, u.name, u.role, u.department));
