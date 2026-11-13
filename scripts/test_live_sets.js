const http = require('http');
const { spawn } = require('child_process');

async function testSets() {
  const CDP_PORT = 9265;
  const browserProc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const list = await new Promise((res) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }));
  const pageTarget = list.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension:')) || list.find(t => t.type === 'page') || list[0];
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
  await call('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 667, deviceScaleFactor: 2, mobile: true
  });
  await call('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/sets.html' });
  await new Promise(r => setTimeout(r, 3500));
  const result = await call('Runtime.evaluate', {
    expression: `(() => {
      const grid = document.querySelector('main.grid');
      const cards = Array.from(document.querySelectorAll('main.grid .product, main.grid .hss-card'));
      const card = cards[0];
      const cardRect = card ? card.getBoundingClientRect() : null;
      return {
        url: location.href,
        count: cards.length,
        cardWidth: cardRect ? Math.round(cardRect.width) : null,
        left: cardRect ? Math.round(cardRect.left) : null,
        right: cardRect ? Math.round(window.innerWidth - cardRect.right) : null,
        variantsText: card ? card.querySelector('.inventory-card-variants')?.textContent : null,
        stockText: card ? card.querySelector('.inventory-stock-label')?.textContent : null,
        hasLargeEmptyRight: cardRect ? (window.innerWidth - cardRect.right > 25) : false
      };
    })()`,
    returnByValue: true
  });
  console.log('Live sets.html at 375px:', result.result.value);
  ws.close();
  browserProc.kill();
}
testSets().catch(console.error);
