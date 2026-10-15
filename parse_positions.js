const fs = require('fs');

const people = JSON.parse(fs.readFileSync('parsed_pdf_people.json', 'utf8'));

// Each rawRest is like: "ผู้อานวยการองค์การสะพานปลา 11"
// "ด้านบริหาร 10 รักษาการในตาแหน่ง รผอ.สป.ทร. อีกหน้าที่หนึ่ง"
// "เจ้าหน้าที่ตรวจสอบภายใน 8 รักษาการในตาแหน่ง ผฝ.ตน. 1 ตค.68"
// "หัวหน้าสานักงาน 8 ทาหน้าที่ประสานงานกับสานักงานรัฐมนตรี"
// "เจ้าหน้าที่บริหารงานทั่วไป 6"
// "หัวหน้าแผนก 7"
// "บุคลากร 6"
// "นิติกร 4"

const result = [];

people.forEach(p => {
  let rest = p.rawRest.trim();
  
  // Replace OCR anomalies like 'ผู้อานวยการ' -> 'ผู้อำนวยการ', 'สานักงาน' -> 'สำนักงาน', 'ตาแหน่ง' -> 'ตำแหน่ง', 'ทาหน้าที่' -> 'ทำหน้าที่'
  rest = rest
    .replace(/ผู้อานวยการ/g, 'ผู้อำนวยการ')
    .replace(/สานักงาน/g, 'สำนักงาน')
    .replace(/ตาแหน่ง/g, 'ตำแหน่ง')
    .replace(/ทาหน้าที่/g, 'ทำหน้าที่')
    .replace(/ประจา/g, 'ประจำ')
    .replace(/นา ้/g, 'น้ำ')
    .replace(/กากับดูแล/g, 'กำกับดูแล')
    .replace(/สายคาเคือง/g, 'สายคำเคือง')
    .replace(/คาสั่ง/g, 'คำสั่ง');

  // Match: (Position) (Level: 1 or 2 digits) (Optional Note: rest)
  // Levels are usually 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
  const m = rest.match(/^(.+?)\s+(\d{1,2})\s*(.*)$/);
  let role = '';
  let level = '';
  let note = '';
  
  if (m) {
    role = m[1].trim();
    level = m[2].trim();
    note = m[3].trim();
  } else {
    role = rest;
  }
  
  let dept = p.currentDept
    .replace(/สานักงาน/g, 'สำนักงาน')
    .replace(/ฝ่ำย/g, 'ฝ่าย')
    .replace(/ภำยใน/g, 'ภายใน')
    .replace(/บริหำรและพัฒนำองค์กร/g, 'บริหารและพัฒนาองค์กร')
    .replace(/บัญชีกำรเงิน/g, 'บัญชีการเงิน')
    .replace(/ยุทธศำสตร์กำรพัฒนำ/g, 'ยุทธศาสตร์การพัฒนา')
    .replace(/ส่งเสริมและโครงกำรพิเศษ/g, 'ส่งเสริมและโครงการพิเศษ')
    .replace(/สะพำนปลำและท่ำเทียบเรือประมง/g, 'สะพานปลาและท่าเทียบเรือประมง');

  result.push({
    no: p.no,
    name: p.fullName,
    firstName: p.firstName,
    lastName: p.lastName,
    role,
    level,
    note,
    dept
  });
});

fs.writeFileSync('clean_pdf_positions.json', JSON.stringify(result, null, 2), 'utf8');
console.log('Saved clean_pdf_positions.json with', result.length, 'records');
