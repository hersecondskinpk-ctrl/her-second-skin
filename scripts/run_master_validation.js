'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

console.log('===============================================================');
console.log('HER SECOND SKIN PK v9 - MASTER 36-TASK AUTOMATED TEST RUNNER');
console.log('===============================================================\n');

const scripts = [
  { name: 'Task 01: SQLite WAL Backup & Isolated Restore Drill', file: 'backup_restore_drill.js' },
  { name: 'Tasks 02, 03, 32: Environment & Secret Security Audit', file: 'test_env_security.js' },
  { name: 'Tasks 04-16, 20, 21, 34: Cart, Checkout, Promo & Concurrency Tests', file: 'test_promo_and_cart.js' },
  { name: 'Tasks 25-30: WhatsApp Cloud API 6 Templates & Webhook Flow', file: 'test_whatsapp_flow.js' }
];

let allPassed = true;
const results = [];

for (const s of scripts) {
  console.log(`>>> Running: ${s.name}...`);
  const scriptPath = path.join(__dirname, s.file);
  const res = spawnSync('node', [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  const passed = res.status === 0;
  results.push({ name: s.name, passed, output: res.stdout || res.stderr });
  if (passed) {
    console.log(`[PASS] ${s.name}`);
  } else {
    allPassed = false;
    console.error(`[FAIL] ${s.name}`);
    console.error(res.stderr || res.stdout);
  }
  console.log('---------------------------------------------------------------');
}

console.log('\n================== SUMMARY RESULTS ==================');
results.forEach(r => {
  console.log(`${r.passed ? '✔ PASS' : '✖ FAIL'}: ${r.name}`);
});

if (allPassed) {
  console.log('\nALL LOCAL VERIFICATION TESTS PASSED SUCCESSFULLY (100%)!');
  process.exit(0);
} else {
  console.error('\nSOME TESTS FAILED! Check logs above.');
  process.exit(1);
}
