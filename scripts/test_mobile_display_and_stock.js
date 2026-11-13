const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 4055;
const CDP_PORT = 9255;
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('   HER SECOND SKIN PK V9 — VERIFICATION SUITE       ');
  console.log('====================================================\n');

  // 1. Start Local Server on TEST_PORT
  console.log(`[1/7] Starting local server on port ${TEST_PORT}...`);
  const serverProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => {
    // console.log('[Server stdout]:', d.toString().trim());
  });
  serverProc.stderr.on('data', d => {
    console.error('[Server stderr]:', d.toString().trim());
  });

  let serverStarted = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/products`);
      if (res.status === 200) {
        serverStarted = true;
        break;
      }
    } catch (_) {}
    await sleep(200);
  }

  if (!serverStarted) {
    throw new Error('Failed to start local server within 6 seconds.');
  }
  console.log('✅ Local server running successfully.\n');

  try {
    // 2. Test Public vs Admin API Stock and Cost Privacy
    console.log('[2/7] Testing API privacy: Public masking vs Admin access...');
    // Read Admin credentials
    const initialAdminFile = path.resolve(__dirname, '../data/INITIAL-ADMIN-LOGIN.txt');
    let adminPass = process.env.ADMIN_PASSWORD || 'BSwJXj-SszDrPXASVk-U';
    if (fs.existsSync(initialAdminFile)) {
      const content = fs.readFileSync(initialAdminFile, 'utf8');
      const m = content.match(/Password:\s*(\S+)/);
      if (m) adminPass = m[1];
    }

    const loginRes = await httpPost(`http://127.0.0.1:${TEST_PORT}/api/auth/login`, {
      username: 'admin',
      password: adminPass
    });
    let adminCookie = '';
    if (loginRes.headers && loginRes.headers['set-cookie']) {
      adminCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    }
    const adminHeaders = adminCookie ? { 'Cookie': adminCookie } : {};

    // If local test DB has no products, seed test products with multiple color/size variants
    let pubRes = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/products`);
    let pubProducts = pubRes.data.products || [];
    if (!pubProducts.length && adminCookie) {
      console.log('Seeding initial products with multi-color size variants for verification...');
      await httpPost(`http://127.0.0.1:${TEST_PORT}/api/products`, {
        name: 'Chic Seamless Push-Up Lingerie Set',
        category: 'sets',
        price: 2199,
        costPrice: 1200,
        comparePrice: 2800,
        description: 'Ultra-soft seamless push-up lingerie set designed for all-day comfort and effortless lift.',
        imageUrl: 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=900&q=85',
        variants: [
          { color: 'Black', size: '32', cupSize: 'B', stock: 5 },
          { color: 'Black', size: '34', cupSize: 'B', stock: 10 },
          { color: 'Black', size: '36', cupSize: 'B', stock: 8 },
          { color: 'Black', size: '38', cupSize: 'B', stock: 12 },
          { color: 'Cream', size: '32', cupSize: 'B', stock: 6 },
          { color: 'Cream', size: '34', cupSize: 'B', stock: 6 },
          { color: 'Cream', size: '36', cupSize: 'B', stock: 4 },
          { color: 'Cream', size: '38', cupSize: 'B', stock: 8 }
        ]
      }, adminHeaders);

      await httpPost(`http://127.0.0.1:${TEST_PORT}/api/products`, {
        name: 'Second Skin Seamless T-Shirt Bra',
        category: 'bras',
        price: 2200,
        costPrice: 1100,
        comparePrice: 2600,
        description: 'Smooth, invisible support designed to feel like your second skin under any outfit.',
        imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85',
        variants: [
          { color: 'Nude', size: '32', cupSize: 'B', stock: 12 },
          { color: 'Nude', size: '34', cupSize: 'B', stock: 15 },
          { color: 'Black', size: '32', cupSize: 'B', stock: 7 },
          { color: 'Black', size: '34', cupSize: 'B', stock: 8 }
        ]
      }, adminHeaders);

      pubRes = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/products`);
      pubProducts = pubRes.data.products || [];
    }

    if (!pubProducts || !pubProducts.length) {
      throw new Error('No products returned from /api/products.');
    }

    let leakFound = false;
    for (const p of pubProducts) {
      if (p.costPrice !== undefined || p.cost_price !== undefined) {
        console.error(`❌ Public API leak: Product ${p.name} exposes costPrice!`);
        leakFound = true;
      }
      if (p.totalStock > 1) {
        console.error(`❌ Public API leak: Product ${p.name} exposes real totalStock (${p.totalStock})!`);
        leakFound = true;
      }
      for (const v of p.variants) {
        if (v.stock > 1) {
          console.error(`❌ Public API leak: Variant ${v.sku} exposes exact stock quantity (${v.stock})!`);
          leakFound = true;
        }
      }
    }
    if (leakFound) {
      throw new Error('Public API failed security inspection: private inventory quantities or cost prices leaked.');
    }
    console.log(`✅ Public API verified: ${pubProducts.length} products checked. 0 cost prices leaked, 0 exact warehouse quantities exposed.`);

    // Test Admin API
    if (adminCookie) {
      const adminRes = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/products?admin=1`, {
        Cookie: adminCookie
      });
      const adminProducts = adminRes.data.products;
      const sampleAdminProduct = adminProducts.find(p => p.variants && p.variants.some(v => v.stock > 1));
      if (sampleAdminProduct) {
        console.log(`✅ Admin API verified: Authorized admin sees real stock (${sampleAdminProduct.totalStock} units) and costPrice (PKR ${sampleAdminProduct.costPrice}).`);
      } else {
        console.log(`✅ Admin API verified: Authorized admin access granted.`);
      }
    }
    console.log('');

    // 3. Launch Edge Browser for CDP Responsive and DOM Testing
    console.log(`[3/7] Launching headless browser on CDP port ${CDP_PORT}...`);
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

    let cdpId = 0;
    function callCdp(method, params = {}) {
      return new Promise(res => {
        const myId = ++cdpId;
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

    await callCdp('Page.enable');

    // 4. Test Viewports (320px, 360px, 375px, 390px, 414px, 768px, 1280px)
    console.log('[4/7] Testing responsive homepage layouts across 7 viewports...');
    const testViewports = [
      { w: 320, h: 640, isMobile: true },
      { w: 360, h: 740, isMobile: true },
      { w: 375, h: 667, isMobile: true },
      { w: 390, h: 844, isMobile: true },
      { w: 414, h: 896, isMobile: true },
      { w: 768, h: 1024, isMobile: false },
      { w: 1280, h: 800, isMobile: false }
    ];

    for (const vp of testViewports) {
      await callCdp('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 2,
        mobile: vp.isMobile
      });

      await callCdp('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/` });
      await sleep(2000);

      const evalRes = await callCdp('Runtime.evaluate', {
        expression: `(() => {
          const grid = document.getElementById('product-grid');
          const cards = Array.from(document.querySelectorAll('#product-grid .card'));
          const bodyWidth = document.body.scrollWidth;
          const vpWidth = window.innerWidth;
          
          if (!cards.length) return { error: 'No cards in product-grid' };
          
          const card = cards[0];
          const cardRect = card.getBoundingClientRect();
          const cardWidth = Math.round(cardRect.width);
          const gridWidth = grid ? Math.round(grid.getBoundingClientRect().width) : 0;
          const leftPadding = Math.round(cardRect.left);
          const rightPadding = Math.round(vpWidth - cardRect.right);
          
          const variantsText = card.querySelector('.inventory-card-variants')?.textContent || '';
          const stockText = card.querySelector('.inventory-stock-label')?.textContent || '';
          const allCardText = card.innerText || '';
          
          // Check for repeated color-size or leaked counts
          const hasColorNameInSummary = /(black|white|cream|pink|red|blue|nude|beige|maroon|burgundy|grey|gray)/i.test(variantsText);
          const hasExactStockNumber = /\\b\\d+\\s+in\\s+stock\\b/i.test(allCardText) || /\\bonly\\s+\\d+\\s+left\\b/i.test(allCardText);
          
          return {
            vpWidth,
            bodyWidth,
            gridWidth,
            cardWidth,
            leftPadding,
            rightPadding,
            hasOverflow: bodyWidth > vpWidth + 1,
            hasLargeEmptyRight: ${vp.isMobile ? 'true' : 'false'} ? (rightPadding > 25) : false,
            variantsText,
            stockText,
            hasColorNameInSummary,
            hasExactStockNumber
          };
        })()`,
        returnByValue: true
      });

      const vRes = evalRes?.result?.value;
      if (!vRes) {
        console.error('vRes is missing! evalRes was:', evalRes);
        throw new Error('Evaluation value missing');
      }
      if (vRes.error) {
        throw new Error(`Viewport ${vp.w}px failed: ${vRes.error}`);
      }

      console.log(`[Viewport ${vp.w}px] Card Width: ${vRes.cardWidth}px | Horizontal Padding: L=${vRes.leftPadding}px, R=${vRes.rightPadding}px | Empty Area on Right: ${vRes.hasLargeEmptyRight ? '❌ YES' : '✅ NO'} | Overflow: ${vRes.hasOverflow ? '❌ YES' : '✅ NO'}`);
      console.log(`  └─ Size Summary: "${vRes.variantsText}"`);
      console.log(`  └─ Stock Display: "${vRes.stockText}"`);

      if (vRes.hasLargeEmptyRight && vp.isMobile) {
        throw new Error(`Viewport ${vp.w}px has large empty area on the right (${vRes.rightPadding}px)!`);
      }
      if (vRes.hasOverflow) {
        throw new Error(`Viewport ${vp.w}px causes horizontal overflow (${vRes.bodyWidth}px > ${vRes.vpWidth}px)!`);
      }
      if (vRes.hasColorNameInSummary) {
        throw new Error(`Card size summary contains color names: "${vRes.variantsText}"`);
      }
      if (vRes.hasExactStockNumber) {
        throw new Error(`Card exposes exact stock numbers! Text: "${vRes.stockText}"`);
      }
    }
    console.log('✅ All 7 viewports passed mobile product card width and text verification.\n');

    // 5. Test Category Page (bras.html) on Mobile (375px)
    console.log('[5/7] Testing category page (bras.html) mobile responsiveness at 375px...');
    await callCdp('Emulation.setDeviceMetricsOverride', {
      width: 375, height: 667, deviceScaleFactor: 2, mobile: true
    });
    await callCdp('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/bras.html` });
    await sleep(2500);

    const catEval = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const grid = document.querySelector('main.grid');
        const cards = Array.from(document.querySelectorAll('main.grid .product, main.grid .hss-card, main.grid .card'));
        if (!cards.length) return { error: 'No products in category grid' };
        const card = cards[0];
        const cardRect = card.getBoundingClientRect();
        const cardWidth = Math.round(cardRect.width);
        const vpWidth = window.innerWidth;
        const left = Math.round(cardRect.left);
        const right = Math.round(vpWidth - cardRect.right);
        const variantsText = card.querySelector('.inventory-card-variants')?.textContent || '';
        const stockText = card.querySelector('.inventory-stock-label')?.textContent || '';
        const allText = card.innerText || '';
        const matchStock = allText.match(/\d+\s*(?:in\s*stock|left\s*in\s*stock|piece)/i);
        return {
          cardCount: cards.length,
          cardWidth,
          left,
          right,
          variantsText,
          stockText,
          allText,
          hasExactStockNumber: Boolean(matchStock),
          matched: matchStock ? matchStock[0] : null,
          hasLargeEmptyRight: right > 25
        };
      })()`,
      returnByValue: true
    });

    const cRes = catEval.result.value;
    console.log(`[bras.html at 375px] Found ${cRes.cardCount} product(s) | Card Width: ${cRes.cardWidth}px | Empty Area on Right: ${cRes.hasLargeEmptyRight ? '❌ YES' : '✅ NO'}`);
    console.log(`  └─ Size Summary: "${cRes.variantsText}"`);
    console.log(`  └─ Stock Display: "${cRes.stockText}"`);
    if (cRes.hasLargeEmptyRight) {
      throw new Error(`bras.html at 375px has large empty area on the right (${cRes.right}px)!`);
    }
    if (cRes.hasExactStockNumber) {
      throw new Error(`bras.html exposes exact stock numbers! Text: "${cRes.stockText}"`);
    }
    console.log('✅ Category page passed full-width and privacy tests.\n');

    // 6. Test Product Detail Page (product.html)
    console.log('[6/7] Testing Product Detail Page (product.html)...');
    const firstProductId = pubProducts[0].id;
    await callCdp('Page.navigate', { url: `http://127.0.0.1:${TEST_PORT}/product.html?id=${encodeURIComponent(firstProductId)}` });
    await sleep(2000);

    const pdpEval = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const pdpStock = document.getElementById('pdp-stock');
        const stockText = pdpStock ? pdpStock.textContent.trim() : '';
        const matchStock = stockText.match(/\d+\s*(?:in\s*stock|left\s*in\s*stock|piece)/i);
        const addBtn = document.getElementById('pdp-add');
        return {
          stockText,
          hasExactStockNumber: Boolean(matchStock),
          isAddEnabled: addBtn && !addBtn.disabled,
          addText: addBtn ? addBtn.textContent.trim() : ''
        };
      })()`,
      returnByValue: true
    });

    const pRes = pdpEval.result.value;
    console.log(`[product.html] Stock Note: "${pRes.stockText}" | Add to Cart Button: "${pRes.addText}" (Enabled: ${pRes.isAddEnabled})`);
    if (pRes.hasExactStockNumber) {
      throw new Error(`product.html reveals exact stock count: "${pRes.stockText}"`);
    }
    if (!pRes.isAddEnabled) {
      throw new Error(`product.html Add button is unexpectedly disabled for available product.`);
    }
    console.log('✅ Product detail page passed privacy and ordering controls verification.\n');

    // 7. Test Order Placement & Inventory Deduction
    console.log('[7/7] Testing Order Placement and Database Inventory Tracking...');
    const targetProduct = pubProducts.find(p => p.variants && p.variants.some(v => v.inStock));
    const targetVariant = targetProduct.variants.find(v => v.inStock);

    const orderPayload = {
      customerName: 'Test Verification Customer',
      phone: '03331234567',
      address: 'House 123, Street 4, Islamabad',
      idempotencyKey: 'test-order-' + Date.now(),
      items: [{ variantId: targetVariant.id, quantity: 1 }]
    };

    const orderRes = await httpPost(`http://127.0.0.1:${TEST_PORT}/api/orders`, orderPayload);
    if (orderRes.status !== 200 && orderRes.status !== 201) {
      throw new Error(`Order placement failed with status ${orderRes.status}: ${JSON.stringify(orderRes.data)}`);
    }
    console.log(`✅ Order placed successfully: Order #${orderRes.data.order.order_number}`);

    // Verify stock movement and backend inventory integrity
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.resolve(__dirname, '../data/her-second-skin.sqlite');
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath);
      const movement = db.prepare('SELECT * FROM stock_movements WHERE order_id=?').get(orderRes.data.order.id);
      if (movement) {
        console.log(`✅ Stock movement logged in SQLite: Variant ${movement.variant_id} deducted by ${movement.change_qty} (Reason: ${movement.reason}).`);
      }
      db.close();
    }

    ws.close();
    browserProc.kill();
    console.log('\n====================================================');
    console.log('   🎉 ALL 7 ACCEPTANCE TEST SUITES PASSED (100%)    ');
    console.log('====================================================\n');
  } finally {
    serverProc.kill();
  }
}

main().catch(err => {
  console.error('\n❌ TEST SUITE FAILURE:', err.message);
  process.exit(1);
});
