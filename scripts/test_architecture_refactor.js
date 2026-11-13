'use strict';
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 4060;
const HOST = '127.0.0.1';

async function run() {
  console.log('=== Starting Test Server for Architecture & Routing Verification ===');
  const serverProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', d => console.log('[Server stdout]', d.toString().trim()));
  serverProc.stderr.on('data', d => console.error('[Server stderr]', d.toString().trim()));

  await new Promise(r => setTimeout(r, 1500));

  function request(urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://${HOST}:${PORT}${urlPath}`, { headers }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            buffer
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    // 1. Clean Routing Tests
    console.log('\n[1] Testing Clean Page Routing:');
    const routes = [
      ['/', 200, 'index.html content'],
      ['/bras', 200, 'bras page'],
      ['/panties', 200, 'panties page'],
      ['/sets', 200, 'sets page'],
      ['/accessories', 200, 'accessories page'],
      ['/body-shaper', 200, 'body-shaper page'],
      ['/camisole', 200, 'camisole page'],
      ['/product', 200, 'product page'],
      ['/exchange', 200, 'exchange page'],
      ['/admin', 200, 'admin page'],
      ['/reel', 200, 'reel page'],
      // Legacy compatibility
      ['/bras.html', 200, 'legacy bras.html'],
      ['/admin.html', 200, 'legacy admin.html']
    ];

    for (const [r, expectedStatus, label] of routes) {
      const res = await request(r);
      if (res.statusCode !== expectedStatus) {
        throw new Error(`Route ${r} expected ${expectedStatus}, got ${res.statusCode}`);
      }
      console.log(`    ✓ ${r.padEnd(16)} -> ${res.statusCode} (${label})`);
    }

    // 2. CSS & JS Static Asset Serving with Gzip
    console.log('\n[2] Testing Static Assets & Gzip Compression:');
    const assets = [
      ['/css/common.css', 'text/css; charset=utf-8'],
      ['/css/home.css', 'text/css; charset=utf-8'],
      ['/css/product.css', 'text/css; charset=utf-8'],
      ['/css/category.css', 'text/css; charset=utf-8'],
      ['/css/admin.css', 'text/css; charset=utf-8'],
      ['/css/exchange.css', 'text/css; charset=utf-8'],
      ['/css/reel.css', 'text/css; charset=utf-8'],
      ['/js/state.js', 'text/javascript; charset=utf-8'],
      ['/js/router.js', 'text/javascript; charset=utf-8'],
      ['/js/home.js', 'text/javascript; charset=utf-8'],
      ['/js/product.js', 'text/javascript; charset=utf-8'],
      ['/js/category.js', 'text/javascript; charset=utf-8'],
      ['/js/admin.js', 'text/javascript; charset=utf-8'],
      ['/js/exchange.js', 'text/javascript; charset=utf-8'],
      ['/js/reel.js', 'text/javascript; charset=utf-8']
    ];

    for (const [assetPath, expectedMime] of assets) {
      const res = await request(assetPath, { 'Accept-Encoding': 'gzip' });
      if (res.statusCode !== 200) {
        throw new Error(`Asset ${assetPath} returned status ${res.statusCode}`);
      }
      if (res.headers['content-type'] !== expectedMime) {
        throw new Error(`Asset ${assetPath} expected MIME ${expectedMime}, got ${res.headers['content-type']}`);
      }
      if (res.headers['content-encoding'] !== 'gzip') {
        throw new Error(`Asset ${assetPath} missing gzip encoding!`);
      }
      const unzipped = zlib.gunzipSync(res.buffer);
      console.log(`    ✓ ${assetPath.padEnd(20)} -> 200 (MIME: ${expectedMime.split(';')[0]}, Wire: ${res.buffer.length} B, Unzipped: ${unzipped.length} B)`);
    }

    // 3. Security Boundary Checks
    console.log('\n[3] Testing Security Boundaries:');
    const sensitive = ['/server.js', '/package.json', '/data/her-second-skin.sqlite', '/.env', '/.git'];
    for (const s of sensitive) {
      const res = await request(s);
      if (res.statusCode !== 404 && res.statusCode !== 403) {
        throw new Error(`Security violation! Sensitive file ${s} returned ${res.statusCode}`);
      }
      console.log(`    ✓ ${s.padEnd(28)} -> ${res.statusCode} (Protected/Blocked)`);
    }

    console.log('\n=== ALL ARCHITECTURE & ROUTING TESTS PASSED (100%)! ===');
  } finally {
    serverProc.kill();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
