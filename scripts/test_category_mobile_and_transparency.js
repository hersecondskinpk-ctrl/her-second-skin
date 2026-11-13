const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 4056;
const CDP_PORT = 9256;
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
  console.log('=== STARTING CATEGORY MOBILE & TRANSPARENCY VALIDATION ===');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
    stdio: 'ignore'
  });

  let serverStarted = false;
  for (let i = 0; i < 30; i++) {
    try {
      await httpGet(`http://127.0.0.1:${TEST_PORT}/api/inventory-catalog`);
      serverStarted = true;
      break;
    } catch (e) {
      await sleep(300);
    }
  }

  if (!serverStarted) {
    serverProcess.kill();
    throw new Error('Server failed to start on port ' + TEST_PORT);
  }
  console.log(`Server started on port ${TEST_PORT}`);

  const userDataDir = path.resolve(__dirname, '../scratch_test_data/cdp_category_profile');
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
    serverProcess.kill();
    throw new Error('Failed to connect to Edge CDP');
  }

  const cdp = new SimpleCDP(targetWs);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/` });
    await sleep(1500);

    const viewports = [
      { name: 'Mobile 320px', width: 320, height: 600, expectedCols: 3 },
      { name: 'Mobile 360px', width: 360, height: 740, expectedCols: 3 },
      { name: 'Mobile 375px (iPhone)', width: 375, height: 812, expectedCols: 3 },
      { name: 'Mobile 390px', width: 390, height: 844, expectedCols: 3 },
      { name: 'Mobile 414px', width: 414, height: 896, expectedCols: 3 },
      { name: 'Tablet 768px', width: 768, height: 1024, expectedCols: 3 },
      { name: 'Desktop 1280px', width: 1280, height: 800, expectedCols: 6 }
    ];

    let allPass = true;

    for (const vp of viewports) {
      console.log(`\n--- Testing ${vp.name} (${vp.width}x${vp.height}) ---`);
      await cdp.setViewport(vp.width, vp.height);
      await sleep(300);

      const metrics = await cdp.eval(`(() => {
        const catGrid = document.querySelector('.category-grid');
        const catCards = Array.from(document.querySelectorAll('.category-grid .card'));
        const prodGrid = document.querySelector('#product-grid');
        const prodCards = Array.from(document.querySelectorAll('#product-grid .card'));

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

        const prodCols = prodGrid ? getComputedStyle(prodGrid).gridTemplateColumns.split(' ').length : 0;
        const firstProdCard = prodCards[0];
        let prodCardWidth = 0;
        if (firstProdCard) {
          prodCardWidth = Math.round(firstProdCard.getBoundingClientRect().width);
        }

        return {
          catCount: catCards.length,
          catGridCols,
          catCardBg,
          catCardBorder,
          catCardShadow,
          catCardWidth,
          catCardImgWidth,
          catCardImgHeight,
          prodCols,
          prodCardWidth
        };
      })()`);

      console.log('Category Cards Count:', metrics.catCount);
      console.log('Category Grid Columns:', metrics.catGridCols, `(Expected: ${vp.expectedCols})`);
      console.log('First Category Card Width:', metrics.catCardWidth + 'px');
      console.log('Category Image Dimensions:', metrics.catCardImgWidth + 'x' + metrics.catCardImgHeight);
      console.log('Category Card Background:', metrics.catCardBg);
      console.log('Category Card Border:', metrics.catCardBorder);
      console.log('Category Card Box Shadow:', metrics.catCardShadow);
      console.log('Product Grid Columns:', metrics.prodCols, '| Prod Card Width:', metrics.prodCardWidth + 'px');

      const isTransparent = metrics.catCardBg === 'rgba(0, 0, 0, 0)' || metrics.catCardBg === 'transparent';
      const noCardBorder = metrics.catCardBorder.startsWith('0px') || metrics.catCardBorder.includes('none');
      const noCardShadow = metrics.catCardShadow === 'none';
      const colMatch = metrics.catGridCols === vp.expectedCols;

      if (!isTransparent) {
        console.error(`FAIL: Category card background is not transparent: ${metrics.catCardBg}`);
        allPass = false;
      }
      if (!noCardBorder) {
        console.error(`FAIL: Category card has border: ${metrics.catCardBorder}`);
        allPass = false;
      }
      if (!noCardShadow) {
        console.error(`FAIL: Category card has box shadow: ${metrics.catCardShadow}`);
        allPass = false;
      }
      if (!colMatch) {
        console.error(`FAIL: Category grid columns mismatch: got ${metrics.catGridCols}, expected ${vp.expectedCols}`);
        allPass = false;
      }

      if (vp.width <= 600) {
        if (metrics.prodCols !== 1) {
          console.error(`FAIL: Product grid on mobile must still have 1 card per row, got ${metrics.prodCols}`);
          allPass = false;
        }
        if (metrics.catCardWidth > 200) {
          console.error(`FAIL: Category card width on mobile is too large: ${metrics.catCardWidth}px`);
          allPass = false;
        }
      }

      if (vp.width === 375) {
        const shotPath = path.join(ARTIFACT_DIR, 'category_mobile_375px.png');
        await cdp.captureScreenshot(shotPath);
        console.log(`Captured mobile screenshot at ${shotPath}`);
      }
      if (vp.width === 1280) {
        const shotPath = path.join(ARTIFACT_DIR, 'category_desktop_1280px.png');
        await cdp.captureScreenshot(shotPath);
        console.log(`Captured desktop screenshot at ${shotPath}`);
      }
    }

    if (allPass) {
      console.log('\n>>> ALL CATEGORY DISPLAY & TRANSPARENCY TESTS PASSED! <<<');
    } else {
      console.error('\n>>> SOME TESTS FAILED! <<<');
      process.exitCode = 1;
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
