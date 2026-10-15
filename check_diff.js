const db = require('better-sqlite3')('data/timeon.sqlite');
const fs = require('fs');

const pdf = JSON.parse(fs.readFileSync('clean_pdf_positions.json', 'utf8'));
const users = db.prepare('SELECT id, empCode, name, role, department FROM users').all();

console.log('=== Checking Mismatches ===');
let diffCount = 0;
users.forEach(u => {
  const cleanName = u.name.replace(/\u200b/g, '').trim();
  const pMatch = pdf.find(p => cleanName.includes(p.firstName) && (cleanName.includes(p.lastName) || p.lastName.includes(cleanName.split(' ').pop())));
  if (pMatch) {
    if (u.role !== pMatch.role) {
      diffCount++;
      console.log('[DIFF] ' + u.empCode + ' ' + u.name + ': Current="' + u.role + '" --> PDF="' + pMatch.role + '" (Level: ' + pMatch.level + ')');
    }
  } else {
    console.log('[NOT IN PDF] ' + u.empCode + ' ' + u.name + ': Current="' + u.role + '"');
  }
});
console.log('Total differences:', diffCount);
