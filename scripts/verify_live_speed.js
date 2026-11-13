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
        resolve({
          path,
          status: res.statusCode,
          duration,
          headers: res.headers,
          bytes: buffer.length,
          buffer
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('--- Checking LIVE Fly.io Production ---');
  
  const home = await check('/');
  console.log(`GET /:`);
  console.log(`  Status: ${home.status}`);
  console.log(`  Duration: ${home.duration}ms`);
  console.log(`  Content-Encoding: ${home.headers['content-encoding']}`);
  console.log(`  Transferred wire bytes: ${home.bytes}`);
  const unzippedHome = zlib.gunzipSync(home.buffer);
  console.log(`  Unzipped size: ${unzippedHome.length} bytes`);
  console.log(`  Savings: ${((1 - home.bytes / unzippedHome.length) * 100).toFixed(1)}%`);

  const css = await check('/hss-fonts.css');
  console.log(`\nGET /hss-fonts.css:`);
  console.log(`  Status: ${css.status}`);
  console.log(`  Duration: ${css.duration}ms`);
  console.log(`  Content-Encoding: ${css.headers['content-encoding']}`);
  console.log(`  Transferred wire bytes: ${css.bytes}`);
  const unzippedCss = zlib.gunzipSync(css.buffer).toString('utf8');
  console.log(`  Contains @import: ${unzippedCss.includes('@import')}`);

  console.log('\n=== LIVE VERIFICATION COMPLETE ===');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
