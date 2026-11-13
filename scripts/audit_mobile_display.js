const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9229;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const browserProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=390,844'
  ]);

  await sleep(1500);

  const list = await new Promise((res, rej) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }));

  const pageTarget = list.find(t => t.type === 'page') || list[0];
  console.log('Connecting to target:', pageTarget.url, pageTarget.type);

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
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true
  });

  console.log('Navigating to https://her-second-skin-pk.fly.dev/ ...');
  await call('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/' });

  await sleep(4000);

  const evalRes = await call('Runtime.evaluate', {
    expression: `(() => {
      const cards = document.querySelectorAll('#product-grid .card');
      const sample = cards[0];
      return {
        href: location.href,
        title: document.title,
        totalCards: cards.length,
        firstTitle: sample ? sample.querySelector('h3')?.textContent : null,
        firstPrice: sample ? sample.querySelector('.price')?.textContent.replace(/\\s+/g, ' ').trim() : null,
        firstImg: sample ? sample.querySelector('img')?.src : null,
        firstImgComplete: sample ? sample.querySelector('img')?.complete : null,
        cardWidth: sample ? sample.getBoundingClientRect().width : null,
        cardHeight: sample ? sample.getBoundingClientRect().height : null
      };
    })()`,
    returnByValue: true
  });

  console.log('Live Mobile Display Evaluation:', JSON.stringify(evalRes.result.value, null, 2));

  // Now test product card click / PDP navigation
  console.log('Testing PDP mobile navigation...');
  await call('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/product.html?id=19fa215c-f34e-455a-9bcc-aea336c5015f' });
  await sleep(4000);

  const pdpRes = await call('Runtime.evaluate', {
    expression: `(() => {
      const title = document.querySelector('.pdp-title');
      const price = document.querySelector('.pdp-price');
      const mainImg = document.querySelector('#main-img');
      const stickyBar = document.querySelector('.pdp-sticky');
      const pills = document.querySelectorAll('.pdp-pill');
      return {
        href: location.href,
        titleText: title ? title.textContent.trim() : null,
        priceText: price ? price.textContent.trim() : null,
        hasMainImg: !!mainImg && mainImg.complete && mainImg.naturalWidth > 0,
        mainImgSrc: mainImg ? mainImg.src : null,
        stickyBarDisplay: stickyBar ? window.getComputedStyle(stickyBar).display : null,
        pillsCount: pills.length
      };
    })()`,
    returnByValue: true
  });

  console.log('Live PDP Mobile Evaluation:', JSON.stringify(pdpRes.result.value, null, 2));

  ws.close();
  browserProc.kill();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
