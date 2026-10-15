const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function testTables() {
  const buffer = fs.readFileSync('C:/Users/FMO-10/Downloads/ถือจ่ายปีงบประมาณ_2570 ตรวจสอบ WFH.pdf');
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  
  for (let i = 0; i < 4; i++) {
    try {
      const tables = await parser.getPageTables(i);
      console.log('Page ' + (i+1) + ' tables count:', tables ? tables.length : 0);
      if (tables && tables.length > 0) {
        fs.writeFileSync('page_' + (i+1) + '_table.json', JSON.stringify(tables, null, 2), 'utf8');
      }
    } catch (e) {
      console.log('Error page ' + (i+1) + ':', e.message);
    }
  }
}
testTables().catch(console.error);
