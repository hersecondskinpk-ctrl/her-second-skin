/**
 * Her Second Skin PK — Product Detail Page Controller (js/product.js)
 * Manages gallery, variant pickers, stock validation & checkout
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

  let currentProduct = null;
  let selectedSize = '';
  let selectedColor = '';
  let selectedCup = '';
  let selectedQty = 1;
  let galleryMedia = [];
  let currentMediaIndex = 0;

  document.addEventListener('DOMContentLoaded', async () => {
    const productId = HSSRouter.getParam('id');
    if (!productId) {
      showError('Product ID not found in URL.');
      return;
    }

    await loadProduct(productId);
  });

  async function loadProduct(id) {
    try {
      const res = await fetch('/api/products', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load products catalogue');
      const data = await res.json();
      const product = (data.products || []).find(p => String(p.id) === String(id));

      if (!product) {
        showError('Product not found or currently unavailable.');
        return;
      }

      currentProduct = product;
      renderProductDetails(product);

      // Record into recently viewed state
      HSSState.recent.add({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image_url || ''
      });
    } catch (e) {
      showError(e.message);
    }
  }

  function showError(msg) {
    const root = $('pdp-root');
    if (root) {
      root.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
          <h2>Product Not Found</h2>
          <p style="color:#777;margin:12px 0 24px;">${esc(msg)}</p>
          <a href="/" style="background:#72283f;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700;">Back to Store</a>
        </div>
      `;
    }
  }

  function renderProductDetails(p) {
    // Breadcrumbs & Title
    if ($('pdp-crumb-title')) $('pdp-crumb-title').textContent = p.name;
    if ($('pdp-title')) $('pdp-title').textContent = p.name;
    if ($('pdp-category-name')) $('pdp-category-name').textContent = p.category;
    if ($('pdp-price')) $('pdp-price').textContent = money(p.price);
    if ($('pdp-desc')) $('pdp-desc').textContent = p.description || '';

    // Gallery
    galleryMedia = [];
    if (p.image_url) galleryMedia.push({ type: 'img', url: p.image_url });
    (p.images || []).forEach(im => {
      if (im && im.url && im.url !== p.image_url) galleryMedia.push({ type: 'img', url: im.url, color: im.color });
    });
    (p.videos || []).forEach(vid => {
      if (vid && vid.url) galleryMedia.push({ type: 'video', url: vid.url });
    });

    renderGallery();
    renderVariants(p);
  }

  function renderGallery() {
    const mainBox = $('pdp-main-box');
    const thumbsBox = $('pdp-thumbs-box');
    if (!mainBox || !galleryMedia.length) return;

    const cur = galleryMedia[currentMediaIndex] || galleryMedia[0];
    if (cur.type === 'video') {
      mainBox.innerHTML = `<video src="${esc(cur.url)}" controls playsinline autoplay muted></video>`;
    } else {
      mainBox.innerHTML = `<img src="${esc(cur.url)}" alt="Product Photo" onerror="this.src='/brand-logo.jpg'">`;
    }

    if (thumbsBox && galleryMedia.length > 1) {
      thumbsBox.innerHTML = galleryMedia.map((m, idx) => `
        <button type="button" class="pdp-thumb ${idx === currentMediaIndex ? 'on' : ''}" onclick="HSSProduct.setMedia(${idx})">
          ${m.type === 'video' ? `<video src="${esc(m.url)}#t=0.5" muted></video>` : `<img src="${esc(m.url)}" alt="">`}
        </button>
      `).join('');
    }
  }

  function renderVariants(p) {
    const activeVars = (p.variants || []).filter(v => v.active !== false);
    const sizes = [...new Set(activeVars.map(v => v.size).filter(Boolean))];
    const colors = [...new Set(activeVars.map(v => v.color).filter(Boolean))];
    const cups = [...new Set(activeVars.map(v => v.cupSize).filter(Boolean))];

    if (sizes.length && !selectedSize) selectedSize = sizes[0];
    if (colors.length && !selectedColor) selectedColor = colors[0];
    if (cups.length && !selectedCup) selectedCup = cups[0];

    // Sizes
    const sizesWrap = $('pdp-sizes-list');
    if (sizesWrap) {
      sizesWrap.innerHTML = sizes.map(s => `
        <button type="button" class="pdp-pill ${s === selectedSize ? 'on' : ''}" onclick="HSSProduct.setSize('${esc(s)}')">
          ${esc(s)}
        </button>
      `).join('');
    }

    // Colors
    const colorsWrap = $('pdp-colors-list');
    if (colorsWrap) {
      colorsWrap.innerHTML = colors.map(c => `
        <button type="button" class="pdp-pill ${c === selectedColor ? 'on' : ''}" onclick="HSSProduct.setColor('${esc(c)}')">
          ${esc(c)}
        </button>
      `).join('');
    }

    // Cups
    const cupsBox = $('pdp-cups-wrap');
    const cupsList = $('pdp-cups-list');
    if (cups.length && cupsList) {
      if (cupsBox) cupsBox.style.display = '';
      cupsList.innerHTML = cups.map(c => `
        <button type="button" class="pdp-pill ${c === selectedCup ? 'on' : ''}" onclick="HSSProduct.setCup('${esc(c)}')">
          ${esc(c)}
        </button>
      `).join('');
    } else if (cupsBox) {
      cupsBox.style.display = 'none';
    }

    updateStockDisplay(activeVars);
  }

  function updateStockDisplay(activeVars) {
    const matched = activeVars.find(v => 
      (!selectedSize || v.size === selectedSize) &&
      (!selectedColor || v.color === selectedColor) &&
      (!selectedCup || v.cupSize === selectedCup)
    );

    const stockEl = $('pdp-stock-badge');
    const addBtn = $('pdp-btn-add');
    const buyBtn = $('pdp-btn-buy');

    if (!matched || matched.stock <= 0) {
      if (stockEl) {
        stockEl.className = 'pdp-stock out';
        stockEl.textContent = 'Sold out in this option';
      }
      if (addBtn) addBtn.disabled = true;
      if (buyBtn) buyBtn.disabled = true;
    } else {
      const mask = HSSState.stock.mask(matched.stock);
      if (stockEl) {
        stockEl.className = 'pdp-stock ' + mask.badgeClass;
        stockEl.textContent = mask.label;
      }
      if (addBtn) addBtn.disabled = false;
      if (buyBtn) buyBtn.disabled = false;
    }
  }

  window.HSSProduct = {
    setMedia(idx) {
      currentMediaIndex = idx;
      renderGallery();
    },
    setSize(s) {
      selectedSize = s;
      if (currentProduct) renderVariants(currentProduct);
    },
    setColor(c) {
      selectedColor = c;
      if (currentProduct) renderVariants(currentProduct);
    },
    setCup(cup) {
      selectedCup = cup;
      if (currentProduct) renderVariants(currentProduct);
    },
    addToCart() {
      if (!currentProduct) return;
      HSSState.cart.add({
        id: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        size: selectedSize,
        color: selectedColor,
        cupSize: selectedCup,
        qty: selectedQty,
        image: currentProduct.image_url
      });
    },
    buyNow() {
      if (!currentProduct) return;
      const order = {
        customerName: 'Direct Shopper',
        phone: '',
        address: '',
        items: [{
          id: currentProduct.id,
          name: currentProduct.name,
          price: currentProduct.price,
          size: selectedSize,
          color: selectedColor,
          cupSize: selectedCup,
          qty: selectedQty
        }],
        subtotal: currentProduct.price * selectedQty,
        deliveryFee: 250
      };
      HSSState.whatsapp.openCheckout(order);
    }
  };
})();
