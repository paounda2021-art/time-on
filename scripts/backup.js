/**
 * TimeOn Production Automated Backup Script
 * Creates a point-in-time consistent SQLite backup before git pull / deployment.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');

function getBangkokTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${year}${month}${day}_${hours}${mins}${secs}`;
}

async function runBackup() {
  console.log('====================================================');
  console.log('📦 Starting TimeOn Pre-Update Backup...');
  console.log('====================================================');

  const rootDir = path.resolve(__dirname, '..');
  const dbFile = path.join(rootDir, 'data', 'timeon.sqlite');
  const localBackupDir = path.join(rootDir, 'data', 'backups');
  const appsBackupDir = path.resolve(rootDir, '..', 'backups');
  const timeonAppsBackupDir = path.join(appsBackupDir, 'time-on');

  if (!fs.existsSync(dbFile)) {
    console.error(`❌ Database file not found: ${dbFile}`);
    process.exit(1);
  }

  // Ensure backup folders exist
  fs.mkdirSync(localBackupDir, { recursive: true });
  if (fs.existsSync(appsBackupDir)) {
    fs.mkdirSync(timeonAppsBackupDir, { recursive: true });
  }

  const ts = getBangkokTimestamp();
  const backupFileName = `timeon_backup_${ts}.sqlite`;
  const localBackupPath = path.join(localBackupDir, backupFileName);
  const appsBackupPath = path.join(timeonAppsBackupDir, backupFileName);

  console.log(`1. Connecting to SQLite: ${dbFile}`);
  const db = new Database(dbFile, { readonly: true });

  const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
  const attCount = db.prepare('SELECT count(*) as c FROM attendance_logs').get().c;
  const actCount = db.prepare('SELECT count(*) as c FROM activity_logs').get().c;

  console.log(`   - Verified users count: ${userCount} users`);
  console.log(`   - Attendance logs: ${attCount}`);
  console.log(`   - Activity logs: ${actCount}`);

  console.log(`2. Performing point-in-time online database backup...`);
  await db.backup(localBackupPath);
  console.log(`   ✓ Local backup saved: ${localBackupPath}`);

  if (fs.existsSync(appsBackupDir)) {
    fs.copyFileSync(localBackupPath, appsBackupPath);
    console.log(`   ✓ Copied to central backups: ${appsBackupPath}`);
  }

  // Create Zip Archive of project code & database
  const zipName = `time-on_backup_${ts}.zip`;
  const zipPath = path.join(appsBackupDir, zipName);
  try {
    console.log(`3. Creating compressed archive: ${zipName}...`);
    if (process.platform === 'win32') {
      const psCmd = `Compress-Archive -Path "${path.join(rootDir, 'public')}", "${localBackupPath}", "${path.join(rootDir, '*.js')}", "${path.join(rootDir, 'package.json')}" -DestinationPath "${zipPath}" -Force`;
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
      if (fs.existsSync(zipPath)) {
        const stats = fs.statSync(zipPath);
        console.log(`   ✓ Full project ZIP created: ${zipPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      }
    }
  } catch (zipErr) {
    console.warn(`   ⚠️ Note: Zip archive step skipped or failed: ${zipErr.message}`);
  }

  console.log('====================================================');
  console.log(`✅ Backup Completed Successfully! (${userCount} employees preserved)`);
  console.log('====================================================');
  return { localBackupPath, zipPath, userCount };
}

if (require.main === module) {
  runBackup().catch((err) => {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  });
}

module.exports = { runBackup };
