const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9230;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const browserProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);

  await sleep(1500);

  const list = await new Promise((res, rej) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }));

  const pageTarget = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(res => ws.onopen = res);

  let id = 0;
  function call(method, params = {}) {
    return new Promise(res => {
      const myId = ++id;
      const handler = (msg) => {
        const d = JSON.parse(msg.data);
        if (d.id === myId) {
          ws.removeEventListener('message', handler);
          res(d.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  await call('Page.enable');

  const viewports = [320, 360, 375, 390, 414];
  for (const w of viewports) {
    await call('Emulation.setDeviceMetricsOverride', {
      width: w, height: 700, deviceScaleFactor: 2, mobile: true
    });
    await call('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/' });
    await sleep(2500);

    const audit = await call('Runtime.evaluate', {
      expression: `(() => {
        const grid = document.getElementById('product-grid');
        const cards = Array.from(document.querySelectorAll('#product-grid .card'));
        const cartDrawer = document.getElementById('cart-drawer');
        const cartItems = document.getElementById('cart-items');
        
        return {
          viewportWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
          gridWidth: grid ? grid.getBoundingClientRect().width : null,
          cardsCount: cards.length,
          cardWidths: cards.map(c => Math.round(c.getBoundingClientRect().width)),
          cardComputedWidth: cards[0] ? window.getComputedStyle(cards[0]).width : null,
          cardMinWidth: cards[0] ? window.getComputedStyle(cards[0]).minWidth : null,
          cardBoxSizing: cards[0] ? window.getComputedStyle(cards[0]).boxSizing : null,
          gridColumns: grid ? window.getComputedStyle(grid).gridTemplateColumns : null
        };
      })()`,
      returnByValue: true
    });

    console.log(`Viewport ${w}px:`, audit.result.value);
  }

  ws.close();
  browserProc.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
