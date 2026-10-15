const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('C:/Users/FMO-10/Downloads/อัพเดตรายชื่อ 141069-11.57น.xlsx');
const ws = wb.Sheets['Sheet1'];
const rows = xlsx.utils.sheet_to_json(ws);

const centerEmployees = [];
const regionalEmployees = [];
let currentSection = 'ส่วนกลาง';

rows.forEach((r, idx) => {
  if (r['No.'] === 'ส่วนกลาง') {
    currentSection = 'ส่วนกลาง';
    return;
  }
  if (r['No.'] === 'ส่วนภูมิภาค') {
    currentSection = 'ส่วนภูมิภาค';
    return;
  }
  if (!r['ชื่อ'] || !r['นามสกุล']) return;
  
  const emp = {
    no: r['No.'],
    empCode: r['รหัสพนักงาน'] ? String(r['รหัสพนักงาน']).trim() : '',
    title: r['คำนำหน้า'] || '',
    firstName: (r['ชื่อ'] || '').trim(),
    lastName: (r['นามสกุล'] || '').trim(),
    fullName: `${r['คำนำหน้า'] || ''}${r['ชื่อ'] || ''} ${r['นามสกุล'] || ''}`.trim(),
    nickname: (r['ชื่อเล่น'] || '').trim(),
    email: (r['E-mail'] || '').trim(),
    role: (r['ตำแหน่ง'] || '').trim(),
    dept: (r['สังกัด'] || '').trim(),
    subDept: (r['__EMPTY_1'] || r['__EMPTY_2'] || '').trim(),
    section: currentSection
  };
  
  if (currentSection === 'ส่วนกลาง') {
    centerEmployees.push(emp);
  } else {
    regionalEmployees.push(emp);
  }
});

console.log('Center employees count:', centerEmployees.length);
console.log('Regional employees count:', regionalEmployees.length);
fs.writeFileSync('center_employees.json', JSON.stringify(centerEmployees, null, 2), 'utf8');
fs.writeFileSync('regional_employees.json', JSON.stringify(regionalEmployees, null, 2), 'utf8');
