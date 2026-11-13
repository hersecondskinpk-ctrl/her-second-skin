/**
 * Her Second Skin PK — Admin Dashboard Controller (js/admin.js)
 * Products, Inventory Adjustments, Orders, Sales Reports & Settings
 */
'use strict';

const $ = id => document.getElementById(id);
let editingGallery = [];
let editingVideos = [];
const formatPKR = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');
let products = [], orders = [], sales = [], movements = [], currentTab = 'overview', editingVariants = [];
const CATS = { bras: 'Bras', panties: 'Panties', sets: 'Bra & Panty Sets', accessories: 'Accessories', 'body-shaper': 'Body Shaper', camisole: 'Camisole' };
const STATUS = { pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setMessage(id, msg, ok = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
}

document.addEventListener('DOMContentLoaded', () => {
  $('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value })
      });
      await enterApp();
    } catch (err) {
      $('login-error').textContent = err.message;
    } finally {
      $('login-btn').disabled = false;
    }
  });

  document.getElementById('admin-menu-toggle')?.addEventListener('click', () => {
    setAdminMenu(!document.getElementById('app-screen').classList.contains('nav-open'));
  });
  document.getElementById('admin-drawer-backdrop')?.addEventListener('click', () => setAdminMenu(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setAdminMenu(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 780) setAdminMenu(false); });

  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  api('/api/auth/me').then(()=>enterApp()).catch(()=>{});
});

async function enterApp() {
  try {
    const me = await api('/api/auth/me');
    if ($('user-chip')) $('user-chip').textContent = me.username.toUpperCase();
    $('login-screen').classList.add('hidden');
    $('app-screen').classList.remove('hidden');
    await refreshAll();
  } catch (e) {
    $('app-screen').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
  }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  $('app-screen').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
  if ($('login-pass')) $('login-pass').value = '';
}

function setAdminMenu(open) {
  const app = document.getElementById('app-screen');
  const button = document.getElementById('admin-menu-toggle');
  if (app) app.classList.toggle('nav-open', !!open);
  button?.setAttribute('aria-expanded', String(!!open));
  document.body.style.overflow = open ? 'hidden' : '';
}

function showTab(tab) {
  setAdminMenu(false);
  currentTab = tab;
  document.querySelectorAll('.tab-page').forEach(el => el.classList.toggle('hidden', el.id !== 'tab-' + tab));
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  if (tab === 'overview') loadDashboard();
  if (tab === 'products') loadProducts();
  if (tab === 'homepage') loadHomepage();
  if (tab === 'category-images') loadCategoryImages();
  if (tab === 'orders') loadOrders();
  if (tab === 'promos') loadPromos();
  if (tab === 'sales') loadSales();
  if (tab === 'movements') loadMovements();
  if (tab === 'reviews') loadReviews();
  if (tab === 'exchanges') loadExchanges();
}

async function refreshAll() {
  await Promise.allSettled([loadDashboard(), loadProducts(), loadOrders(), loadSales(), loadMovements()]);
}

// ----------------------------------------------------
// DASHBOARD & ANALYTICS
// ----------------------------------------------------
async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');
    const c = d.counts;
    $('dashboard-stats').innerHTML = [
      ['Active products', c.activeProducts, 'products listed'],
      ['Units in stock', c.unitsInStock, 'across active variants'],
      ['Open orders', c.openOrders, 'not delivered/cancelled'],
      ['Sales this month', formatPKR(c.monthSales), `${c.monthDeliveredOrders} delivered order(s)`],
      ['Est. profit', formatPKR(c.monthEstimatedProfit), 'before other expenses'],
      ['Low stock', c.lowStockVariants, 'variants with 1–3 units'],
      ['Out of stock', c.outOfStockVariants, 'active variants at zero'],
      ['Collected', formatPKR(c.monthCollected), 'including delivery fees']
    ].map(x => `<div class="stat"><div class="stat-label">${esc(x[0])}</div><div class="stat-value">${typeof x[1] === 'number' && x[1] > 999 ? Number(x[1]).toLocaleString() : esc(x[1])}</div><div class="stat-note">${esc(x[2])}</div></div>`).join('');

    $('recent-orders').innerHTML = d.recentOrders.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>${d.recentOrders.map(o => `<tr><td><strong>${esc(o.order_number)}</strong><small>${new Date(o.created_at).toLocaleDateString()}</small></td><td>${esc(o.customer_name)}</td><td>${formatPKR(o.total)}</td><td><span class="pill ${o.status}">${STATUS[o.status] || esc(o.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ابھی کوئی آرڈر موجود نہیں۔</div>';

    $('low-stock-list').innerHTML = d.lowStock.length ? d.lowStock.map(v => `<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #f2e8eb;padding:10px 0;font-size:12px"><span><b>${esc(v.productName)}</b><small style="display:block;color:var(--muted);margin-top:4px">${esc(v.color)} · ${esc(v.size)} · ${esc(v.sku)}</small></span><b class="${v.stock === 0 ? 'metric-bad' : 'metric-warn'}">${v.stock} left</b></div>`).join('') : '<div class="empty">فی الحال کوئی کم اسٹاک والا variant نہیں۔</div>';
  } catch (e) {
    toastError(e);
  }
}

// ----------------------------------------------------
// PRODUCTS & INVENTORY
// ----------------------------------------------------
async function loadProducts() {
  try {
    const d = await api('/api/products?admin=1');
    products = d.products;
    renderProductsTable();
    populateVariantSelect();
  } catch (e) {
    toastError(e);
  }
}

function renderProductsTable() {
  const q = ($('product-search')?.value || '').toLowerCase();
  const f = $('product-filter')?.value || 'all';
  let items = products.filter(p => {
    if (f === 'inactive' && p.active) return false;
    if (f !== 'all' && f !== 'inactive' && p.category !== f) return false;
    const hay = [p.name, p.description, p.category, ...p.variants.map(v => `${v.sku} ${v.color} ${v.size}`)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!items.length) {
    $('products-table').innerHTML = '<div class="empty">کوئی پروڈکٹ نہیں ملی۔ Add Product سے پہلی انوینٹری شامل کریں۔</div>';
    return;
  }
  $('products-table').innerHTML = `<table><thead><tr><th>Product</th><th>Category</th><th>Price / Cost</th><th>Variants</th><th>Total stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>${items.map(p => `<tr><td><div class="product-cell">${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : '<div class="no-img">HSS</div>'}<div><strong>${esc(p.name)}</strong><small>${p.variants.filter(v => v.active).length} active variant(s)</small></div></div></td><td>${esc(CATS[p.category] || p.category)}</td><td><strong>${formatPKR(p.price)}</strong><small>Cost ${formatPKR(p.costPrice)}</small></td><td>${p.variants.filter(v => v.active).length}</td><td><strong>${p.variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0)}</strong></td><td><span class="pill ${p.active ? 'delivered' : 'cancelled'}">${p.active ? 'Active' : 'Archived'}</span></td><td><div class="tools"><button class="btn light small" onclick="editProduct('${p.id}')">Edit</button>${p.active ? `<button class="btn danger small" onclick="archiveProduct('${p.id}')">Archive</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`;
}

function populateVariantSelect() {
  const options = products.filter(p => p.active).flatMap(p => p.variants.filter(v => v.active).map(v => ({ id: v.id, label: `${p.name} · ${v.color} · ${v.size} · ${v.stock} left`, stock: v.stock })));
  if ($('adjust-variant')) {
    $('adjust-variant').innerHTML = options.length ? options.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join('') : '<option value="">No variants</option>';
  }
}

const HSS_SIZES = ['22', '31', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '58', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const HSS_CUPS = ['', 'A', 'B', 'C', 'D', 'FF'];

function variantOptions(list, val) {
  return list.map(x => `<option value="${esc(x)}" ${String(x) === String(val) ? 'selected' : ''}>${esc(x || 'None')}</option>`).join('');
}

function addVariantRow(v = {}) {
  const div = document.createElement('div');
  div.className = 'variant-row';
  const size = String(v.size || '');
  const cup = String(v.cupSize || v.cup_size || '');
  div.innerHTML = `<input aria-label="Colour" placeholder="Black" class="v-color" required value="${esc(v.color || '')}"><select aria-label="Size" class="v-size" required><option value="">Select Size</option>${variantOptions([...new Set([...HSS_SIZES, ...(size ? [size] : [])])], size)}</select><select aria-label="Cup Size" class="v-cup">${variantOptions([...new Set([...HSS_CUPS, ...(cup ? [cup] : [])])], cup)}</select><input aria-label="SKU" placeholder="Auto SKU" class="v-sku" value="${esc(v.sku || '')}"><input aria-label="Stock" type="number" min="0" step="1" class="v-stock" required value="${Number(v.stock) || 0}"><button type="button" class="xbtn" title="Remove variant" onclick="this.closest('.variant-row').remove()">×</button><input type="hidden" class="v-id" value="${esc(v.id || '')}">`;
  $('variant-rows')?.appendChild(div);
}

function openProductModal(p = null) {
  $('product-form')?.reset();
  $('product-id').value = '';
  $('variant-rows').innerHTML = '';
  $('p-cost').value = 0;
  $('p-compare').value = 0;
  $('p-image-url').value = '';
  editingGallery = [];
  editingVideos = [];
  renderVideoPreview();
  $('product-error').textContent = '';
  $('product-modal-heading').textContent = p ? 'Edit Product' : 'Add Product';

  if (p) {
    $('product-id').value = p.id;
    $('p-name').value = p.name;
    $('p-category').value = p.category;
    $('p-price').value = p.price;
    $('p-cost').value = p.costPrice;
    $('p-compare').value = p.comparePrice || 0;
    $('p-description').value = p.description;
    $('p-image-url').value = p.image_url || '';
    editingGallery = (p.images || []).filter(im => !String(im.id).startsWith('legacy-')).map(im => ({ url: im.url, color: im.color || '', isPrimary: im.isPrimary }));
    editingVideos = (p.videos || []).map(v => ({ url: v.url }));
    renderVideoPreview();
    p.variants.filter(v => v.active).forEach(v => addVariantRow(v));
  }
  if (!$('variant-rows').children.length) addVariantRow({ color: 'Black', size: '36', stock: 0 });
  renderGalleryPreview();
  $('product-modal')?.classList.remove('hidden');
}

function closeModal(id) {
  $(id)?.classList.add('hidden');
}

function editProduct(id) {
  const p = products.find(p => p.id === id);
  if (p) openProductModal(p);
}

async function archiveProduct(id) {
  if (!confirm('Archive this product? It will stop appearing in the store but its order/sales history will remain.')) return;
  try {
    await api('/api/products/' + id, { method: 'DELETE' });
    await loadProducts();
    await loadDashboard();
  } catch (e) {
    alert(e.message);
  }
}

// ----------------------------------------------------
// ORDERS MANAGEMENT
// ----------------------------------------------------
async function loadOrders() {
  try {
    const d = await api('/api/orders');
    orders = d.orders;
    renderOrdersTable();
  } catch (e) {
    toastError(e);
  }
}

function renderOrdersTable() {
  let list = orders.slice();
  const q = ($('order-search')?.value || '').toLowerCase();
  const status = $('order-filter')?.value || 'all';
  if (status !== 'all') list = list.filter(o => o.status === status);
  if (q) list = list.filter(o => [o.order_number, o.customer_name, o.phone, o.address].join(' ').toLowerCase().includes(q));

  if (!list.length) {
    $('orders-table').innerHTML = '<div class="empty">اس فلٹر میں کوئی آرڈر موجود نہیں۔ آرڈر آنے پر یہاں دکھائی دے گا۔</div>';
    return;
  }
  $('orders-table').innerHTML = `<table><thead><tr><th>Order / Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Change status</th></tr></thead><tbody>${list.map(o => `<tr><td><strong>${esc(o.order_number)}</strong><small>${new Date(o.created_at).toLocaleString()}</small></td><td><strong>${esc(o.customer_name)}</strong><small>${esc(o.phone)}</small></td><td>${o.items.reduce((s, i) => s + i.quantity, 0)} unit(s)<small>${esc(o.source)}</small></td><td><strong>${formatPKR(o.total)}</strong><small>Items: ${formatPKR(o.subtotal)}</small></td><td><span class="pill ${o.status}">${STATUS[o.status] || o.status}</span></td><td><div class="tools"><select class="control" style="width:130px;padding:7px" id="status-${o.id}" ${['delivered', 'cancelled'].includes(o.status) ? 'disabled' : ''}>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn small" onclick="saveOrderStatus('${o.id}')" ${['delivered', 'cancelled'].includes(o.status) ? 'disabled' : ''}>Save</button></div></td></tr>`).join('')}</tbody></table>`;
}

async function saveOrderStatus(id) {
  const status = $('status-' + id).value;
  if (status === 'cancelled' && !confirm('Cancel this order? Reserved stock will be added back.')) return;
  if (status === 'delivered' && !confirm('Mark as Delivered? This creates a Sales Record.')) return;
  try {
    await api('/api/orders/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status, note: '' }) });
    await Promise.all([loadOrders(), loadProducts(), loadDashboard(), loadSales(), loadMovements()]);
  } catch (e) {
    alert(e.message);
  }
}

// ----------------------------------------------------
// EXCHANGES MANAGEMENT
// ----------------------------------------------------
let exchangeRows = [], exchangeStatuses = {}, exchangeTransitions = {};
async function loadExchanges() {
  try {
    const d = await api('/api/exchanges');
    exchangeRows = d.exchanges || [];
    exchangeStatuses = d.statuses || {};
    exchangeTransitions = d.transitions || {};
    renderExchangeTable();
  } catch (e) {
    if ($('exchange-table')) $('exchange-table').textContent = e.message;
  }
}

function renderExchangeTable() {
  const filter = $('exchange-filter')?.value || 'all';
  const rows = exchangeRows.filter(x => filter === 'all' || x.status === filter);
  if ($('exchange-table')) {
    $('exchange-table').innerHTML = rows.length ? `<table><thead><tr><th>Exchange / Date</th><th>Order / Customer</th><th>Product / Reason</th><th>Status</th></tr></thead><tbody>${rows.map(x => `<tr><td><strong>${esc(x.number)}</strong><small>${new Date(x.createdAt).toLocaleString()}</small></td><td>${esc(x.orderNumber)}<small>${esc(x.customerName)} · ${esc(x.phone)}</small></td><td>${esc(x.product)}<small>${esc(x.reason)}</small></td><td><span class="pill">${esc(x.statusLabel)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No exchange requests in this category.</div>';
  }
}

// ----------------------------------------------------
// SALES & MOVEMENTS
// ----------------------------------------------------
async function loadSales() {
  try {
    const q = new URLSearchParams();
    if ($('sales-from')?.value) q.set('from', $('sales-from').value);
    if ($('sales-to')?.value) q.set('to', $('sales-to').value);
    const d = await api('/api/sales?' + q);
    sales = d.sales;
    if ($('sales-stats')) {
      $('sales-stats').innerHTML = [
        ['Delivered orders', d.totals.orders],
        ['Merchandise sales', formatPKR(d.totals.merchandiseNet)],
        ['Delivery collected', formatPKR(d.totals.delivery)],
        ['Total collected', formatPKR(d.totals.collected)],
        ['Estimated profit', formatPKR(d.totals.profit)]
      ].map(x => `<div class="stat"><div class="stat-label">${esc(x[0])}</div><div class="stat-value">${esc(x[1])}</div></div>`).join('');
    }
  } catch (e) {
    toastError(e);
  }
}

async function loadMovements() {
  try {
    const d = await api('/api/stock/movements');
    movements = d.movements;
    if ($('movements-table')) {
      $('movements-table').innerHTML = movements.length ? `<table><thead><tr><th>Date/time</th><th>Product</th><th>SKU / Variant</th><th>Change</th><th>Reason</th></tr></thead><tbody>${movements.map(m => `<tr><td>${new Date(m.created_at).toLocaleString()}</td><td><strong>${esc(m.product_name || 'Archived')}</strong></td><td>${esc(m.sku || '—')}</td><td class="${m.change_qty >= 0 ? 'metric-good' : 'metric-bad'}"><b>${m.change_qty > 0 ? '+' : ''}${m.change_qty}</b></td><td>${esc(m.reason.replaceAll('_', ' '))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">اسٹاک کی کوئی تبدیلی ابھی محفوظ نہیں۔</div>';
    }
  } catch (e) {
    toastError(e);
  }
}

function toastError(e) {
  console.error(e);
  if (e.message.toLowerCase().includes('sign in') || e.message.toLowerCase().includes('signed')) {
    logout();
    return;
  }
  alert(e.message);
}

function renderGalleryPreview() {}
function renderVideoPreview() {}
