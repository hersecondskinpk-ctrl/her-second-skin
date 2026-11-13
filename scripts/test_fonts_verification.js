const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 4057;
const CDP_PORT = 9258;
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ARTIFACT_DIR = 'C:/Users/talal/.gemini/antigravity/brain/07c97595-1ad6-4370-90ba-4aae47323d1a';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    }).on('error', reject);
  });
}

class SimpleCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(outPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log('=== STARTING GOTHAM CONDENSED FONT VERIFICATION ===');

  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
    stdio: 'ignore'
  });

  let serverStarted = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT}/hss-fonts.css`);
      if (res.status === 200) {
        serverStarted = true;
        break;
      }
    } catch (e) {
      await sleep(300);
    }
  }

  if (!serverStarted) {
    serverProcess.kill();
    throw new Error('Server failed to start on port ' + TEST_PORT);
  }
  console.log('✅ Server started on port ' + TEST_PORT);

  // 1. Check font static asset routes
  console.log('\n[1/3] Testing Font Assets and MIME Types...');
  const fontCss = await httpGet(`http://127.0.0.1:${TEST_PORT}/hss-fonts.css`);
  console.log('/hss-fonts.css Status:', fontCss.status, '| MIME:', fontCss.headers['content-type']);
  if (fontCss.status !== 200) throw new Error('Failed to load /hss-fonts.css');

  const fontBook = await httpGet(`http://127.0.0.1:${TEST_PORT}/fonts/GothamCondensed-Book.woff`);
  console.log('/fonts/GothamCondensed-Book.woff Status:', fontBook.status, '| MIME:', fontBook.headers['content-type']);
  if (fontBook.status !== 200) throw new Error('Failed to load /fonts/GothamCondensed-Book.woff');

  const fontBold = await httpGet(`http://127.0.0.1:${TEST_PORT}/fonts/GothamCondensed-Bold.woff`);
  console.log('/fonts/GothamCondensed-Bold.woff Status:', fontBold.status, '| MIME:', fontBold.headers['content-type']);
  if (fontBold.status !== 200) throw new Error('Failed to load /fonts/GothamCondensed-Bold.woff');

  // 2. Launch Headless Edge for DOM computed styles
  console.log('\n[2/3] Launching Edge CDP to test font rendering on pages...');
  const userDataDir = path.resolve(__dirname, '../scratch_test_data/cdp_font_profile');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const edgeProcess = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdpConnected = false;
  let targetWs = null;
  for (let i = 0; i < 30; i++) {
    try {
      const listRes = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = JSON.parse(listRes.data);
      const pageTarget = list.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension:'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        targetWs = pageTarget.webSocketDebuggerUrl;
        cdpConnected = true;
        break;
      }
    } catch (e) {
      await sleep(300);
    }
  }

  if (!cdpConnected || !targetWs) {
    edgeProcess.kill();
    serverProcess.kill();
    throw new Error('Failed to connect to Edge CDP');
  }

  const cdp = new SimpleCDP(targetWs);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    // Test Homepage
    console.log('\nTesting Homepage (index.html)...');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/` });
    await sleep(2000);

    const homeStyles = await cdp.eval(`(() => {
      const body = document.body;
      const brand = document.querySelector('.brand-title');
      const heroH1 = document.querySelector('.hero h1');
      const secTitle = document.querySelector('.section-title');
      const cardH3 = document.querySelector('.card h3');
      const p = document.querySelector('.hero p, p');

      return {
        bodyFont: getComputedStyle(body).fontFamily,
        bodyWeight: getComputedStyle(body).fontWeight,
        brandFont: brand ? getComputedStyle(brand).fontFamily : '',
        brandWeight: brand ? getComputedStyle(brand).fontWeight : '',
        heroH1Font: heroH1 ? getComputedStyle(heroH1).fontFamily : '',
        heroH1Weight: heroH1 ? getComputedStyle(heroH1).fontWeight : '',
        secTitleFont: secTitle ? getComputedStyle(secTitle).fontFamily : '',
        secTitleWeight: secTitle ? getComputedStyle(secTitle).fontWeight : '',
        cardH3Font: cardH3 ? getComputedStyle(cardH3).fontFamily : '',
        cardH3Weight: cardH3 ? getComputedStyle(cardH3).fontWeight : '',
        pFont: p ? getComputedStyle(p).fontFamily : '',
        pWeight: p ? getComputedStyle(p).fontWeight : ''
      };
    })()`);

    console.log('Homepage Styles:');
    console.log('  Body Font:', homeStyles.bodyFont, '| Weight:', homeStyles.bodyWeight);
    console.log('  Brand Title Font:', homeStyles.brandFont, '| Weight:', homeStyles.brandWeight);
    console.log('  Hero H1 Font:', homeStyles.heroH1Font, '| Weight:', homeStyles.heroH1Weight);
    console.log('  Section Title Font:', homeStyles.secTitleFont, '| Weight:', homeStyles.secTitleWeight);
    console.log('  Card H3 Font:', homeStyles.cardH3Font, '| Weight:', homeStyles.cardH3Weight);
    console.log('  Paragraph (p) Font:', homeStyles.pFont, '| Weight:', homeStyles.pWeight);

    let failed = false;
    if (!homeStyles.bodyFont.includes('Gotham Condensed')) {
      console.error('FAIL: Body does not use Gotham Condensed!');
      failed = true;
    }
    if (homeStyles.brandWeight < 600) {
      console.error('FAIL: Brand Title is not Bold!');
      failed = true;
    }
    if (homeStyles.heroH1Weight < 600) {
      console.error('FAIL: Hero H1 is not Bold!');
      failed = true;
    }
    if (homeStyles.secTitleWeight < 600) {
      console.error('FAIL: Section Title is not Bold!');
      failed = true;
    }
    if (homeStyles.cardH3Weight < 600) {
      console.error('FAIL: Card H3 is not Bold!');
      failed = true;
    }
    if (homeStyles.pWeight > 500) {
      console.error('FAIL: Paragraph is not Normal weight!');
      failed = true;
    }

    // Capture visual screenshot
    const homeShot = path.join(ARTIFACT_DIR, 'font_homepage_preview.png');
    await cdp.captureScreenshot(homeShot);
    console.log('Captured screenshot at ' + homeShot);

    // Test Category Page (bras.html)
    console.log('\nTesting Category Page (bras.html)...');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/bras.html` });
    await sleep(2000);

    const catStyles = await cdp.eval(`(() => {
      const body = document.body;
      const brand = document.querySelector('.brand-title, .brand');
      const heroH1 = document.querySelector('.hero h1, h1');
      const prodH2 = document.querySelector('.product h2, .details h2, h2');
      const p = document.querySelector('.hero p, p');

      return {
        bodyFont: getComputedStyle(body).fontFamily,
        bodyWeight: getComputedStyle(body).fontWeight,
        brandFont: brand ? getComputedStyle(brand).fontFamily : '',
        brandWeight: brand ? getComputedStyle(brand).fontWeight : '',
        heroH1Font: heroH1 ? getComputedStyle(heroH1).fontFamily : '',
        heroH1Weight: heroH1 ? getComputedStyle(heroH1).fontWeight : '',
        prodH2Font: prodH2 ? getComputedStyle(prodH2).fontFamily : '',
        prodH2Weight: prodH2 ? getComputedStyle(prodH2).fontWeight : '',
        pFont: p ? getComputedStyle(p).fontFamily : '',
        pWeight: p ? getComputedStyle(p).fontWeight : ''
      };
    })()`);

    console.log('Category Page Styles:');
    console.log('  Body Font:', catStyles.bodyFont, '| Weight:', catStyles.bodyWeight);
    console.log('  Brand Title Font:', catStyles.brandFont, '| Weight:', catStyles.brandWeight);
    console.log('  Hero H1 Font:', catStyles.heroH1Font, '| Weight:', catStyles.heroH1Weight);
    console.log('  Product H2 Font:', catStyles.prodH2Font, '| Weight:', catStyles.prodH2Weight);
    console.log('  Paragraph (p) Font:', catStyles.pFont, '| Weight:', catStyles.pWeight);

    if (!catStyles.bodyFont.includes('Gotham Condensed')) {
      console.error('FAIL: Category page body does not use Gotham Condensed!');
      failed = true;
    }
    if (catStyles.heroH1Weight < 600) {
      console.error('FAIL: Category hero H1 is not Bold!');
      failed = true;
    }

    if (failed) {
      console.error('\n>>> SOME FONT TESTS FAILED! <<<');
      process.exitCode = 1;
    } else {
      console.log('\n>>> ALL GOTHAM CONDENSED FONT TESTS PASSED (100%)! <<<');
    }
  } finally {
    cdp.close();
    edgeProcess.kill();
    serverProcess.kill();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
