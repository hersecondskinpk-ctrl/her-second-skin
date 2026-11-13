const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

const CDP_PORT = 9260;
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LIVE_URL = 'https://her-second-skin-pk.fly.dev';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('====================================================');
  console.log('   HER SECOND SKIN PK V9 — LIVE PRODUCTION AUDIT    ');
  console.log('   Target: ' + LIVE_URL);
  console.log('====================================================\n');

  // 1. Audit Live Public API
  console.log('[1/4] Auditing Live Public API for privacy...');
  const pubRes = await fetchJson(`${LIVE_URL}/api/products`);
  if (pubRes.status !== 200 || !pubRes.data.products) {
    throw new Error(`Live API error: status ${pubRes.status}`);
  }
  const products = pubRes.data.products;
  console.log(`Live products count: ${products.length}`);

  let leak = false;
  for (const p of products) {
    if (p.costPrice !== undefined || p.cost_price !== undefined) {
      console.error(`❌ LEAK: Product ${p.name} exposes costPrice!`);
      leak = true;
    }
    if (p.totalStock > 1) {
      console.error(`❌ LEAK: Product ${p.name} exposes real totalStock (${p.totalStock})!`);
      leak = true;
    }
    for (const v of (p.variants || [])) {
      if (v.stock > 1) {
        console.error(`❌ LEAK: Variant ${v.sku} exposes exact stock quantity (${v.stock})!`);
        leak = true;
      }
    }
  }
  if (leak) {
    throw new Error('Live API leaked sensitive inventory quantities or cost price!');
  }
  console.log('✅ Live Public API verified: 0 cost prices, 0 exact warehouse quantities exposed.\n');

  // 2. Launch Browser to inspect Live DOM across mobile viewports
  console.log('[2/4] Launching headless browser for Live Viewport verification...');
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
  const pageTarget = list.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension:')) || list.find(t => t.type === 'page') || list[0];
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

  const viewports = [
    { w: 320, h: 640 },
    { w: 360, h: 740 },
    { w: 375, h: 667 },
    { w: 390, h: 844 },
    { w: 414, h: 896 },
    { w: 768, h: 1024 },
    { w: 1280, h: 800 }
  ];

  console.log('[3/4] Testing Live Homepage Viewports...');
  for (const vp of viewports) {
    const isMobile = vp.w < 600;
    await callCdp('Emulation.setDeviceMetricsOverride', {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: 2,
      mobile: isMobile
    });

    await callCdp('Page.navigate', { url: `${LIVE_URL}/` });
    await sleep(2500);

    const evalRes = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const grid = document.getElementById('product-grid');
        const cards = Array.from(document.querySelectorAll('#product-grid .card'));
        const vpWidth = window.innerWidth;
        const bodyWidth = document.body.scrollWidth;
        if (!cards.length) return { error: 'No cards found in #product-grid' };
        
        const card = cards[0];
        const cardRect = card.getBoundingClientRect();
        const cardWidth = Math.round(cardRect.width);
        const leftPadding = Math.round(cardRect.left);
        const rightPadding = Math.round(vpWidth - cardRect.right);
        
        const variantsText = card.querySelector('.inventory-card-variants')?.textContent || '';
        const stockText = card.querySelector('.inventory-stock-label')?.textContent || '';
        const allText = card.innerText || '';
        
        const hasColorInSummary = /(black|white|cream|pink|red|blue|nude|beige|maroon|burgundy|grey|gray)/i.test(variantsText);
        const matchStock = allText.match(/\\d+\\s*(?:in\\s*stock|left\\s*in\\s*stock|piece)/i);
        
        return {
          vpWidth,
          bodyWidth,
          cardWidth,
          leftPadding,
          rightPadding,
          hasOverflow: bodyWidth > vpWidth + 1,
          hasLargeEmptyRight: ${isMobile} ? (rightPadding > 25) : false,
          variantsText,
          stockText,
          hasColorInSummary,
          hasExactStockNumber: Boolean(matchStock),
          matchedStock: matchStock ? matchStock[0] : null
        };
      })()`,
      returnByValue: true
    });

    const vRes = evalRes?.result?.value;
    if (!vRes || vRes.error) {
      throw new Error(`Live audit failed at ${vp.w}px: ${vRes?.error || 'evaluation error'}`);
    }

    console.log(`[Live ${vp.w}px] Card Width: ${vRes.cardWidth}px | Horizontal Padding: L=${vRes.leftPadding}px, R=${vRes.rightPadding}px | Empty Right: ${vRes.hasLargeEmptyRight ? '❌ YES' : '✅ NO'} | Overflow: ${vRes.hasOverflow ? '❌ YES' : '✅ NO'}`);
    console.log(`  └─ Size Summary: "${vRes.variantsText}"`);
    console.log(`  └─ Stock Display: "${vRes.stockText}"`);

    if (vRes.hasLargeEmptyRight) {
      throw new Error(`Live site has large empty right area at ${vp.w}px!`);
    }
    if (vRes.hasOverflow) {
      throw new Error(`Live site has horizontal overflow at ${vp.w}px!`);
    }
    if (vRes.hasColorInSummary) {
      throw new Error(`Live card size summary contains color names: "${vRes.variantsText}"`);
    }
    if (vRes.hasExactStockNumber) {
      throw new Error(`Live card exposes exact stock: "${vRes.matchedStock}"`);
    }
  }

  // 4. Test Live Category Page (sets.html where active products exist)
  console.log('\n[4/4] Testing Live Category Page (sets.html) at 375px...');
  await callCdp('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 667, deviceScaleFactor: 2, mobile: true
  });
  await callCdp('Page.navigate', { url: `${LIVE_URL}/sets.html` });
  await sleep(3500);

  const catEval = await callCdp('Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('main.grid .product, main.grid .hss-card, .product, .hss-card'));
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
      const matchStock = allText.match(/(?:available\s*stock:\s*\d+|\b\d+\s*(?:in\s*stock|left\s*in\s*stock|pieces?\s*in\s*stock)\b)/i);
      return {
        cardCount: cards.length,
        cardWidth,
        left,
        right,
        variantsText,
        stockText,
        allText,
        matched: matchStock ? matchStock[0] : null,
        hasExactStockNumber: Boolean(matchStock),
        hasLargeEmptyRight: right > 25
      };
    })()`,
    returnByValue: true
  });

  const cRes = catEval?.result?.value;
  if (!cRes || cRes.error) {
    throw new Error(`Live category test failed: ${cRes?.error || 'evaluation error'}`);
  }
  console.log(`[Live sets.html at 375px] Found ${cRes.cardCount} product(s) | Card Width: ${cRes.cardWidth}px | Empty Area on Right: ${cRes.hasLargeEmptyRight ? '❌ YES' : '✅ NO'}`);
  console.log(`  └─ Size Summary: "${cRes.variantsText}"`);
  console.log(`  └─ Stock Display: "${cRes.stockText}"`);

  if (cRes.hasLargeEmptyRight) {
    throw new Error(`Live sets.html has large empty area on right!`);
  }
  if (cRes.hasExactStockNumber) {
    console.error('Matched text:', cRes.matched);
    throw new Error(`Live sets.html exposes exact stock numbers: "${cRes.matched}"`);
  }

  ws.close();
  browserProc.kill();

  console.log('\n====================================================');
  console.log('   🎉 LIVE PRODUCTION AUDIT 100% PASSED!             ');
  console.log('   Domain: ' + LIVE_URL);
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ LIVE AUDIT ERROR:', err.message);
  process.exit(1);
});
