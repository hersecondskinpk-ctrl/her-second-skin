'use strict';
const https = require('node:https');
const zlib = require('node:zlib');

function check(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.request(`https://her-second-skin-pk.fly.dev${path}`, {
      headers: { 'Accept-Encoding': 'gzip' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const duration = Date.now() - start;
        const buffer = Buffer.concat(chunks);
        let uncompressed = buffer;
        if (res.headers['content-encoding'] === 'gzip') {
          try {
            uncompressed = zlib.gunzipSync(buffer);
          } catch (e) {
            // keep raw buffer
          }
        }
        resolve({
          path,
          status: res.statusCode,
          duration,
          headers: res.headers,
          bytes: buffer.length,
          uncompressedBytes: uncompressed.length,
          text: uncompressed.toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== VERIFYING LIVE PRODUCTION DEPLOYMENT (her-second-skin-pk.fly.dev) ===\n');

  let allPass = true;

  // 1. Clean routes
  const cleanRoutes = ['/', '/bras', '/panties', '/sets', '/accessories', '/body-shaper', '/camisole', '/product', '/exchange', '/admin'];
  console.log('1. Checking Clean Routing:');
  for (const r of cleanRoutes) {
    const res = await check(r);
    const pass = res.status === 200;
    console.log(`   ${pass ? '✓' : '✗'} GET ${r.padEnd(16)} -> ${res.status} (${res.duration}ms, ${res.bytes} wire bytes)`);
    if (!pass) allPass = false;
  }

  // 2. Modular CSS & JS
  console.log('\n2. Checking Modular Assets & Gzip Compression:');
  const assets = [
    { path: '/css/common.css', mime: 'text/css' },
    { path: '/css/home.css', mime: 'text/css' },
    { path: '/css/product.css', mime: 'text/css' },
    { path: '/css/category.css', mime: 'text/css' },
    { path: '/css/admin.css', mime: 'text/css' },
    { path: '/js/state.js', mime: 'text/javascript' },
    { path: '/js/router.js', mime: 'text/javascript' },
    { path: '/js/home.js', mime: 'text/javascript' },
    { path: '/js/product.js', mime: 'text/javascript' },
    { path: '/js/admin.js', mime: 'text/javascript' },
    { path: '/hss-fonts.css', mime: 'text/css' }
  ];

  for (const a of assets) {
    const res = await check(a.path);
    const hasGzip = res.headers['content-encoding'] === 'gzip';
    const hasMime = res.headers['content-type']?.includes(a.mime);
    const pass = res.status === 200 && hasGzip && hasMime;
    console.log(`   ${pass ? '✓' : '✗'} GET ${a.path.padEnd(20)} -> ${res.status} [${res.headers['content-type']}] [gzip: ${hasGzip}] (${res.bytes} wire / ${res.uncompressedBytes} raw bytes)`);
    if (!pass) allPass = false;
  }

  // 3. Security checks
  console.log('\n3. Checking Security Boundaries:');
  const securityPaths = ['/server.js', '/package.json', '/data/her-second-skin.sqlite', '/.env'];
  for (const p of securityPaths) {
    const res = await check(p);
    const pass = res.status === 404;
    console.log(`   ${pass ? '✓' : '✗'} GET ${p.padEnd(30)} -> ${res.status} (Protected)`);
    if (!pass) allPass = false;
  }

  // 4. Content verification on homepage
  console.log('\n4. Verifying Decoupled Linking in Homepage:');
  const home = await check('/');
  const hasCommonCss = home.text.includes('/css/common.css');
  const hasHomeCss = home.text.includes('/css/home.css');
  const hasRouterJs = home.text.includes('/js/router.js');
  const hasStateJs = home.text.includes('/js/state.js');
  const hasHomeJs = home.text.includes('/js/home.js');
  const noInlineStyle = !home.text.includes('body { margin: 0;');

  console.log(`   ${hasCommonCss ? '✓' : '✗'} Links /css/common.css`);
  console.log(`   ${hasHomeCss ? '✓' : '✗'} Links /css/home.css`);
  console.log(`   ${hasRouterJs ? '✓' : '✗'} Links /js/router.js`);
  console.log(`   ${hasStateJs ? '✓' : '✗'} Links /js/state.js`);
  console.log(`   ${hasHomeJs ? '✓' : '✗'} Links /js/home.js`);
  console.log(`   ${noInlineStyle ? '✓' : '✗'} Inline style blocks decoupled`);

  if (!hasCommonCss || !hasHomeCss || !hasRouterJs || !hasStateJs || !hasHomeJs || !noInlineStyle) {
    allPass = false;
  }

  if (allPass) {
    console.log('\n>>> ALL LIVE PRODUCTION VERIFICATIONS PASSED (100%)! <<<');
  } else {
    console.error('\n>>> SOME LIVE CHECKS FAILED! <<<');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
