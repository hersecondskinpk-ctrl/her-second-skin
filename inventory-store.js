/* Inventory-backed storefront integration. Loaded after each existing page's original JS. */
(() => {
  'use strict';
  const categoryLabels = { bras:'Bras', panties:'Panties', sets:'Bra & Panty Sets', accessories:'Accessories', 'body-shaper':'Body Shaper', camisole:'Camisole' };
  const pathPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const categoryPage = ({'bras.html':'bras','panties.html':'panties','sets.html':'sets','accessories.html':'accessories','body-shaper.html':'body-shaper','camisole.html':'camisole'})[pathPage] || '';
  const isProductPage = pathPage === 'product.html';
  const CART_KEY = 'hssp_cart';
  let cartRestored = false;
  let inventoryProducts = [];
  let activeInventoryProduct = null;
  let lastApiAvailable = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');
  const byId = id => document.getElementById(id);

  function availableVariants(product) { return (product?.variants || []).filter(v => v.active !== false); }
  function getMainGrid() { return byId('product-grid'); }

  const sizeRank = s => { const i = ['XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL'].indexOf(String(s).toUpperCase()); return i < 0 ? 100 : i; };
  const sizeSort = (a, b) => (sizeRank(a) - sizeRank(b)) || String(a).localeCompare(String(b), undefined, {numeric:true});

  function getUniqueSizesSummary(p) {
    const vars = availableVariants(p);
    const sizeSet = new Set();
    vars.forEach(v => {
      const s = String(v.size || '').trim();
      if (s && s.toLowerCase() !== 'not available' && s.toLowerCase() !== 'default') {
        sizeSet.add(s);
      }
    });
    if (!sizeSet.size) return '';
    const sorted = Array.from(sizeSet).sort(sizeSort);
    return `Available Sizes: ${sorted.join(' · ')}`;
  }

  function createHomeCard(p, index) {
    const stock = Boolean(p.inStock ?? (Number(p.totalStock) > 0));
    const img = p.image_url || '';
    const cat = p.category;
    const sizesSummary = getUniqueSizesSummary(p);
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.category = cat;
    div.dataset.price = p.price;
    div.dataset.name = p.name;
    div.dataset.sold = '0';
    div.dataset.featuredOrder = String(index);
    div.innerHTML = `
      <img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" onerror="this.style.opacity='.25';this.alt='Product image unavailable'">
      <div class="inventory-card-label">${esc(categoryLabels[cat] || cat)}</div>
      <h3>${esc(p.name)}</h3>
      ${sizesSummary ? `<div class="inventory-card-variants">${esc(sizesSummary)}</div>` : ''}
      <div class="price">${money(p.price)}</div>
      <div class="btn-group" onclick="event.stopPropagation()"><button class="card-btn" onclick="location.href='product.html?id=${p.id}'">${stock ? 'Select Options' : 'View Details'}</button></div>
      <div class="inventory-stock-label ${stock ? '' : 'out'}">${stock ? 'In Stock' : 'Currently Out of Stock'}</div>`;
    div.addEventListener('click', () => { location.href = 'product.html?id=' + encodeURIComponent(p.id); });
    return div;
  }
  function setEmptyGrid(grid, title, detail) {
    grid.innerHTML = `<div class="inventory-empty"><div class="inventory-empty-icon">♡</div><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`;
  }
  function renderHomeProducts() {
    const grid = getMainGrid();
    if (!grid) return;
    addStoreStyles();
    grid.innerHTML = '';
    if (!inventoryProducts.length) {
      setEmptyGrid(grid, 'Our collection is being prepared', 'New products will appear here as soon as inventory is added in the Her Second Skin PK Admin Panel.');
      return;
    }
    const sorted = inventoryProducts.slice();
    sorted.forEach((p, i) => grid.appendChild(createHomeCard(p, i)));
    if (typeof window.filterProducts === 'function') window.filterProducts();
    if (typeof window.sortProducts === 'function' && byId('sort-select')) window.sortProducts();
  }
  // ===== HSS COLLECTION PAGE v2 — sort, filters, wishlist, pagination, sale prices =====
  const WA_NUMBER = '923397055500';
  const WISH_KEY = 'hssp_wishlist';
  const PAGE_SIZE = 24;
  const catState = { all:[], sort:'featured', inStock:false, min:null, max:null, sizes:new Set(), colors:new Set(), page:1 };
  const getWish = () => { try { return JSON.parse(localStorage.getItem(WISH_KEY) || '[]'); } catch (e) { return []; } };
  const saveWish = list => { try { localStorage.setItem(WISH_KEY, JSON.stringify(list)); } catch (e) {} updateWishBadges(); };
  const liveVariants = p => (p.variants || []).filter(v => v.active !== false && v.active !== 0);
  const discountPct = p => (Number(p.comparePrice) > Number(p.price)) ? Math.round((1 - Number(p.price) / Number(p.comparePrice)) * 100) : 0;

  function updateCartBadge() {
    let n = 0; try { n = (JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []).reduce((a, i) => a + (Number(i.qty) || 0), 0); } catch (e) {}
    document.querySelectorAll('.header-actions a[aria-label="Cart"] .badge').forEach(b => { b.textContent = n; });
    document.querySelectorAll('.header-actions a[aria-label="Cart"]').forEach(a => { a.href = 'index.html?cart=1'; a.title = 'Open cart'; });
  }
  function updateWishBadges() {
    const n = getWish().filter(id => inventoryProducts.some(p => p.id === id)).length;
    document.querySelectorAll('.header-actions a[aria-label="Wishlist"] .badge, .hss-bar-badge').forEach(b => { b.textContent = n; });
  }

  function addCategoryStyles() {
    if (byId('hss-cat-styles')) return;
    const st = document.createElement('style'); st.id = 'hss-cat-styles';
    st.textContent = `
.hss-toolbar{max-width:1500px;margin:0 auto;padding:16px 4% 0}
.hss-tb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid #ead7dd}
.hss-filter-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;color:#4a1525;border:1px solid #4a1525;border-radius:3px;padding:9px 18px;font-size:13px;letter-spacing:.6px;text-transform:uppercase;cursor:pointer}
.hss-filter-btn:hover{background:#4a1525;color:#fff}
#hss-count{color:#76535f;font-size:13px}
.hss-sort{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a1525}
.hss-sort select{border:1px solid #d9bcc6;border-radius:3px;padding:8px 10px;background:#fff;color:#2c1a21;font-size:13px}
.hss-chips{display:flex;flex-wrap:wrap;gap:8px;padding-top:10px}.hss-chips:empty{display:none}
.hss-chip{background:#faf3f0;border:1px solid #ead7dd;border-radius:999px;padding:5px 11px;font-size:12px;color:#4a1525;cursor:pointer}
.hss-chip.clear{background:transparent;border-color:transparent;text-decoration:underline}
main.grid .hss-card{border:0;background:transparent;box-shadow:none;position:relative;overflow:visible}
main.grid .hss-card:hover{transform:none;box-shadow:none}
.hss-imgwrap{position:relative;display:block;overflow:hidden;border-radius:4px;background:#f5e9ec;aspect-ratio:3/4}
.hss-imgwrap img{position:absolute!important;inset:0;width:100%;height:100%!important;object-fit:cover;aspect-ratio:auto!important;transition:opacity .35s,transform .5s}
.hss-imgwrap img.alt{opacity:0}
.hss-card:hover .hss-imgwrap img.alt{opacity:1}
.hss-card:hover .hss-imgwrap img.main{transform:scale(1.03)}
.hss-card.is-sold .hss-imgwrap img.main{opacity:.6}
.hss-badge{position:absolute;top:8px;left:8px;background:#a33b5c;color:#fff;font-size:11px;font-weight:700;letter-spacing:.4px;padding:3px 8px;border-radius:3px;z-index:2}
.hss-badge.sold{top:auto;bottom:8px;background:#4a1525}
.hss-heart{position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.93);font-size:18px;line-height:1;color:#4a1525;cursor:pointer;z-index:3}
.hss-heart.on{color:#a33b5c}
.hss-card .details{padding:10px 4px 0;text-align:center}
.hss-card h2{font-size:14px;font-weight:600;margin:0 0 5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hss-card h2 a{color:#2c1a21}
.hss-card .price{margin:2px 0 0;font-size:15px}
.hss-card .price del{color:#9a8a90;font-weight:400;font-size:13px;margin-right:8px}
.hss-card .price .now{color:#a33b5c;font-weight:700}
.hss-card .price .now.sale{color:#b42318}
.hss-pager{display:flex;justify-content:center;flex-wrap:wrap;gap:6px;padding:6px 4% 34px}
.hss-pager button{min-width:38px;height:38px;border:1px solid #ead7dd;background:#fff;color:#4a1525;border-radius:3px;cursor:pointer;font-size:13px}
.hss-pager button.on{background:#4a1525;color:#fff;border-color:#4a1525}
.hss-pager button:disabled{opacity:.4;cursor:default}
.hss-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:none}.hss-ov.on{display:block}
.hss-drawer{position:fixed;top:0;left:-400px;width:min(360px,90vw);height:100%;background:#fff;z-index:1001;transition:left .28s ease;display:flex;flex-direction:column;box-shadow:0 0 18px rgba(0,0,0,.18)}
.hss-drawer.on{left:0}
.hss-dr-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #ead7dd;color:#4a1525}
.hss-dr-head button{background:none;border:0;font-size:26px;cursor:pointer;color:#4a1525;line-height:1}
.hss-dr-body{flex:1;overflow-y:auto;padding:6px 18px 12px}
.hss-sec{padding:14px 0;border-bottom:1px solid #f1e3e7}
.hss-sec h4{margin:0 0 10px;font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:#4a1525}
.hss-sec label.check{display:flex;gap:8px;align-items:center;font-size:14px;color:#2c1a21}
.hss-price{display:flex;align-items:center;gap:8px}
.hss-price input{width:100%;border:1px solid #d9bcc6;border-radius:3px;padding:9px;font-size:14px}
.hss-sec small{display:block;margin-top:6px;color:#76535f;font-size:12px}
.hss-chipset{display:flex;flex-wrap:wrap;gap:8px}
.hss-opt{border:1px solid #d9bcc6;background:#fff;color:#2c1a21;border-radius:3px;padding:7px 12px;font-size:13px;cursor:pointer}
.hss-opt.on{background:#4a1525;border-color:#4a1525;color:#fff}
.hss-dr-foot{display:flex;gap:10px;padding:14px 18px;border-top:1px solid #ead7dd}
.hss-dr-foot button{flex:1;padding:12px;font-size:13px;letter-spacing:.5px;border-radius:3px;cursor:pointer}
.hss-btn-ghost{background:#fff;color:#4a1525;border:1px solid #4a1525}
.hss-btn-solid{background:#4a1525;color:#fff;border:1px solid #4a1525}
.hss-wish-item{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #f1e3e7}
.hss-wish-item img{width:58px;height:74px;object-fit:cover;border-radius:3px;background:#f5e9ec}
.hss-wish-item a{color:#2c1a21;font-size:14px;font-weight:600;display:block;margin-bottom:4px}
.hss-wish-item span{color:#a33b5c;font-size:13px}
.hss-wish-item button{margin-left:auto;background:none;border:0;font-size:22px;color:#76535f;cursor:pointer}
.hss-wa{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;background:#25d366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:27px;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:90;text-decoration:none}
.hss-bar{display:none}
@media(max-width:820px){
 .hss-wa{display:none}
 body{padding-bottom:64px}
 .hss-bar{display:flex;position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #ead7dd;z-index:95;box-shadow:0 -4px 14px rgba(74,21,37,.08)}
 .hss-bar a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0 9px;font-size:11px;color:#4a1525;text-decoration:none;position:relative}
 .hss-bar a b{font-size:20px;font-weight:400;line-height:1}
 .hss-bar a.wa{color:#128c4a}
 .hss-bar-badge{position:absolute;top:3px;left:calc(50% + 6px);background:#a33b5c;color:#fff;font-size:10px;font-style:normal;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center}
 .hss-toolbar{padding:12px 3% 0}
 .hss-filter-btn{padding:8px 14px}
 .hss-sort span{display:none}
 .hss-card h2{font-size:13px}
}`;
    document.head.appendChild(st);
  }

  function setupCategoryChrome() {
    if (byId('hss-chrome')) return;
    const wrap = document.createElement('div'); wrap.id = 'hss-chrome';
    const label = categoryLabels[categoryPage] || 'collection';
    const waText = encodeURIComponent(`Hi Her Second Skin PK, I would like to order from your ${label} collection.`);
    wrap.innerHTML = `
<div class="hss-ov" id="hss-ov"></div>
<aside class="hss-drawer" id="hss-filter-drawer" aria-label="Filters">
  <div class="hss-dr-head"><strong>Filter</strong><button type="button" data-close aria-label="Close">×</button></div>
  <div class="hss-dr-body">
    <div class="hss-sec"><h4>Availability</h4><label class="check"><input type="checkbox" id="hss-f-stock"> In stock only</label></div>
    <div class="hss-sec"><h4>Price (PKR)</h4><div class="hss-price"><input type="number" id="hss-f-min" min="0" placeholder="From"><span>–</span><input type="number" id="hss-f-max" min="0" placeholder="To"></div><small id="hss-price-hint"></small></div>
    <div class="hss-sec" id="hss-sec-size"><h4>Size</h4><div class="hss-chipset" id="hss-sizes"></div></div>
    <div class="hss-sec" id="hss-sec-color"><h4>Colour</h4><div class="hss-chipset" id="hss-colors"></div></div>
  </div>
  <div class="hss-dr-foot"><button type="button" class="hss-btn-ghost" id="hss-clear-all">Clear all</button><button type="button" class="hss-btn-solid" id="hss-apply">Show products</button></div>
</aside>
<aside class="hss-drawer" id="hss-wish-drawer" aria-label="Saved items">
  <div class="hss-dr-head"><strong>♡ Saved items</strong><button type="button" data-close aria-label="Close">×</button></div>
  <div class="hss-dr-body" id="hss-wish-body"></div>
</aside>
<a class="hss-wa" href="https://wa.me/${WA_NUMBER}?text=${waText}" target="_blank" rel="noopener" aria-label="Order on WhatsApp" title="Order on WhatsApp">💬</a>
<nav class="hss-bar" aria-label="Quick navigation">
  <a href="#" id="hss-bar-menu"><b>☰</b>Menu</a>
  <a href="index.html"><b>⌂</b>Home</a>
  <a href="#" id="hss-bar-wish"><b>♡</b>Wishlist<i class="hss-bar-badge">0</i></a>
  <a class="wa" href="https://wa.me/${WA_NUMBER}?text=${waText}" target="_blank" rel="noopener"><b>💬</b>WhatsApp</a>
</nav>`;
    document.body.appendChild(wrap);
    const closeAll = () => { document.querySelectorAll('.hss-drawer').forEach(d => d.classList.remove('on')); byId('hss-ov').classList.remove('on'); };
    const openDrawer = id => { closeAll(); byId(id).classList.add('on'); byId('hss-ov').classList.add('on'); };
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target.id === 'hss-ov') closeAll(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    const openWish = e => { if (e) e.preventDefault(); renderWishDrawer(); openDrawer('hss-wish-drawer'); };
    byId('hss-bar-wish').addEventListener('click', openWish);
    const hdrHeart = document.querySelector('.header-actions a[aria-label="Wishlist"]'); if (hdrHeart) hdrHeart.addEventListener('click', openWish);
    byId('hss-bar-menu').addEventListener('click', e => { e.preventDefault(); if (typeof window.toggleMenu === 'function') window.toggleMenu(true); });
    byId('hss-wish-body').addEventListener('click', e => { const b = e.target.closest('[data-unwish]'); if (!b) return; saveWish(getWish().filter(id => id !== b.dataset.unwish)); renderWishDrawer(); document.querySelectorAll('.hss-heart').forEach(h => { if (h.dataset.id === b.dataset.unwish) { h.classList.remove('on'); h.textContent = '♡'; } }); });
    updateCartBadge();
    window.hssOpenFilter = () => openDrawer('hss-filter-drawer');
    window.hssCloseDrawers = closeAll;
  }

  function renderWishDrawer() {
    const ids = getWish(); const items = ids.map(id => inventoryProducts.find(p => p.id === id)).filter(Boolean);
    byId('hss-wish-body').innerHTML = items.length ? items.map(p => `<div class="hss-wish-item"><img src="${esc(p.image_url || '')}" alt=""><div><a href="product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a><span>${money(p.price)}</span></div><button type="button" data-unwish="${esc(p.id)}" aria-label="Remove">×</button></div>`).join('') : '<p style="color:#76535f;font-size:14px;padding:18px 0">Nothing saved yet. Tap the ♡ on any product to save it here.</p>';
  }

  function matchesFilters(p) {
    if (catState.inStock && !(Number(p.totalStock) > 0)) return false;
    if (catState.min != null && Number(p.price) < catState.min) return false;
    if (catState.max != null && Number(p.price) > catState.max) return false;
    if (catState.sizes.size || catState.colors.size) {
      const ok = liveVariants(p).some(v => Number(v.stock) > 0 && (!catState.sizes.size || catState.sizes.has(v.size)) && (!catState.colors.size || catState.colors.has(v.color)));
      if (!ok) return false;
    }
    return true;
  }
  const sorters = {
    featured: (a, b) => (Number(b.totalStock > 0) - Number(a.totalStock > 0)),
    az: (a, b) => String(a.name).localeCompare(String(b.name)),
    za: (a, b) => String(b.name).localeCompare(String(a.name)),
    plh: (a, b) => Number(a.price) - Number(b.price),
    phl: (a, b) => Number(b.price) - Number(a.price),
    newest: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    oldest: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
  };

  function cardHtml(p) {
    const stock = Boolean(p.inStock ?? (Number(p.totalStock) > 0)); const pct = discountPct(p);
    const urls = []; if (p.image_url) urls.push(p.image_url); (p.images || []).forEach(im => { if (im.url && !urls.includes(im.url)) urls.push(im.url); });
    const href = `product.html?id=${encodeURIComponent(p.id)}`;
    const wished = getWish().includes(p.id);
    const sizesSummary = getUniqueSizesSummary(p);
    return `<article class="product hss-card${stock ? '' : ' is-sold'}"><div class="hss-imgwrap"><a href="${href}" aria-label="${esc(p.name)}" style="position:absolute;inset:0;display:block"><img class="main" loading="lazy" src="${esc(urls[0] || '')}" alt="${esc(p.name)}" onerror="this.style.opacity='.25'">${urls[1] ? `<img class="alt" loading="lazy" src="${esc(urls[1])}" alt="">` : ''}</a>${pct && stock ? `<span class="hss-badge">-${pct}%</span>` : ''}${stock ? '' : '<span class="hss-badge sold">Sold out</span>'}<button type="button" class="hss-heart${wished ? ' on' : ''}" data-id="${esc(p.id)}" aria-label="Save to wishlist">${wished ? '♥' : '♡'}</button></div><div class="details"><h2><a href="${href}">${esc(p.name)}</a></h2>${sizesSummary ? `<div class="inventory-card-variants" style="margin:4px 0">${esc(sizesSummary)}</div>` : ''}<div class="price">${pct ? `<del>${money(p.comparePrice)}</del>` : ''}<span class="now${pct ? ' sale' : ''}">${money(p.price)}</span></div><div class="inventory-stock-label ${stock ? '' : 'out'}" style="margin-top:5px">${stock ? 'In Stock' : 'Currently Out of Stock'}</div></div></article>`;
  }

  function drawCategory() {
    const grid = document.querySelector('main.grid'); if (!grid) return;
    const list = catState.all.filter(matchesFilters).sort(sorters[catState.sort] || sorters.featured);
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); if (catState.page > pages) catState.page = pages;
    const slice = list.slice((catState.page - 1) * PAGE_SIZE, catState.page * PAGE_SIZE);
    grid.innerHTML = slice.length ? slice.map(cardHtml).join('') : '<div class="inventory-empty"><h3 style="margin:0 0 8px">No products match these filters</h3><button type="button" class="hss-btn-solid" style="padding:10px 18px;border-radius:3px;cursor:pointer" data-clear>Clear filters</button></div>';
    byId('hss-count').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
    const chips = [];
    if (catState.inStock) chips.push(['stock', 'In stock only']);
    if (catState.min != null || catState.max != null) chips.push(['price', `PKR ${catState.min != null ? catState.min.toLocaleString('en-PK') : '0'} – ${catState.max != null ? catState.max.toLocaleString('en-PK') : 'any'}`]);
    catState.sizes.forEach(s => chips.push(['size:' + s, 'Size ' + s])); catState.colors.forEach(c => chips.push(['color:' + c, c]));
    byId('hss-chips').innerHTML = chips.length ? chips.map(c => `<button type="button" class="hss-chip" data-rm="${esc(c[0])}">${esc(c[1])} ×</button>`).join('') + '<button type="button" class="hss-chip clear" data-clear>Clear all</button>' : '';
    const pager = byId('hss-pager');
    if (pages <= 1) pager.innerHTML = '';
    else { let h = `<button type="button" data-pg="${catState.page - 1}" ${catState.page === 1 ? 'disabled' : ''}>‹</button>`; for (let i = 1; i <= pages; i++) h += `<button type="button" data-pg="${i}" class="${i === catState.page ? 'on' : ''}">${i}</button>`; h += `<button type="button" data-pg="${catState.page + 1}" ${catState.page === pages ? 'disabled' : ''}>›</button>`; pager.innerHTML = h; }
    const apply = byId('hss-apply'); if (apply) apply.textContent = `Show ${list.length} product${list.length === 1 ? '' : 's'}`;
  }

  function clearFilters() {
    catState.inStock = false; catState.min = null; catState.max = null; catState.sizes.clear(); catState.colors.clear(); catState.page = 1;
    byId('hss-f-stock').checked = false; byId('hss-f-min').value = ''; byId('hss-f-max').value = '';
    document.querySelectorAll('#hss-sizes .hss-opt, #hss-colors .hss-opt').forEach(b => b.classList.remove('on'));
    drawCategory();
  }

  function buildCategoryUi(grid) {
    ['hss-toolbar', 'hss-pager'].forEach(id => { const n = byId(id); if (n) n.remove(); });
    const tb = document.createElement('section'); tb.className = 'hss-toolbar'; tb.id = 'hss-toolbar';
    tb.innerHTML = `<div class="hss-tb-row"><button type="button" class="hss-filter-btn" id="hss-open-filter">☰ Filter</button><span id="hss-count"></span><label class="hss-sort"><span>Sort by</span><select id="hss-sort"><option value="featured">Featured</option><option value="az">Alphabetically, A–Z</option><option value="za">Alphabetically, Z–A</option><option value="plh">Price, low to high</option><option value="phl">Price, high to low</option><option value="newest">Date, new to old</option><option value="oldest">Date, old to new</option></select></label></div><div class="hss-chips" id="hss-chips"></div>`;
    grid.parentNode.insertBefore(tb, grid);
    const pager = document.createElement('div'); pager.className = 'hss-pager'; pager.id = 'hss-pager'; grid.parentNode.insertBefore(pager, grid.nextSibling);
    // filter options come from live variants of this category
    const sizes = new Set(), colors = new Set(); let maxPrice = 0;
    catState.all.forEach(p => { maxPrice = Math.max(maxPrice, Number(p.price) || 0); liveVariants(p).forEach(v => { if (v.size) sizes.add(v.size); if (v.color) colors.add(v.color); }); });
    byId('hss-sizes').innerHTML = [...sizes].sort(sizeSort).map(s => `<button type="button" class="hss-opt" data-size="${esc(s)}">${esc(s)}</button>`).join('');
    byId('hss-colors').innerHTML = [...colors].sort().map(c => `<button type="button" class="hss-opt" data-color="${esc(c)}">${esc(c)}</button>`).join('');
    byId('hss-sec-size').style.display = sizes.size ? '' : 'none'; byId('hss-sec-color').style.display = colors.size ? '' : 'none';
    byId('hss-price-hint').textContent = maxPrice ? `The highest price is ${money(maxPrice)}` : '';
    if (!tb.dataset.bound) {
      tb.dataset.bound = '1';
      byId('hss-open-filter').addEventListener('click', () => window.hssOpenFilter && window.hssOpenFilter());
      byId('hss-sort').addEventListener('change', e => { catState.sort = e.target.value; catState.page = 1; drawCategory(); });
    }
    const drawer = byId('hss-filter-drawer');
    if (!drawer.dataset.bound) {
      drawer.dataset.bound = '1';
      byId('hss-f-stock').addEventListener('change', e => { catState.inStock = e.target.checked; catState.page = 1; drawCategory(); });
      const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
      byId('hss-f-min').addEventListener('input', e => { catState.min = num(e.target.value); catState.page = 1; drawCategory(); });
      byId('hss-f-max').addEventListener('input', e => { catState.max = num(e.target.value); catState.page = 1; drawCategory(); });
      drawer.addEventListener('click', e => {
        const s = e.target.closest('[data-size]'), c = e.target.closest('[data-color]');
        if (s) { const v = s.dataset.size; catState.sizes.has(v) ? catState.sizes.delete(v) : catState.sizes.add(v); s.classList.toggle('on'); catState.page = 1; drawCategory(); }
        if (c) { const v = c.dataset.color; catState.colors.has(v) ? catState.colors.delete(v) : catState.colors.add(v); c.classList.toggle('on'); catState.page = 1; drawCategory(); }
      });
      byId('hss-clear-all').addEventListener('click', clearFilters);
      byId('hss-apply').addEventListener('click', () => { window.hssCloseDrawers && window.hssCloseDrawers(); tb.scrollIntoView({behavior:'smooth', block:'start'}); });
    }
    tb.addEventListener('click', e => {
      if (e.target.closest('[data-clear]')) return clearFilters();
      const rm = e.target.closest('[data-rm]'); if (!rm) return; const k = rm.dataset.rm;
      if (k === 'stock') { catState.inStock = false; byId('hss-f-stock').checked = false; }
      else if (k === 'price') { catState.min = null; catState.max = null; byId('hss-f-min').value = ''; byId('hss-f-max').value = ''; }
      else if (k.startsWith('size:')) { catState.sizes.delete(k.slice(5)); document.querySelectorAll('#hss-sizes .hss-opt').forEach(b => { if (b.dataset.size === k.slice(5)) b.classList.remove('on'); }); }
      else if (k.startsWith('color:')) { catState.colors.delete(k.slice(6)); document.querySelectorAll('#hss-colors .hss-opt').forEach(b => { if (b.dataset.color === k.slice(6)) b.classList.remove('on'); }); }
      catState.page = 1; drawCategory();
    });
    byId('hss-pager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return; catState.page = Number(b.dataset.pg); drawCategory(); byId('hss-toolbar').scrollIntoView({behavior:'smooth', block:'start'}); });
    if (!grid.dataset.bound) {
      grid.dataset.bound = '1';
      grid.addEventListener('click', e => {
        if (e.target.closest('[data-clear]')) return clearFilters();
        const h = e.target.closest('.hss-heart'); if (!h) return; e.preventDefault(); e.stopPropagation();
        const id = h.dataset.id; let list = getWish();
        if (list.includes(id)) { list = list.filter(x => x !== id); h.classList.remove('on'); h.textContent = '♡'; } else { list.push(id); h.classList.add('on'); h.textContent = '♥'; }
        saveWish(list);
      });
    }
  }

  function renderCategoryProducts() {
    const grid = document.querySelector('main.grid');
    if (!grid) return;
    addStoreStyles(); addCategoryStyles(); setupCategoryChrome();
    catState.all = inventoryProducts.filter(p => p.category === categoryPage);
    updateWishBadges();
    if (!catState.all.length) {
      ['hss-toolbar', 'hss-pager'].forEach(id => { const n = byId(id); if (n) n.remove(); });
      setEmptyGrid(grid, `No ${categoryLabels[categoryPage] || 'products'} listed yet`, 'اس کیٹیگری کی پروڈکٹس ایڈمن پینل میں شامل ہونے کے بعد یہاں نظر آئیں گی۔');
      return;
    }
    buildCategoryUi(grid);
    drawCategory();
  }
  // ===== end HSS COLLECTION PAGE v2 =====
  function addStoreStyles() {
    if (byId('inventory-store-styles')) return;
    const style = document.createElement('style'); style.id='inventory-store-styles';
    style.textContent = `@media(max-width:800px){.grid-container#product-grid,.grid-container:not(.category-grid),main.grid,.grid:not(.category-grid),.deal-grid,.recent-grid{grid-template-columns:1fr!important;padding:0 14px!important;gap:18px!important}#product-grid .card,.grid-container:not(.category-grid) .card,main.grid .product,main.grid .hss-card{width:100%!important;max-width:100%!important;margin:0 0 10px 0!important}#product-grid .card img,.grid-container:not(.category-grid) .card img,main.grid .product img,.hss-imgwrap{height:clamp(240px,70vw,380px)!important}.category-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;padding:0 12px!important;max-width:100%!important}.category-grid .card{width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;padding:0!important;background:transparent!important;border:none!important;box-shadow:none!important}.category-grid .card img{width:100%!important;height:auto!important;aspect-ratio:1/1!important;border-radius:12px!important;object-fit:cover!important}.category-grid .card h3{font-size:11px!important;letter-spacing:.5px!important;margin:6px 0 0!important;padding:0!important}}.category-grid .card{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important;margin:0!important}.card,.product,.hss-card{min-width:0!important;box-sizing:border-box!important}.card img,.product img{width:100%!important;max-width:100%!important;box-sizing:border-box!important;display:block!important}.card h3,.product h2,.inventory-card-variants,.card .price,.product .price{max-width:100%!important;box-sizing:border-box!important;word-break:break-word!important;overflow-wrap:anywhere!important}.inventory-card-label{font-size:10px;color:#9b5670;letter-spacing:1px;text-transform:uppercase;margin-top:8px}.inventory-card-variants{font-size:11px;color:#776871;padding:0 8px 5px;line-height:1.4}.inventory-stock-label{font-size:11px;color:#357451;margin:5px 0 0}.inventory-stock-label.out{color:#b42318}.inventory-empty{grid-column:1/-1;padding:45px 22px;border:1px dashed #d8b6c2;border-radius:18px;background:#fffafb;text-align:center;max-width:760px;margin:10px auto;width:100%;color:#6f5862}.inventory-empty-icon{font-size:34px;color:#a33b5c}.inventory-empty h3{color:#4a1525;margin:7px 0}.inventory-empty p{line-height:1.6;font-size:13px}.inventory-modal-stock{font-size:12px;margin:6px 0 9px;color:#357451}.inventory-modal-stock.out{color:#b42318}.inventory-stock-warning{font-size:10px;line-height:1.4;color:#a33b5c;margin:3px 0 7px}`;
    document.head.appendChild(style);
  }
  function fillSelect(select, values, selected) {
    if (!select) return;
    const oldDisabled = select.disabled;
    select.innerHTML = values.map(v => `<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(v)}</option>`).join('');
    select.disabled = oldDisabled;
  }
  function variantsForSelection() {
    if (!activeInventoryProduct) return [];
    const size = byId('modal-size')?.value || '';
    const color = byId('modal-color')?.value || '';
    return availableVariants(activeInventoryProduct).filter(v => String(v.size)===size && String(v.color)===color);
  }
  function updateInventoryModalStatus() {
    if (!activeInventoryProduct) return;
    const note = byId('inventory-modal-stock-note');
    const button = byId('modal-add-cart');
    const v = variantsForSelection()[0];
    if (!v) {
      if (note) {note.textContent='This colour/size combination is not available.';note.classList.add('out');}
      if (button) button.disabled=true;
      return;
    }
    const isAvail = (v.inStock !== false) && (Number(v.stock || 1) > 0);
    if (note) {note.textContent = isAvail ? 'In Stock' : 'Currently out of stock for this colour and size.';note.classList.toggle('out', !isAvail);}
    if (button) {button.disabled = !isAvail;button.textContent = isAvail ? 'Add to Cart 🛒' : 'Out of Stock';}
  }
  function openProduct(id) {
    const p = inventoryProducts.find(x => x.id===id);
    if (!p || typeof window.openProductModal !== 'function') return;
    activeInventoryProduct=p; window.__hssActiveInventoryProduct=p;
    const sizes = [...new Set(availableVariants(p).map(v=>String(v.size)))];
    const colors = [...new Set(availableVariants(p).map(v=>String(v.color)))];
    const defaultVariant = availableVariants(p).find(v=>(v.inStock!==false && Number(v.stock||1)>0)) || availableVariants(p)[0];
    fillSelect(byId('modal-size'), sizes.length?sizes:['Not available'], defaultVariant?.size || 'Not available');
    fillSelect(byId('modal-color'), colors.length?colors:['Not available'], defaultVariant?.color || 'Not available');
    if (byId('inventory-modal-stock-note')) byId('inventory-modal-stock-note').remove();
    const addButton = byId('modal-add-cart');
    if (addButton) {
      addButton.disabled=false;
      const note=document.createElement('p');note.id='inventory-modal-stock-note';note.className='inventory-modal-stock';
      addButton.parentElement.insertBefore(note,addButton);
    }
    function refreshColorGallery(){ const selectedColor=byId('modal-color')?.value||''; const all=(p.images||[]).filter(im=>im&&im.url); const specific=all.filter(im=>String(im.color||'').toLowerCase()===selectedColor.toLowerCase()); const shared=all.filter(im=>!im.color); const gallery=specific.length?specific:shared; const urls=gallery.map(im=>im.url); const main=urls[0]||p.image_url||''; window.openProductModal(p.name, Number(p.price), main, urls.length?urls:(main?[main]:[]), p.description||'', (p.videos||[]).map(v=>v.url)); const note=byId('inventory-color-image-note'); if(note)note.remove(); if(selectedColor && !specific.length){const n=document.createElement('p');n.id='inventory-color-image-note';n.className='inventory-stock-warning';n.textContent='No dedicated images uploaded for '+selectedColor+' yet; showing shared product images only.';byId('modal-color')?.parentElement?.appendChild(n);} }
    refreshColorGallery();
    if (byId('modal-size')) byId('modal-size').onchange = updateInventoryModalStatus;
    if (byId('modal-color')) byId('modal-color').onchange = () => { refreshColorGallery(); updateInventoryModalStatus(); };
    updateInventoryModalStatus();
  }
  const legacyAddToCartCustom = window.addToCartCustom;
  if (typeof legacyAddToCartCustom === 'function') {
    window.addToCartCustom = function(name, price) {
      const p = activeInventoryProduct;
      if (!p || p.name !== name) return legacyAddToCartCustom(name, price);
      const v = variantsForSelection()[0];
      if (!v) { alert('This colour and size combination is not available.'); return; }
      const isAvail = (v.inStock !== false) && (Number(v.stock || 1) > 0);
      if (!isAvail) { alert('This colour and size combination is not available.'); return; }
      const same = window.cart ? window.cart.find(x=>x.variantId===v.id) : null;
      // The original store keeps its cart in a top-level let binding; it is readable here.
      const actualCart = typeof cart !== 'undefined' ? cart : [];
      const found = actualCart.find(x=>x.variantId===v.id);
      const existingQty = found ? found.qty : 0;
      if (existingQty + 1 > 20) { alert('Maximum 20 items per order line.'); return; }
      if (found) { found.qty += 1; found.selected = true; }
      else actualCart.push({name:p.name,price:Number(p.price),size:v.size,color:v.color,qty:1,selected:true,productId:p.id,variantId:v.id,sku:v.sku,image:p.image_url||p.image||'',inventoryManaged:true});
      if (typeof window.renderCart==='function') window.renderCart();
      if (typeof window.openCartDrawer==='function') window.openCartDrawer();
    };
  }
  const legacyCheckoutCart = window.checkoutCart;
  window.checkoutCart = async function() {
    const actualCart = typeof cart !== 'undefined' ? cart : [];
    const chosen = actualCart.filter(x=>x.selected);
    if (!chosen.length) { alert('Please select at least one product in your cart before pressing Buy Now.'); return; }
    const name=(byId('cust-name')?.value||'').trim();const phone=(byId('cust-phone')?.value||'').trim();const address=(byId('cust-address')?.value||'').trim();
    if (!name||!phone||!address) { alert('Please fill in all Delivery Information fields.'); return; }
    if (!/^03\d{9}$/.test(phone)) { alert('Please enter a valid 11-digit Pakistani mobile number starting with 03.'); return; }
    const hasInventory = chosen.some(x=>x.variantId);
    const hasLegacy = chosen.some(x=>!x.variantId);
    if (!hasInventory) { alert('These are preview/demo items. Please choose an available inventory-managed product before placing an order.'); return; }
    if (hasLegacy) { alert('Please checkout inventory-managed products separately from older/demo bundle items.'); return; }
    if (window.__hssOrderInFlight) return; // ignore double-clicks / double-taps
    window.__hssOrderInFlight = true;
    const button=byId('buy-selected-btn');if(button){button.disabled=true;button.textContent='Saving order…';}
    try {
      // Same cart + same details => same key, so a retry/refresh can never create a second order.
      const sig=JSON.stringify([name,phone,address,chosen.map(x=>[x.variantId,x.qty]).sort(),(typeof activePromo!=='undefined'&&activePromo)?activePromo.code:'']);
      const stored=(()=>{try{return JSON.parse(sessionStorage.getItem('hss_order_key')||'null');}catch(_){return null;}})();
      let idempotencyKey;
      if (stored && stored.sig===sig && Date.now()-stored.at<30*60*1000) idempotencyKey=stored.key;
      else { idempotencyKey=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g,''); try{sessionStorage.setItem('hss_order_key',JSON.stringify({sig,key:idempotencyKey,at:Date.now()}));}catch(_){} }
      const body={customerName:name,phone,address,idempotencyKey,items:chosen.map(x=>({variantId:x.variantId,quantity:x.qty})),promoCode:(typeof activePromo!=='undefined'&&activePromo)?activePromo.code:''};
      const response=await fetch('/api/orders',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to save order.');
      const o=data.order;
      actualCart.splice(0,actualCart.length,...actualCart.filter(x=>!chosen.includes(x)));
      if(typeof window.renderCart==='function')window.renderCart();
      try {sessionStorage.removeItem('hss_order_key');} catch (_) {}
      const confirmation=byId('hss-checkout-confirmation');
      if(confirmation){confirmation.hidden=false;confirmation.textContent=`Order ${o.order_number} received. Status: Pending. Your order has been recorded securely. You can track a qualifying exchange after delivery from our Exchange & Refund page.`;confirmation.focus();}
      else alert(`Order ${o.order_number} saved. Status: Pending.`);
    } catch(e) { alert(e.message); }
    finally {window.__hssOrderInFlight=false;if(button){button.textContent='Buy Now — Selected Items';if(typeof cart!=='undefined')button.disabled=!cart.some(x=>x.selected);}}
  };
  function categoryCard(p) {
    const stock = Boolean(p.inStock ?? (Number(p.totalStock) > 0));
    const sizesSummary = getUniqueSizesSummary(p);
    return `<article class="product"><img loading="lazy" src="${esc(p.image_url||'')}" alt="${esc(p.name)}" onerror="this.style.opacity='.25';this.alt='Product image unavailable'"><div class="details"><h2>${esc(p.name)}</h2>${sizesSummary ? `<div class="inventory-card-variants" style="margin:4px 0">${esc(sizesSummary)}</div>` : ''}<div class="price">${money(p.price)}</div><p class="inventory-stock-label ${stock?'':'out'}" style="margin:7px 0">${stock ? 'In Stock' : 'Currently Out of Stock'}</p>${stock?`<a class="btn" href="index.html?product=${encodeURIComponent(p.id)}#collection">Choose Options & Order</a>`:'<span class="btn" style="opacity:.7;display:inline-block">Out of stock</span>'}</div></article>`;
  }
  function renderBundlePlaceholder() {
    // No placeholder, admin link, or unverified bundle pricing on the public storefront.
    const section = byId('bundle-offers');
    if (section) { section.hidden = true; section.style.display = 'none'; }
  }
  function renderConnectionError() {
    renderBundlePlaceholder();
    if (categoryPage) {
      const grid=document.querySelector('main.grid');
      if (grid) { addStoreStyles(); setEmptyGrid(grid,'Store temporarily unavailable','براہِ کرم تھوڑی دیر بعد دوبارہ کوشش کریں یا ایڈمن/ویب سرور کی دستیابی چیک کریں۔'); }
    } else {
      const grid=getMainGrid();
      if (grid) { addStoreStyles(); setEmptyGrid(grid,'Store inventory is temporarily unavailable','سرور سے انوینٹری لوڈ نہیں ہو سکی۔ براہِ کرم سرور چیک کر کے صفحہ دوبارہ کھولیں۔'); }
    }
  }
  function restoreCart() {
    if (cartRestored || typeof cart === 'undefined') return; cartRestored = true;
    let saved = []; try { saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(saved)) return;
    const kept = [];
    saved.forEach(it => {
      const p = inventoryProducts.find(x => x.id === it.productId); if (!p) return;
      const v = (p.variants || []).find(x => x.id === it.variantId && x.active !== false); if (!v || v.inStock === false || Number(v.stock || 1) < 1) return;
      kept.push({name:p.name, price:Number(p.price), size:v.size, color:v.color, qty:Math.min(Math.max(1, Math.round(Number(it.qty) || 1)), 20), selected:!!it.selected, productId:p.id, variantId:v.id, sku:v.sku, image:p.image_url||it.image||'', inventoryManaged:true});
    });
    cart.splice(0, cart.length, ...kept);
    if (typeof window.renderCart === 'function') window.renderCart();
  }
  function installCartPersistence() {
    if (window.__hssCartPersist || typeof window.renderCart !== 'function') return; window.__hssCartPersist = true;
    const legacy = window.renderCart;
    window.renderCart = function () { const r = legacy.apply(this, arguments); try { if (typeof cart !== 'undefined') localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} return r; };
  }
  async function initialize() {
    // File-open preview keeps the legacy HTML; a served site must never silently show sample stock on API errors.
    try {
      const response = await fetch('/api/products', {cache:'no-store'});
      if (!response.ok) { if (location.protocol==='http:' || location.protocol==='https:') renderConnectionError(); return; }
      const data = await response.json(); inventoryProducts = (data.products || []).filter(p=>p.active);
      lastApiAvailable = true;
      if (isProductPage) { addCategoryStyles(); setupCategoryChrome(); updateWishBadges(); return; }
      renderBundlePlaceholder();
      if (categoryPage) renderCategoryProducts(); else renderHomeProducts();
      if (!categoryPage) {
        installCartPersistence(); restoreCart();
        const qs = new URLSearchParams(location.search);
        const id = qs.get('product');
        if (id && inventoryProducts.some(x=>x.id===id)) { location.replace('product.html?id=' + encodeURIComponent(id)); return; }
        if (qs.get('cart') === '1') { if (typeof window.openCartDrawer === 'function') window.openCartDrawer(); try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} }
      }
    } catch (e) { if (location.protocol==='http:' || location.protocol==='https:') renderConnectionError(); /* file:// preview: don't break the existing site */ }
  }
  window.hssUpdateWishBadges = function () { updateWishBadges(); };
  window.InventoryStore = {openProduct, reload:initialize, get products(){return inventoryProducts;}};
  initialize();
})();
