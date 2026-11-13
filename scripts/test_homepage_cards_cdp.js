const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8096;
const CDP_PORT = 9236;
const WEBSITE_DIR = path.resolve(__dirname, '..');

let serverProc = null;
let browserProc = null;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.callbacks = new Map();
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message));
          else cb.resolve(data.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function main() {
  const env = { ...process.env, PORT: String(PORT) };
  serverProc = spawn('node', ['server.js'], { cwd: WEBSITE_DIR, env });

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      const ok = await new Promise(r => http.get(`http://127.0.0.1:${PORT}/api/health`, res => r(res.statusCode === 200)).on('error', () => r(false)));
      if (ok) break;
    } catch (e) {}
  }

  browserProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);

  let client = null;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try {
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const target = list && (list.find(t => t.type === 'page') || list[0]);
      if (target && target.webSocketDebuggerUrl) {
        client = new CDPClient(target.webSocketDebuggerUrl);
        await client.connect();
        break;
      }
    } catch (e) {}
  }

  if (!client) throw new Error('CDP connect failed');
  await client.send('Page.enable');

  const viewports = [
    { name: 'iPhone SE (320px)', w: 320, h: 568 },
    { name: 'Galaxy S8+ (360px)', w: 360, h: 640 },
    { name: 'iPhone 8 (375px)', w: 375, h: 667 },
    { name: 'iPhone 13/14 (390px)', w: 390, h: 844 },
    { name: 'iPhone 11 XR (414px)', w: 414, h: 896 },
    { name: 'Compact Mobile (480px)', w: 480, h: 800 },
    { name: 'Near-Breakpoint Mobile (599px)', w: 599, h: 800 }
  ];

  console.log('\n--- Auditing Mobile Homepage Product Card Widths with Cards ---');
  for (const vp of viewports) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true
    });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(1500);

    const audit = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const grid = document.getElementById('product-grid');
        // Ensure a card is present for measurement
        if (grid && !grid.querySelector('.card')) {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = '<img src=\"/brand-logo.jpg\" style=\"width:100%\"><h3>Floral Elegance Lingerie Set</h3><div class=\"price\">PKR 3,499</div>';
          grid.innerHTML = '';
          grid.appendChild(card);
        }
        
        const firstCard = grid.querySelector('.card');
        const gridRect = grid.getBoundingClientRect();
        const cardRect = firstCard.getBoundingClientRect();
        const columns = window.getComputedStyle(grid).gridTemplateColumns;
        
        return {
          viewport: window.innerWidth,
          gridWidth: Math.round(gridRect.width),
          cardWidth: Math.round(cardRect.width),
          cardHeight: Math.round(cardRect.height),
          cardFillPct: ((cardRect.width / (gridRect.width - 28)) * 100).toFixed(1) + '%',
          columns,
          emptySpaceRight: Math.round(window.innerWidth - cardRect.right),
          cardLeft: Math.round(cardRect.left),
          isCenteredOrFull: Math.abs(Math.round(cardRect.left) - Math.round(window.innerWidth - cardRect.right)) <= 4
        };
      })()`,
      returnByValue: true
    });

    const res = audit.result.value;
    console.log(`[${vp.name}]`);
    console.log(`  - Card Width: ${res.cardWidth}px (Grid Track: ${res.columns})`);
    console.log(`  - Left Margin: ${res.cardLeft}px, Right Margin: ${res.emptySpaceRight}px (Symmetric/Full: ${res.isCenteredOrFull ? '✅ YES' : 'NO'})`);
    console.log(`  - Large Empty Area on Right: ${res.emptySpaceRight > 30 ? '❌ YES' : '✅ NO (0px empty area)'}`);
  }

  client.close();
  browserProc.kill();
  serverProc.kill();
}

main().catch(e => {
  console.error(e);
  if (browserProc) browserProc.kill();
  if (serverProc) serverProc.kill();
  process.exit(1);
});
