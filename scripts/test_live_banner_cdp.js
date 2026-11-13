const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9240;

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
  console.log('=== Verifying LIVE Production Homepage Banner (https://her-second-skin-pk.fly.dev/) ===');

  const browserProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);

  let client = null;
  for (let i = 0; i < 25; i++) {
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

  if (!client) throw new Error('Could not connect to Edge via CDP');
  await client.send('Page.enable');

  const requiredViewports = [
    { name: 'Mobile Ultra-Compact (320px)', w: 320, h: 568, mobile: true },
    { name: 'Mobile Common (360px)', w: 360, h: 640, mobile: true },
    { name: 'Mobile Standard iPhone (375px)', w: 375, h: 667, mobile: true },
    { name: 'Mobile iPhone 13/14 (390px)', w: 390, h: 844, mobile: true },
    { name: 'Mobile iPhone Pro Max (430px)', w: 430, h: 932, mobile: true },
    { name: 'Tablet Portrait iPad (768px)', w: 768, h: 1024, mobile: false },
    { name: 'Tablet Landscape / Netbook (1024px)', w: 1024, h: 768, mobile: false },
    { name: 'Desktop Laptop / MacBook (1440px)', w: 1440, h: 900, mobile: false },
    { name: 'Desktop Full HD Monitor (1920px)', w: 1920, h: 1080, mobile: false }
  ];

  const results = [];

  for (const vp of requiredViewports) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: 2,
      mobile: vp.mobile
    });

    await client.send('Page.navigate', { url: 'https://her-second-skin-pk.fly.dev/' });

    // Wait until the banner image is fully downloaded and rendered
    await client.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        function check() {
          const img = document.getElementById('hero-banner-img');
          if (img && img.complete && img.naturalWidth > 0) return resolve(true);
          setTimeout(check, 100);
        }
        check();
        setTimeout(() => resolve(false), 15000);
      })`,
      awaitPromise: true
    });
    await sleep(400);

    const audit = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const hero = document.querySelector('section.hero');
        const wrapper = document.getElementById('hero-banner-wrapper');
        const img = document.getElementById('hero-banner-img');
        const link = document.querySelector('.hero-banner-link');
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const bodyWidth = document.body.scrollWidth;

        if (!hero || !wrapper || !img) {
          return { error: 'Hero or banner elements missing' };
        }

        const heroRect = hero.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        const computed = window.getComputedStyle(img);

        const naturalWidth = img.naturalWidth || 899;
        const naturalHeight = img.naturalHeight || 343;
        const expectedRatio = naturalWidth / naturalHeight;
        const renderedRatio = imgRect.width / imgRect.height;

        const leftCrop = Math.max(0, heroRect.left - imgRect.left);
        const rightCrop = Math.max(0, imgRect.right - heroRect.right);
        const hasHorizontalScroll = (docWidth > winWidth + 1) || (bodyWidth > winWidth + 1);

        const taglines = Array.from(document.querySelectorAll('.brand-tagline, .hero-note')).map(e => e.textContent.trim());
        const accInNav = Array.from(document.querySelectorAll('header a, header button, .boutique-nav-links a')).some(e => e.textContent.includes('Accessories'));

        const floatingBar = document.querySelector('.floating-bar');
        let floatOverlap = false;
        let debugRects = {};
        if (floatingBar) {
          const comp = window.getComputedStyle(floatingBar);
          const isHidden = comp.opacity === '0' || comp.display === 'none' || comp.visibility === 'hidden' || floatingBar.classList.contains('hide-for-banner');
          if (!isHidden) {
            const fRect = floatingBar.getBoundingClientRect();
            floatOverlap = !(fRect.bottom < heroRect.top || fRect.top > heroRect.bottom || fRect.right < heroRect.left || fRect.left > heroRect.right);
            debugRects = {
              fRect: { top: Math.round(fRect.top), bottom: Math.round(fRect.bottom), left: Math.round(fRect.left), right: Math.round(fRect.right) },
              heroRect: { top: Math.round(heroRect.top), bottom: Math.round(heroRect.bottom), left: Math.round(heroRect.left), right: Math.round(heroRect.right) }
            };
          }
        }

        return {
          viewport: winWidth,
          bannerSrc: img.src,
          naturalWidth,
          naturalHeight,
          expectedRatio: expectedRatio.toFixed(3),
          renderedWidth: Math.round(imgRect.width),
          renderedHeight: Math.round(imgRect.height),
          renderedRatio: renderedRatio.toFixed(3),
          containerWidth: Math.round(heroRect.width),
          containerHeight: Math.round(heroRect.height),
          leftCrop: Math.round(leftCrop),
          rightCrop: Math.round(rightCrop),
          hasHorizontalScroll,
          objectFit: computed.objectFit,
          isLinkClickable: !!link && link.getAttribute('href') === '#collection',
          ariaLabel: link ? link.getAttribute('aria-label') : '',
          taglines,
          accInNav,
          floatOverlap,
          debugRects
        };
      })()`,
      returnByValue: true
    });

    const res = audit.result.value;
    results.push({ ...vp, ...res });
  }

  console.log('\n--- LIVE PRODUCTION VIEWPORT AUDIT MATRIX ---');
  let allPassed = true;

  for (const r of results) {
    const ratioDelta = Math.abs(parseFloat(r.renderedRatio) - parseFloat(r.expectedRatio));
    const passed = (
      r.renderedWidth > 0 &&
      r.renderedHeight > 0 &&
      r.leftCrop === 0 &&
      r.rightCrop === 0 &&
      !r.hasHorizontalScroll &&
      ratioDelta < 0.05 &&
      r.isLinkClickable &&
      r.accInNav &&
      !r.floatOverlap
    );

    if (!passed) allPassed = false;

    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${r.name}`);
    console.log(`       Rendered: ${r.renderedWidth}x${r.renderedHeight}px (Container: ${r.containerWidth}x${r.containerHeight}px)`);
    console.log(`       Aspect Ratio: Rendered ${r.renderedRatio} vs Natural ${r.expectedRatio} (delta: ${ratioDelta.toFixed(3)})`);
    console.log(`       Cropping: Left ${r.leftCrop}px, Right ${r.rightCrop}px | Horiz Scroll: ${r.hasHorizontalScroll ? 'YES' : 'NO'}`);
    console.log(`       object-fit: ${r.objectFit} | Banner Source: ${r.bannerSrc}`);
    console.log(`       Clickable Link: ${r.isLinkClickable} (${r.ariaLabel})`);
    console.log(`       Accessories in Nav: ${r.accInNav} | Float Overlap: ${r.floatOverlap ? 'YES' : 'NO'}`);
    console.log(`       Live Taglines: [${r.taglines.join(', ')}]`);
    if (r.floatOverlap) console.log(`       Overlap Rects:`, JSON.stringify(r.debugRects));
  }

  client.close();
  browserProc.kill();

  if (allPassed) {
    console.log('\n>>> LIVE PRODUCTION AUDIT: ALL 9 VIEWPORTS PASSED 100%! <<<');
    process.exit(0);
  } else {
    console.error('\n>>> LIVE PRODUCTION AUDIT FAILED! <<<');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
