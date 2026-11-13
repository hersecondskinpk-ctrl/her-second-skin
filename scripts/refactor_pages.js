'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function backup(file) {
  const src = path.join(ROOT, file);
  const bak = path.join(ROOT, file + '.bak');
  if (fs.existsSync(src) && !fs.existsSync(bak)) {
    fs.copyFileSync(src, bak);
  }
}

// ----------------------------------------------------
// 1. REFACTOR index.html
// ----------------------------------------------------
console.log('Refactoring index.html...');
backup('index.html');
let indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Replace style blocks in head
indexHtml = indexHtml.replace(/<style[\s\S]*?<\/style>/i, 
  `<link rel="stylesheet" href="/css/common.css">\n  <link rel="stylesheet" href="/css/home.css">`);
// Remove any secondary style block if present
indexHtml = indexHtml.replace(/<style\s+id="hss-boutique-drawers"[\s\S]*?<\/style>/i, '');

// Remove category-images inline script
indexHtml = indexHtml.replace(/<script>\s*\(async\(\)=>\{try\{const response=await fetch\('\/api\/category-images'[\s\S]*?<\/script>/i, '');

// Replace all bottom script blocks up to </body>
const bottomScriptsRegex = /<script>[\s\S]*const ADMIN_WHATSAPP_NUMBER[\s\S]*<\/body>/i;
if (bottomScriptsRegex.test(indexHtml)) {
  indexHtml = indexHtml.replace(bottomScriptsRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/state.js"></script>
  <script src="/js/home.js"></script>
  <script src="/inventory-store.js" defer></script>
</body>`);
}
fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml, 'utf8');
console.log('✓ index.html refactored');

// ----------------------------------------------------
// 2. REFACTOR product.html
// ----------------------------------------------------
console.log('Refactoring product.html...');
backup('product.html');
let productHtml = fs.readFileSync(path.join(ROOT, 'product.html'), 'utf8');

// Replace all style tags with link tags
productHtml = productHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
productHtml = productHtml.replace(/<link\s+rel="stylesheet"\s+href="\/hss-fonts\.css">/i, 
  `<link rel="stylesheet" href="/hss-fonts.css">\n<link rel="stylesheet" href="/css/common.css">\n<link rel="stylesheet" href="/css/product.css">`);

// Replace scripts with separate js
const pdpScriptRegex = /<script>[\s\S]*function toggleMenu[\s\S]*<\/body>/i;
if (pdpScriptRegex.test(productHtml)) {
  productHtml = productHtml.replace(pdpScriptRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/state.js"></script>
  <script src="/js/product.js"></script>
  <script src="/inventory-store.js" defer></script>
</body>`);
}
fs.writeFileSync(path.join(ROOT, 'product.html'), productHtml, 'utf8');
console.log('✓ product.html refactored');

// ----------------------------------------------------
// 3. REFACTOR CATEGORY PAGES
// ----------------------------------------------------
const categories = ['bras.html', 'panties.html', 'sets.html', 'accessories.html', 'body-shaper.html', 'camisole.html'];
for (const catFile of categories) {
  const filePath = path.join(ROOT, catFile);
  if (!fs.existsSync(filePath)) continue;
  backup(catFile);
  let html = fs.readFileSync(filePath, 'utf8');

  // Replace style tags
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<link\s+rel="stylesheet"\s+href="\/hss-fonts\.css">/i, 
    `<link rel="stylesheet" href="/hss-fonts.css">\n<link rel="stylesheet" href="/css/common.css">\n<link rel="stylesheet" href="/css/category.css">`);

  // Replace bottom script
  const catScriptRegex = /<script>[\s\S]*function toggleMenu[\s\S]*<\/body>/i;
  if (catScriptRegex.test(html)) {
    html = html.replace(catScriptRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/state.js"></script>
  <script src="/js/category.js"></script>
  <script src="/inventory-store.js" defer></script>
</body>`);
  }
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`✓ ${catFile} refactored`);
}

// ----------------------------------------------------
// 4. REFACTOR admin.html
// ----------------------------------------------------
console.log('Refactoring admin.html...');
backup('admin.html');
let adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

// Replace style tag
adminHtml = adminHtml.replace(/<style[\s\S]*?<\/style>/i, `<link rel="stylesheet" href="/css/admin.css">`);

// Replace bottom scripts
const adminScriptsRegex = /<script>[\s\S]*const\s*\$=\s*id=>[\s\S]*<\/body>/i;
if (adminScriptsRegex.test(adminHtml)) {
  adminHtml = adminHtml.replace(adminScriptsRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/admin.js"></script>
</body>`);
}
fs.writeFileSync(path.join(ROOT, 'admin.html'), adminHtml, 'utf8');
console.log('✓ admin.html refactored');

// ----------------------------------------------------
// 5. REFACTOR exchange.html
// ----------------------------------------------------
console.log('Refactoring exchange.html...');
backup('exchange.html');
let exHtml = fs.readFileSync(path.join(ROOT, 'exchange.html'), 'utf8');

// Replace style tag
exHtml = exHtml.replace(/<style[\s\S]*?<\/style>/i, 
  `<link rel="stylesheet" href="/css/common.css">\n<link rel="stylesheet" href="/css/exchange.css">`);

// Replace script tag
const exScriptRegex = /<script>[\s\S]*'use strict';[\s\S]*<\/body>/i;
if (exScriptRegex.test(exHtml)) {
  exHtml = exHtml.replace(exScriptRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/state.js"></script>
  <script src="/js/exchange.js"></script>
</body>`);
}
fs.writeFileSync(path.join(ROOT, 'exchange.html'), exHtml, 'utf8');
console.log('✓ exchange.html refactored');

// ----------------------------------------------------
// 6. REFACTOR reel.html
// ----------------------------------------------------
console.log('Refactoring reel.html...');
backup('reel.html');
let reelHtml = fs.readFileSync(path.join(ROOT, 'reel.html'), 'utf8');

reelHtml = reelHtml.replace(/<style[\s\S]*?<\/style>/i, `<link rel="stylesheet" href="/css/reel.css">`);
const reelScriptRegex = /<script>[\s\S]*<\/body>/i;
if (reelScriptRegex.test(reelHtml)) {
  reelHtml = reelHtml.replace(reelScriptRegex, `
  <script src="/js/router.js"></script>
  <script src="/js/reel.js"></script>
</body>`);
}
fs.writeFileSync(path.join(ROOT, 'reel.html'), reelHtml, 'utf8');
console.log('✓ reel.html refactored');

console.log('\n=== ALL HTML PAGES SUCCESSFULLY REFACTORED! ===');
