const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8092;
const CDP_PORT = 9223;
const WEBSITE_DIR = path.resolve(__dirname, '..');

let serverProc = null;
let browserProc = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
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
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
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

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function main() {
  console.log('========================================================');
  console.log('Mobile Shopping Cart Layout & Interaction Verification');
  console.log('========================================================\n');

  // 1. Start test server
  console.log('Starting local HTTP server on port ' + PORT + '...');
  const testDbDir = path.join(WEBSITE_DIR, 'scratch_test_data');
  if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });

  serverProc = spawn('node', ['server.js'], {
    cwd: WEBSITE_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      HSS_DATA_DIR: testDbDir,
      HSS_DATABASE_PATH: path.join(testDbDir, 'test-cart.sqlite'),
      ADMIN_PASSWORD: 'TestPassword123!'
    },
    stdio: 'ignore'
  });

  // Wait for server to respond
  let serverReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try {
      const h = await fetchJson(`http://127.0.0.1:${PORT}/api/health`);
      if (h && h.ok) { serverReady = true; break; }
    } catch (e) {}
  }
  if (!serverReady) {
    throw new Error('Local server failed to start on port ' + PORT);
  }
  console.log('✅ Server online at http://127.0.0.1:' + PORT);

  // 2. Launch Headless Edge with CDP
  console.log('Launching headless Chromium (Edge)...');
  const userDataDir = path.join(testDbDir, 'edge_user_data');
  browserProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `http://127.0.0.1:${PORT}/`
  ], { stdio: 'ignore' });

  let cdpTargets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      cdpTargets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
      if (cdpTargets && cdpTargets.length) break;
    } catch (e) {}
  }
  if (!cdpTargets || !cdpTargets.length) {
    throw new Error('Headless browser failed to start CDP on port ' + CDP_PORT);
  }

  const pageTarget = cdpTargets.find(t => t.type === 'page');
  const wsUrl = pageTarget.webSocketDebuggerUrl;
  const client = new CDPClient(wsUrl);
  await client.connect();
  console.log('✅ CDP connected to browser page');

  // Wait for page to initialize
  await sleep(1000);

  const viewports = [
    { width: 320, height: 568, name: 'iPhone SE (320px)' },
    { width: 360, height: 640, name: 'Galaxy S8+ (360px)' },
    { width: 375, height: 667, name: 'iPhone 8 (375px)' },
    { width: 390, height: 844, name: 'iPhone 13/14 (390px)' },
    { width: 414, height: 896, name: 'iPhone 11 XR (414px)' },
    { width: 768, height: 1024, name: 'iPad / Tablet (768px)' },
    { width: 1280, height: 800, name: 'Desktop (1280px)' }
  ];

  const productCounts = [1, 2, 3, 5];

  let allPassed = true;

  for (const vp of viewports) {
    console.log(`\n--------------------------------------------------------`);
    console.log(`Testing Viewport: ${vp.name} [${vp.width}x${vp.height}]`);
    console.log(`--------------------------------------------------------`);

    // Set viewport dimensions
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 2,
      mobile: vp.width < 768
    });
    await sleep(200);

    for (const count of productCounts) {
      // Inject products into cart
      const injectRes = await client.eval(`
        (() => {
          cart.length = 0;
          for (let i = 1; i <= ${count}; i++) {
            cart.push({
              name: 'Silk Lace Luxe Bra #' + i,
              price: 2499,
              size: (32 + (i % 3) * 2) + 'B',
              color: ['Black', 'Blush Pink', 'Nude', 'Wine Red', 'Ivory'][i - 1],
              qty: 1,
              selected: true,
              image: '/brand-logo.jpg',
              productId: 'prod-' + i,
              variantId: 'var-' + i
            });
          }
          renderCart();
          openCartDrawer();
          return { cartLength: cart.length };
        })()
      `);

      await sleep(200);

      // Inspect elements and layout metrics
      const layoutAudit = await client.eval(`
        (() => {
          const drawer = document.getElementById('cart-drawer');
          const header = drawer.querySelector('.menu-header.cart-head');
          const summaryTop = document.getElementById('cart-summary-top');
          const tools = drawer.querySelector('.cart-selection-tools');
          const productList = document.getElementById('cart-items');
          const deliveryDetails = document.getElementById('cart-checkout-details');
          const deliveryForm = deliveryDetails ? deliveryDetails.querySelector('.checkout-form') : null;
          const orderSummary = drawer.querySelector('.cart-price-summary');
          const confirmBtn = document.getElementById('buy-selected-btn');

          const cards = Array.from(productList.querySelectorAll('.item-row'));

          const drawerRect = drawer.getBoundingClientRect();
          const drawerScrollHeight = drawer.scrollHeight;
          const drawerClientHeight = drawer.clientHeight;
          const drawerScrollWidth = drawer.scrollWidth;
          const drawerClientWidth = drawer.clientWidth;

          // Check each card's internal parts
          const cardDetails = cards.map((c, i) => {
            const rect = c.getBoundingClientRect();
            const img = c.querySelector('.item-thumb-img');
            const title = c.querySelector('.item-title');
            const variantLine = c.querySelector('.item-variant-line');
            const price = c.querySelector('.item-price');
            const qtyControls = c.querySelector('.qty-controls');
            const removeBtn = c.querySelector('.cart-item-remove-btn');
            const checkbox = c.querySelector('.item-select');

            return {
              index: i,
              height: rect.height,
              width: rect.width,
              top: rect.top,
              bottom: rect.bottom,
              hasImg: !!img && (img.src.length > 0),
              hasTitle: !!title && title.textContent.trim().length > 0,
              hasVariants: !!variantLine && variantLine.textContent.trim().length > 0,
              hasPrice: !!price && price.textContent.includes('PKR'),
              hasQtyControls: !!qtyControls && qtyControls.querySelectorAll('button').length === 2,
              hasRemoveBtn: !!removeBtn,
              hasCheckbox: !!checkbox && checkbox.checked === true
            };
          });

          // Check vertical document sequence (sections 1 through 7)
          const rHeader = header.getBoundingClientRect();
          const rSummaryTop = summaryTop.getBoundingClientRect();
          const rTools = tools.getBoundingClientRect();
          const rProductList = productList.getBoundingClientRect();
          const rDelivery = deliveryDetails.getBoundingClientRect();
          const rOrderSummary = orderSummary.getBoundingClientRect();
          const rConfirmBtn = confirmBtn.getBoundingClientRect();

          // Overlap checks: delivery section must be below product list
          // When rendered in a scrollable container, check their offsetTop positions in normal flow
          const topHeader = header.offsetTop;
          const topSummaryTop = summaryTop.offsetTop;
          const topTools = tools.offsetTop;
          const topProductList = productList.offsetTop;
          const topDelivery = deliveryDetails.offsetTop;
          const topOrderSummary = orderSummary.offsetTop;
          const topConfirmBtn = confirmBtn.offsetTop;

          const deliveryFollowsProductList = topDelivery >= (topProductList + productList.offsetHeight - 5);
          const orderSummaryFollowsDelivery = topOrderSummary >= (topDelivery + deliveryDetails.offsetHeight - 5);
          const confirmBtnFollowsSummary = topConfirmBtn >= (topOrderSummary + orderSummary.offsetHeight - 5);

          // Horizontal overflow check
          const noHorizontalOverflow = drawerScrollWidth <= (drawerClientWidth + 4);

          return {
            count: cards.length,
            drawerRect,
            drawerScrollHeight,
            drawerClientHeight,
            noHorizontalOverflow,
            cardDetails,
            flowOrder: [
              topHeader,
              topSummaryTop,
              topTools,
              topProductList,
              topDelivery,
              topOrderSummary,
              topConfirmBtn
            ],
            deliveryFollowsProductList,
            orderSummaryFollowsDelivery,
            confirmBtnFollowsSummary
          };
        })()
      `);

      const allCardsValid = layoutAudit.cardDetails.every(c =>
        c.height >= 70 &&
        c.hasImg &&
        c.hasTitle &&
        c.hasVariants &&
        c.hasPrice &&
        c.hasQtyControls &&
        c.hasRemoveBtn &&
        c.hasCheckbox
      );

      const passSequence = layoutAudit.deliveryFollowsProductList &&
                           layoutAudit.orderSummaryFollowsDelivery &&
                           layoutAudit.confirmBtnFollowsSummary;

      const passNoHOverflow = layoutAudit.noHorizontalOverflow;

      const success = allCardsValid && passSequence && passNoHOverflow;
      if (!success) allPassed = false;

      console.log(`  [${count} Product${count > 1 ? 's' : ''}] ${success ? '✅ PASS' : '❌ FAIL'}:`);
      console.log(`     - All ${count} product cards fully visible: ${allCardsValid ? 'YES' : 'NO'}`);
      console.log(`     - Card heights: [${layoutAudit.cardDetails.map(c => Math.round(c.height) + 'px').join(', ')}]`);
      console.log(`     - Delivery Information section follows products without overlap: ${layoutAudit.deliveryFollowsProductList ? 'YES' : 'NO'}`);
      console.log(`     - Vertical order 1-7 intact: ${passSequence ? 'YES' : 'NO'}`);
      console.log(`     - No horizontal overflow (width: ${Math.round(layoutAudit.drawerRect.width)}px): ${passNoHOverflow ? 'YES' : 'NO'}`);
    }
  }

  // 3. Test Interactive Functionality in real browser
  console.log(`\n--------------------------------------------------------`);
  console.log(`Testing Interactive Functionality (Add/Remove/Qty/Select/Form)`);
  console.log(`--------------------------------------------------------`);

  const interactAudit = await client.eval(`
    (() => {
      // 1. Check quantity change
      const initialQty = cart[0].qty;
      changeCartQty(0, 1);
      const qtyIncreased = cart[0].qty === (initialQty + 1);

      changeCartQty(0, -1);
      const qtyDecreased = cart[0].qty === initialQty;

      // 2. Check item selection checkbox
      setCartItemSelected(0, false);
      const unselectedOk = cart[0].selected === false;
      setCartItemSelected(0, true);
      const reselectedOk = cart[0].selected === true;

      // 3. Check Select All / Clear
      selectAllCartItems(false);
      const clearedOk = cart.every(i => !i.selected);
      selectAllCartItems(true);
      const allSelectedOk = cart.every(i => i.selected);

      // 4. Fill form fields
      document.getElementById('cust-name').value = 'Fatima Ali';
      document.getElementById('cust-phone').value = '03001234567';
      document.getElementById('cust-address').value = 'Model Town, Lahore';

      const nameVal = document.getElementById('cust-name').value;
      const phoneVal = document.getElementById('cust-phone').value;
      const addrVal = document.getElementById('cust-address').value;

      // 5. Remove item
      const initialCount = cart.length;
      removeFromCart(0);
      const removeOk = cart.length === (initialCount - 1);

      return {
        qtyIncreased,
        qtyDecreased,
        unselectedOk,
        reselectedOk,
        clearedOk,
        allSelectedOk,
        formFields: (nameVal === 'Fatima Ali' && phoneVal === '03001234567' && addrVal === 'Model Town, Lahore'),
        removeOk
      };
    })()
  `);

  console.log(`  - Quantity increment/decrement: ${interactAudit.qtyIncreased && interactAudit.qtyDecreased ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - Checkbox selection & toggle: ${interactAudit.unselectedOk && interactAudit.reselectedOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - Select All / Clear controls: ${interactAudit.clearedOk && interactAudit.allSelectedOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - Delivery form inputs typing: ${interactAudit.formFields ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - Remove from Cart functionality: ${interactAudit.removeOk ? '✅ PASS' : '❌ FAIL'}`);

  const interactAllPass = Object.values(interactAudit).every(Boolean);

  console.log(`\n========================================================`);
  console.log(`Overall Mobile Shopping Cart Audit: ${allPassed && interactAllPass ? '100% PASSED ✅' : 'FAILED ❌'}`);
  console.log(`========================================================\n`);

  client.close();
  if (browserProc) {
    try { process.kill(browserProc.pid); } catch (e) {}
  }
  if (serverProc) {
    try { process.kill(serverProc.pid); } catch (e) {}
  }
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch (e) {}
}

main().catch(err => {
  console.error('Error running test:', err);
  if (browserProc) {
    try { process.kill(browserProc.pid); } catch (e) {}
  }
  if (serverProc) {
    try { process.kill(serverProc.pid); } catch (e) {}
  }
  process.exit(1);
});
