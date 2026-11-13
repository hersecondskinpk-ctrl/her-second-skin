'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const srcDir = 'C:\\Users\\talal\\.gemini\\antigravity\\scratch\\hss_project\\website';
const zipPath = 'C:\\Users\\talal\\Downloads\\HerSecondSkinPK_v9_Final_Validated_Consolidated.zip';

console.log('Creating backup zip archive...');
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
  console.log('Removed old zip:', zipPath);
}

// Clean up scratch_test_data if present
const scratchDir = path.join(srcDir, 'scratch_test_data');
if (fs.existsSync(scratchDir)) {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

// Use powershell Compress-Archive excluding scratch_test_data
const psCommand = `powershell -NoProfile -Command "Get-ChildItem -Path '${srcDir}' -Exclude 'scratch_test_data','*.bak' | Compress-Archive -DestinationPath '${zipPath}' -Force"`;
execSync(psCommand, { stdio: 'inherit' });

const stat = fs.statSync(zipPath);
console.log('Created zip successfully:');
console.log(`  Path: ${zipPath}`);
console.log(`  Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);
console.log(`  Modified: ${stat.mtime}`);
