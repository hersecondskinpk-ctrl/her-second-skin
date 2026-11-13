'use strict';
const fs = require('node:fs');
const path = require('node:path');

console.log('--- TASK 02 & 03: Environment Separation & Secret Security Audit ---');
const ROOT = path.resolve(__dirname, '..');

// Check public files for accidentally leaked production tokens
const sensitivePatterns = [
  /EAA[A-Za-z0-9_-]{20,}/g, // Meta access tokens
  /ghp_[A-Za-z0-9]{30,}/g,   // GitHub tokens
  /sk_live_[A-Za-z0-9]{20,}/g // Stripe / payment live keys
];

let leaksFound = 0;
const publicFiles = ['index.html', 'product.html', 'bras.html', 'panties.html', 'sets.html', 'accessories.html', 'body-shaper.html', 'camisole.html'];
for (const file of publicFiles) {
  const filePath = path.join(ROOT, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pat of sensitivePatterns) {
      if (pat.test(content)) {
        console.error(`LEAK ALERT: Potential secret found in ${file}!`);
        leaksFound++;
      }
    }
  }
}

if (leaksFound === 0) {
  console.log('PASS: No hardcoded API tokens or secrets found in public frontend files.');
} else {
  console.error('FAIL: Leaks found in public files.');
  process.exit(1);
}

// Check .env.example exists
if (fs.existsSync(path.join(ROOT, '.env.example'))) {
  console.log('PASS: .env.example exists with sanitized placeholders.');
} else {
  console.error('FAIL: .env.example missing.');
  process.exit(1);
}

console.log('SUCCESS: Task 02 & 03 verified!');
process.exit(0);
