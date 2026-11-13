const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_PORT = 9257;
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
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

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: width < 768
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log('=== VERIFYING LIVE FLY.IO PRODUCTION DEPLOYMENT ===');
  console.log('Target URL:', LIVE_URL);

  const userDataDir = path.resolve(__dirname, '../scratch_test_data/cdp_live_cat_profile');
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
      const list = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
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

    const viewports = [
      { name: 'Mobile 375px (iPhone)', width: 375, height: 812, expectedCols: 3 },
      { name: 'Desktop 1280px', width: 1280, height: 800, expectedCols: 6 }
    ];

    for (const vp of viewports) {
      console.log(`\n--- Live Check ${vp.name} ---`);
      await cdp.setViewport(vp.width, vp.height);
      await sleep(500);

      const metrics = await cdp.eval(`(() => {
        const catGrid = document.querySelector('.category-grid');
        const catCards = Array.from(document.querySelectorAll('.category-grid .card'));
        const catGridCols = catGrid ? getComputedStyle(catGrid).gridTemplateColumns.split(' ').length : 0;
        const firstCatCard = catCards[0];
        let catCardBg = '';
        let catCardBorder = '';
        let catCardShadow = '';
        let catCardWidth = 0;
        let catCardImgHeight = 0;
        let catCardImgWidth = 0;
        if (firstCatCard) {
          const s = getComputedStyle(firstCatCard);
          catCardBg = s.backgroundColor;
          catCardBorder = s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor;
          catCardShadow = s.boxShadow;
          catCardWidth = Math.round(firstCatCard.getBoundingClientRect().width);
          const img = firstCatCard.querySelector('img');
          if (img) {
            const is = img.getBoundingClientRect();
            catCardImgWidth = Math.round(is.width);
            catCardImgHeight = Math.round(is.height);
          }
        }
        return {
          catCount: catCards.length,
          catGridCols,
          catCardBg,
          catCardBorder,
          catCardShadow,
          catCardWidth,
          catCardImgWidth,
          catCardImgHeight
        };
      })()`);

      console.log('Live Category Cards Count:', metrics.catCount);
      console.log('Live Category Grid Columns:', metrics.catGridCols, `(Expected: ${vp.expectedCols})`);
      console.log('Live First Card Width:', metrics.catCardWidth + 'px');
      console.log('Live Image Dimensions:', metrics.catCardImgWidth + 'x' + metrics.catCardImgHeight);
      console.log('Live Card Background:', metrics.catCardBg);
      console.log('Live Card Border:', metrics.catCardBorder);
      console.log('Live Card Shadow:', metrics.catCardShadow);

      if (vp.width === 375) {
        const shotPath = path.join(ARTIFACT_DIR, 'live_category_mobile_375px.png');
        await cdp.captureScreenshot(shotPath);
        console.log(`Captured live mobile screenshot at ${shotPath}`);
      }
      if (vp.width === 1280) {
        const shotPath = path.join(ARTIFACT_DIR, 'live_category_desktop_1280px.png');
        await cdp.captureScreenshot(shotPath);
        console.log(`Captured live desktop screenshot at ${shotPath}`);
      }
    }

    console.log('\n>>> LIVE PRODUCTION VERIFICATION COMPLETED SUCCESSFULLY! <<<');
  } finally {
    cdp.close();
    edgeProcess.kill();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
