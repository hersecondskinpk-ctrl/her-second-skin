const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9231;

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
    await sleep(2000);

    const audit = await call('Runtime.evaluate', {
      expression: `(() => {
        // Add item to cart and open cart drawer
        if (window.cart) {
          window.cart.push({
            name: 'Floral Elegance Lingerie Set',
            price: 3499,
            qty: 1,
            size: '34B',
            color: 'White',
            selected: true,
            image: '/brand-logo.jpg'
          });
          window.renderCart();
          document.getElementById('cart-drawer').classList.add('active');
        }
        
        const drawer = document.getElementById('cart-drawer');
        const list = document.querySelector('#cart-drawer .cart-product-list');
        const itemRow = document.querySelector('#cart-drawer .item-row');
        
        return {
          viewport: window.innerWidth,
          drawerWidth: drawer ? drawer.getBoundingClientRect().width : null,
          listWidth: list ? list.getBoundingClientRect().width : null,
          itemRowWidth: itemRow ? itemRow.getBoundingClientRect().width : null,
          itemRowComputedWidth: itemRow ? window.getComputedStyle(itemRow).width : null,
          itemRowBoxSizing: itemRow ? window.getComputedStyle(itemRow).boxSizing : null,
          itemRowParentOverflow: list ? window.getComputedStyle(list).overflow : null
        };
      })()`,
      returnByValue: true
    });

    console.log(`Cart Item Viewport ${w}px:`, audit.result.value);
  }

  ws.close();
  browserProc.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
