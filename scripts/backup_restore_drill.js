'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.HSS_DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = process.env.HSS_DATABASE_PATH || path.join(DATA_DIR, 'her-second-skin.sqlite');
const UPLOAD_DIR = process.env.HSS_UPLOAD_DIR || path.join(ROOT, 'uploads');
const BACKUP_DIR = path.join(ROOT, 'backups', 'drill_' + Date.now());

console.log('--- TASK 01: SQLite & Media Backup + Verified Restore Drill ---');

// 1. Ensure DB exists or initialize it
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const mainDb = new DatabaseSync(DB_PATH);
mainDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
mainDb.exec('CREATE TABLE IF NOT EXISTS test_backup_marker (id TEXT PRIMARY KEY, created_at TEXT);');
mainDb.exec(`INSERT OR REPLACE INTO test_backup_marker VALUES ('test-01', datetime('now'));`);
mainDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
mainDb.close();

// 2. Perform Backup
const backupDbPath = path.join(BACKUP_DIR, 'her-second-skin.sqlite');
fs.copyFileSync(DB_PATH, backupDbPath);
console.log('Backed up SQLite database to:', backupDbPath);

// Copy sample uploads if any
const backupUploadDir = path.join(BACKUP_DIR, 'uploads');
fs.mkdirSync(backupUploadDir, { recursive: true });
if (fs.existsSync(UPLOAD_DIR)) {
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    fs.copyFileSync(path.join(UPLOAD_DIR, file), path.join(backupUploadDir, file));
  }
}
console.log('Backed up uploads directory to:', backupUploadDir);

// 3. Isolated Restore Verification
const restoreDir = path.join(BACKUP_DIR, 'restore_test');
fs.mkdirSync(restoreDir, { recursive: true });
const restoreDbPath = path.join(restoreDir, 'restored.sqlite');
fs.copyFileSync(backupDbPath, restoreDbPath);

const restoredDb = new DatabaseSync(restoreDbPath);
const integrity = restoredDb.prepare('PRAGMA integrity_check;').all();
console.log('Integrity check result:', integrity);

const marker = restoredDb.prepare("SELECT * FROM test_backup_marker WHERE id = 'test-01';").get();
restoredDb.close();

if (integrity[0]?.integrity_check === 'ok' && marker) {
  console.log('SUCCESS: Task 01 Backup and Restore verified with integrity check OK!');
  process.exit(0);
} else {
  console.error('FAILED: Task 01 Restore verification failed.');
  process.exit(1);
}
