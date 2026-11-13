const { spawn } = require('child_process');
const http = require('http');

async function testLive() {
  const CDP_PORT = 9240;
  const browserProc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);
  await new Promise(r => setTimeout(r, 1500));
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
  console.log('--- Live Production Verification: Mobile Homepage Product Card Width ---');
  for (const w of viewports) {
    await call('Emulation.setDeviceMetricsOverride', {
      width: w, height: 700, deviceScaleFactor: 2, mobile: true
    });
    await call('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/' });
    await new Promise(r => setTimeout(r, 3000));

    const audit = await call('Runtime.evaluate', {
      expression: `(() => {
        const grid = document.getElementById('product-grid');
        const card = grid ? grid.querySelector('.card') : null;
        const gridRect = grid ? grid.getBoundingClientRect() : null;
        const cardRect = card ? card.getBoundingClientRect() : null;
        return {
          viewport: window.innerWidth,
          gridWidth: gridRect ? Math.round(gridRect.width) : null,
          cardWidth: cardRect ? Math.round(cardRect.width) : null,
          columns: grid ? window.getComputedStyle(grid).gridTemplateColumns : null,
          leftMargin: cardRect ? Math.round(cardRect.left) : null,
          rightMargin: cardRect ? Math.round(window.innerWidth - cardRect.right) : null,
          hasLargeEmptyAreaOnRight: cardRect ? (window.innerWidth - cardRect.right > 25) : false
        };
      })()`,
      returnByValue: true
    });
    const res = audit.result.value;
    console.log(`[${w}px Viewport] Card Width: ${res.cardWidth}px | Grid Track: ${res.columns} | Left: ${res.leftMargin}px, Right: ${res.rightMargin}px | Large Empty Area on Right: ${res.hasLargeEmptyAreaOnRight ? '❌ YES' : '✅ NO'}`);
  }

  ws.close();
  browserProc.kill();
}
testLive().catch(console.error);
