'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('       HER SECOND SKIN PK — COMPREHENSIVE TEST SUITE           ');
console.log('   Unit Testing & Security / Vulnerability Assessment QA       ');
console.log('================================================================\n');

const testSuites = [
  {
    name: 'Unit Tests: Frontend State & Client Router',
    cmd: 'node',
    args: ['--test', 'tests/unit/state_and_router.test.js'],
    category: 'UNIT_TESTS'
  },
  {
    name: 'Unit Tests: Backend Business Logic & Sanitization',
    cmd: 'node',
    args: ['--test', 'tests/unit/business_logic.test.js'],
    category: 'UNIT_TESTS'
  },
  {
    name: 'Security Tests: OWASP Traversal, Auth, SQLi & Rate Limits',
    cmd: 'node',
    args: ['--test', 'tests/security/security_suite.test.js'],
    category: 'SECURITY_TESTS'
  },
  {
    name: 'Security Audit: Secret Tokens & Leakage Prevention',
    cmd: 'node',
    args: ['scripts/test_env_security.js'],
    category: 'SECURITY_TESTS'
  },
  {
    name: 'Architecture & Routing: Decoupled CSS/JS & Clean URLs',
    cmd: 'node',
    args: ['scripts/test_architecture_refactor.js'],
    category: 'REGRESSION_TESTS'
  },
  {
    name: 'Visual Regression: Mobile Category Grid & Transparency',
    cmd: 'node',
    args: ['scripts/test_category_mobile_and_transparency.js'],
    category: 'REGRESSION_TESTS'
  },
  {
    name: 'Typography: Gotham Condensed Font Rendering',
    cmd: 'node',
    args: ['scripts/test_fonts_verification.js'],
    category: 'REGRESSION_TESTS'
  }
];

let totalSuites = 0;
let passedSuites = 0;
let failedSuites = 0;

for (const suite of testSuites) {
  totalSuites++;
  console.log(`▶ Running [${suite.category}] ${suite.name}...`);
  const start = Date.now();
  const res = spawnSync(suite.cmd, suite.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  const duration = Date.now() - start;

  if (res.status === 0) {
    passedSuites++;
    console.log(`✔ [PASS] ${suite.name} (${duration}ms)\n`);
  } else {
    failedSuites++;
    console.error(`✖ [FAIL] ${suite.name} (exited with code ${res.status})\n`);
  }
}

console.log('================================================================');
console.log('                   MASTER TEST SUMMARY REPORT                   ');
console.log('================================================================');
console.log(`Total Test Suites Executed: ${totalSuites}`);
console.log(`Suites Passed:              ${passedSuites} (100%)`);
console.log(`Suites Failed:              ${failedSuites}`);
console.log('Status:                     ' + (failedSuites === 0 ? 'ALL TESTS PASSED ✅' : 'FAILURES DETECTED ❌'));
console.log('================================================================\n');

if (failedSuites > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
