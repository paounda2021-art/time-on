const fs = require('fs');
const xlsx = require('xlsx');

// 1. Read PDF extracted lines
const pdfLines = fs.readFileSync('pdf_all_pages.txt', 'utf8').split('\n');
const pdfPeople = [];
let currentDept = 'ส่วนกลาง';

// Regex to capture: number title firstName lastName position level notes
for (let line of pdfLines) {
  line = line.trim();
  if (!line || line.startsWith('===') || line.startsWith('ลำดับ') || line.startsWith('บัญชี') || line.startsWith('ประจำปี')) continue;
  
  if (line.startsWith('0 ')) {
    currentDept = line.substring(2).trim();
    continue;
  }
  if (line.startsWith('ฝ่ำย') || line.startsWith('ฝ่าย') || line.startsWith('สำนัก') || line.startsWith('สานัก')) {
    currentDept = line.trim();
    continue;
  }
  
  // match person lines
  // e.g. "1 นายปรีดา ยังสุขสถาพร ผู้อานวยการองค์การสะพานปลา 11"
  // or "น.ส.จรีลักษ์ เมืองอุดม เจ้าหน้าที่การเงินและบัญชี 6 สบน. ยืมอัตรา"
  const match = line.match(/^(\d+)?\s*(นาย|นาง|น\.ส\.|ว่าที่\s*ร\.ต\.|ว่าที่ ร\.ต\.)\s*([^\s]+)\s+([^\s]+)\s+(.+)$/);
  if (match) {
    const no = match[1] || '';
    const title = match[2];
    const firstName = match[3];
    const lastName = match[4];
    const rest = match[5].trim();
    
    // In rest, level is often a number at the end or before notes
    pdfPeople.push({
      line,
      no,
      title,
      firstName,
      lastName,
      fullName: `${title}${firstName} ${lastName}`,
      rawRest: rest,
      currentDept
    });
  } else {
    // maybe note line or non-matching
    console.log('Unmatched line:', line);
  }
}

console.log('Total PDF people parsed:', pdfPeople.length);
fs.writeFileSync('parsed_pdf_people.json', JSON.stringify(pdfPeople, null, 2), 'utf8');
