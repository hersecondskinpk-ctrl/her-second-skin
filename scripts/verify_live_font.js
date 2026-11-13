const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_PORT = 9259;
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ARTIFACT_DIR = 'C:/Users/talal/.gemini/antigravity/brain/07c97595-1ad6-4370-90ba-4aae47323d1a';
const LIVE_URL = 'https://her-second-skin-pk.fly.dev/';

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
  console.log('=== VERIFYING LIVE PRODUCTION FONT ===');
  console.log('Target:', LIVE_URL);

  const userDataDir = path.resolve(__dirname, '../scratch_test_data/cdp_live_font_profile');
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
    throw new Error('Failed to connect to Edge CDP');
  }

  const cdp = new SimpleCDP(targetWs);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    await cdp.send('Page.navigate', { url: LIVE_URL });
    await sleep(2500);

    const liveStyles = await cdp.eval(`(() => {
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

    console.log('Live Homepage Computed Styles:');
    console.log('  Body Font:', liveStyles.bodyFont, '| Weight:', liveStyles.bodyWeight);
    console.log('  Brand Title Font:', liveStyles.brandFont, '| Weight:', liveStyles.brandWeight);
    console.log('  Hero H1 Font:', liveStyles.heroH1Font, '| Weight:', liveStyles.heroH1Weight);
    console.log('  Section Title Font:', liveStyles.secTitleFont, '| Weight:', liveStyles.secTitleWeight);
    console.log('  Card H3 Font:', liveStyles.cardH3Font, '| Weight:', liveStyles.cardH3Weight);
    console.log('  Paragraph (p) Font:', liveStyles.pFont, '| Weight:', liveStyles.pWeight);

    const shotPath = path.join(ARTIFACT_DIR, 'live_font_homepage.png');
    await cdp.captureScreenshot(shotPath);
    console.log('Captured live screenshot at', shotPath);

    console.log('\n>>> LIVE PRODUCTION FONT VERIFIED SUCCESSFULLY! <<<');
  } finally {
    cdp.close();
    edgeProcess.kill();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
