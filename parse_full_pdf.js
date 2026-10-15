const fs = require('fs');
const pdf = require('pdf-parse');

const pdfPath = 'ถือจ่ายปีงบประมาณ_2570 ตรวจสอบ WFH.pdf';
const dataBuffer = fs.readFileSync(pdfPath);

pdf(dataBuffer).then(function(data) {
  console.log('Number of pages:', data.numpages);
  console.log('Number of rendered pages:', data.numrender);
  console.log('Text length:', data.text.length);
  fs.writeFileSync('extracted_pdf_full.txt', data.text, 'utf8');
  console.log('Saved to extracted_pdf_full.txt');
}).catch(function(err) {
  console.error('Error parsing PDF:', err);
});
