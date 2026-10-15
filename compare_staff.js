const fs = require('fs');

const excelCenter = JSON.parse(fs.readFileSync('center_employees.json', 'utf8'));
const pdfPeople = JSON.parse(fs.readFileSync('parsed_pdf_people.json', 'utf8'));

console.log('Excel Center:', excelCenter.length);
console.log('PDF People:', pdfPeople.length);

// Compare matches
const matched = [];
const excelOnly = [];
const pdfOnly = [];

excelCenter.forEach(ex => {
  const pMatch = pdfPeople.find(p => 
    p.firstName === ex.firstName || 
    (p.lastName && ex.lastName && (p.lastName.includes(ex.lastName) || ex.lastName.includes(p.lastName)))
  );
  if (pMatch) {
    matched.push({
      empCode: ex.empCode,
      name: ex.fullName,
      excelRole: ex.role,
      pdfRawRest: pMatch.rawRest,
      pdfDept: pMatch.currentDept,
      pdfLine: pMatch.line
    });
  } else {
    excelOnly.push(ex);
  }
});

pdfPeople.forEach(p => {
  const exMatch = excelCenter.find(ex => 
    ex.firstName === p.firstName || 
    (ex.lastName && p.lastName && (ex.lastName.includes(p.lastName) || p.lastName.includes(ex.lastName)))
  );
  if (!exMatch) {
    pdfOnly.push(p);
  }
});

console.log(`Matched: ${matched.length}, Excel Only: ${excelOnly.length}, PDF Only: ${pdfOnly.length}`);
console.log('\nExcel Only:', excelOnly.map(e => `${e.empCode} ${e.fullName} (${e.role})`));
console.log('\nPDF Only:', pdfOnly.map(p => `${p.no} ${p.fullName} (${p.rawRest})`));

fs.writeFileSync('comparison_result.json', JSON.stringify({ matched, excelOnly, pdfOnly }, null, 2), 'utf8');
