#!/usr/bin/env node
/**
 * TimeOn - Reset Employee PIN Script
 * Usage:
 *   node scripts/reset-pin.js <empCode หรือ userId>
 * Examples:
 *   node scripts/reset-pin.js 07170015
 *   node scripts/reset-pin.js u15
 *   node scripts/reset-pin.js --all   (รีเซ็ต PIN พนักงานทุกคน)
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../data/timeon.sqlite');
console.log('--------------------------------------------------');
console.log(' 🔐 TimeOn - สคริปต์รีเซ็ตรหัส PIN พนักงาน');
console.log(' 📁 SQLite DB:', dbPath);
console.log('--------------------------------------------------');

const target = process.argv[2];
if (!target) {
  console.log('⚠️  กรุณาระบุรหัสพนักงาน หรือ User ID เช่น:');
  console.log('   node scripts/reset-pin.js 07170015');
  console.log('   node scripts/reset-pin.js u15');
  console.log('   node scripts/reset-pin.js --all');
  console.log('--------------------------------------------------');
  process.exit(1);
}

try {
  const db = new Database(dbPath);

  if (target === '--all') {
    const res = db.prepare('UPDATE users SET pin = NULL').run();
    console.log(`✅ รีเซ็ตรหัส PIN ของพนักงานทุกคนเรียบร้อยแล้ว (${res.changes} รายการ)`);
    console.log('👉 พนักงานทุกคนจะต้องตั้งรหัส PIN 4 หลักใหม่เมื่อเข้าสู่ระบบ');
    console.log('--------------------------------------------------');
    process.exit(0);
  }

  const user = db.prepare('SELECT id, empCode, name, department, pin FROM users WHERE empCode = ? OR id = ?').get(target, target);
  if (!user) {
    console.error(`❌ ไม่พบพนักงานที่ตรงกับรหัส "${target}" ในฐานข้อมูล`);
    console.log('--------------------------------------------------');
    process.exit(1);
  }

  db.prepare('UPDATE users SET pin = NULL WHERE id = ?').run(user.id);
  console.log(`✅ รีเซ็ตรหัส PIN สำเร็จเรียบร้อยแล้ว!`);
  console.log(`   - รหัสพนักงาน: ${user.empCode}`);
  console.log(`   - ชื่อ-สกุล:   ${user.name}`);
  console.log(`   - ฝ่ายงาน:     ${user.department}`);
  console.log(`👉 พนักงานสามารถเปิดหน้าเว็บและตั้งรหัส PIN 4 หลักใหม่ 2 ครั้งได้ทันที`);
  console.log('--------------------------------------------------');
} catch (err) {
  console.error('❌ เกิดข้อผิดพลาด:', err.message);
  console.log('--------------------------------------------------');
  process.exit(1);
}
