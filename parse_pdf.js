const fs = require('fs');

const data = JSON.parse(fs.readFileSync('pdf_extracted.txt', 'utf8'));
let out = '';
data.pages.forEach((p, idx) => {
  out += '\n=== PAGE ' + (p.num || (idx + 1)) + ' ===\n' + p.text;
});
fs.writeFileSync('pdf_all_pages.txt', out, 'utf8');
console.log('Saved pdf_all_pages.txt, total chars:', out.length);
