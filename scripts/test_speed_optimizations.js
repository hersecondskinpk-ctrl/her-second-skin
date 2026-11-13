'use strict';
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 4059;
const HOST = '127.0.0.1';

async function run() {
  console.log('--- Starting local server for Speed Optimizations verification ---');
  const serverProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', d => console.log('[Server stdout]', d.toString().trim()));
  serverProc.stderr.on('data', d => console.error('[Server stderr]', d.toString().trim()));

  // Wait for server to be up
  await new Promise(r => setTimeout(r, 1200));

  function fetchAsset(urlPath, sendGzip = true) {
    return new Promise((resolve, reject) => {
      const headers = sendGzip ? { 'Accept-Encoding': 'gzip, deflate' } : {};
      const req = http.request(`http://${HOST}:${PORT}${urlPath}`, { headers }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            rawBytes: rawBuffer.length,
            buffer: rawBuffer
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    // 1. Test index.html with gzip
    console.log('\n[1] Testing GET / (index.html) with Accept-Encoding: gzip');
    const gzipHome = await fetchAsset('/');
    console.log(`    Status: ${gzipHome.statusCode}`);
    console.log(`    Content-Encoding: ${gzipHome.headers['content-encoding']}`);
    console.log(`    Vary: ${gzipHome.headers['vary']}`);
    console.log(`    Wire bytes received: ${gzipHome.rawBytes}`);

    if (gzipHome.headers['content-encoding'] !== 'gzip') {
      throw new Error(`Expected content-encoding gzip, got: ${gzipHome.headers['content-encoding']}`);
    }

    const unzippedHome = zlib.gunzipSync(gzipHome.buffer);
    console.log(`    Decompressed size: ${unzippedHome.length} bytes`);
    const savings = ((1 - gzipHome.rawBytes / unzippedHome.length) * 100).toFixed(1);
    console.log(`    Savings: ${savings}% reduction!`);

    // 2. Test index.html WITHOUT gzip (legacy clients)
    console.log('\n[2] Testing GET / without Accept-Encoding');
    const rawHome = await fetchAsset('/', false);
    console.log(`    Status: ${rawHome.statusCode}`);
    console.log(`    Content-Encoding: ${rawHome.headers['content-encoding'] || 'none (raw)'}`);
    console.log(`    Wire bytes received: ${rawHome.rawBytes}`);

    // 3. Test hss-fonts.css
    console.log('\n[3] Testing GET /hss-fonts.css with gzip');
    const gzipCss = await fetchAsset('/hss-fonts.css');
    console.log(`    Status: ${gzipCss.statusCode}`);
    console.log(`    Content-Encoding: ${gzipCss.headers['content-encoding']}`);
    console.log(`    Wire bytes: ${gzipCss.rawBytes}`);
    const unzippedCss = zlib.gunzipSync(gzipCss.buffer);
    console.log(`    Decompressed size: ${unzippedCss.length} bytes`);
    const cssContent = unzippedCss.toString('utf8');
    if (cssContent.includes('@import')) {
      throw new Error('Found render-blocking @import in hss-fonts.css!');
    }
    console.log('    ✓ Verified: hss-fonts.css has no render-blocking @import!');

    // 4. Test font binary serving
    console.log('\n[4] Testing GET /fonts/GothamCondensed-Book.woff');
    const fontRes = await fetchAsset('/fonts/GothamCondensed-Book.woff');
    console.log(`    Status: ${fontRes.statusCode}`);
    console.log(`    Content-Type: ${fontRes.headers['content-type']}`);
    console.log(`    Font bytes: ${fontRes.rawBytes}`);

    console.log('\n=== ALL SPEED & COMPRESSION TESTS PASSED! ===');
  } finally {
    serverProc.kill();
  }
}

run().catch(err => {
  console.error('Speed test failed:', err);
  process.exit(1);
});
