/**
 * Her Second Skin PK — Homepage Controller (js/home.js)
 * Manages banner, reels, best sellers, category filtering, modals & cart rendering
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

  let activeReels = [];
  let currentReelIndex = 0;

  // ----------------------------------------------------
  // 1. INITIALIZATION & DATA LOADING
  // ----------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initBanner();
    initCategoryImages();
    initReels();
    initCartListener();
    initRecentlyViewed();
    checkCartUrlParam();
  });

  // Check if URL has ?cart=1 to open cart drawer immediately
  function checkCartUrlParam() {
    if (HSSRouter.getParam('cart') === '1') {
      setTimeout(() => HSSState.ui.toggleDrawer('cart-drawer', true), 300);
    }
  }

  // ----------------------------------------------------
  // 2. HOMEPAGE BANNER & TAGLINE
  // ----------------------------------------------------
  async function initBanner() {
    try {
      const res = await fetch('/api/homepage', { cache: 'no-store' });
      if (!res.ok) return;
      const { homepage } = await res.json();
      if (!homepage) return;

      const bannerImg = $('hero-banner-img');
      const bannerMobile = $('hero-banner-mobile');
      const bannerLink = $('hero-banner-link');
      const taglineEl = $('brand-tagline-text');

      if (homepage.tagline && taglineEl) {
        taglineEl.textContent = homepage.tagline;
      }

      const desktopUrl = homepage.bannerUrl || 'current_banner.png';
      const mobileUrl = homepage.bannerMobileUrl || desktopUrl;

      if (bannerImg) bannerImg.src = desktopUrl;
      if (bannerMobile) bannerMobile.srcset = mobileUrl;
      if (bannerLink && homepage.bannerLink) bannerLink.href = homepage.bannerLink;
    } catch (e) {
      console.warn('Banner load failed', e);
    }
  }

  // ----------------------------------------------------
  // 3. CATEGORY IMAGES (Admin configurable)
  // ----------------------------------------------------
  async function initCategoryImages() {
    try {
      const res = await fetch('/api/category-images', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const images = data.images || {};

      document.querySelectorAll('[data-category-photo]').forEach(img => {
        const cat = img.dataset.categoryPhoto;
        if (images[cat] && typeof images[cat] === 'string') {
          img.src = images[cat];
        }
      });
    } catch (e) {
      console.warn('Category images load failed', e);
    }
  }

  // ----------------------------------------------------
  // 4. BOUTIQUE VIDEO REELS
  // ----------------------------------------------------
  async function initReels() {
    const section = $('video-reels');
    const container = $('managed-reels');
    if (!section || !container) return;

    try {
      const res = await fetch('/api/homepage', { cache: 'no-store' });
      if (!res.ok) return;
      const { homepage } = await res.json();
      activeReels = (homepage?.reels || []).filter(r => r && r.url);

      if (!activeReels.length) {
        section.hidden = true;
        return;
      }

      section.hidden = false;
      container.innerHTML = activeReels.map((r, i) => `
        <div class="reel-card" onclick="HSSHome.openReel(${i})" role="button" tabindex="0" aria-label="${esc(r.caption || 'Reel')}">
          <video src="${esc(r.url)}#t=0.5" muted playsinline preload="none" loop></video>
          <div class="reel-caption">${esc(r.caption || 'Watch Reel')}</div>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Reels load failed', e);
      section.hidden = true;
    }
  }

  // ----------------------------------------------------
  // 5. CART DRAWER RENDERING (Reactive State)
  // ----------------------------------------------------
  function initCartListener() {
    window.addEventListener('hss:cart-updated', e => {
      renderCartDrawer(e.detail);
    });
    // Initial render
    renderCartDrawer({
      items: HSSState.cart.get(),
      count: HSSState.cart.count(),
      total: HSSState.cart.total()
    });
  }

  function renderCartDrawer({ items, count, total }) {
    const listEl = $('cart-product-list');
    const subtotalEl = $('cart-subtotal-val');
    const totalEl = $('cart-total-val');
    const emptyNotice = $('cart-empty-notice');
    const checkoutBtn = $('cart-checkout-btn');

    if (subtotalEl) subtotalEl.textContent = money(total);
    if (totalEl) {
      const delivery = count > 0 ? 250 : 0;
      totalEl.textContent = money(total + delivery);
    }

    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:36px 14px;color:#888;">Aapka cart khali hai. 🛍️</div>';
      if (emptyNotice) emptyNotice.style.display = 'block';
      if (checkoutBtn) checkoutBtn.disabled = true;
      return;
    }

    if (emptyNotice) emptyNotice.style.display = 'none';
    if (checkoutBtn) checkoutBtn.disabled = false;

    listEl.innerHTML = items.map((item, idx) => `
      <div class="item-row">
        <div class="item-row-top">
          <label class="cart-select-line">
            <input type="checkbox" ${item.selected !== false ? 'checked' : ''} onchange="HSSState.cart.setSelected(${idx}, this.checked)">
            <span>Order item</span>
          </label>
          <button type="button" class="cart-item-remove-btn" onclick="HSSState.cart.remove(${idx})">Remove</button>
        </div>
        <div class="item-row-content">
          <div class="item-thumb-col">
            <img class="item-thumb-img" src="${esc(item.image)}" alt="${esc(item.name)}" onerror="this.src='/brand-logo.jpg'">
          </div>
          <div class="item-info-col">
            <div class="item-title-price">
              <h4 class="item-title">${esc(item.name)}</h4>
              <span class="item-price">${money(item.price)}</span>
            </div>
            ${(item.color || item.size || item.cupSize) ? `
              <div class="item-variant-line">
                ${item.color ? `<span class="item-variant-tag">${esc(item.color)}</span>` : ''}
                ${item.size ? `<span class="item-variant-tag">${esc(item.size)}</span>` : ''}
                ${item.cupSize ? `<span class="item-variant-tag">Cup ${esc(item.cupSize)}</span>` : ''}
              </div>
            ` : ''}
            <div class="item-bottom-controls">
              <div class="qty-controls">
                <button type="button" onclick="HSSState.cart.updateQty(${idx}, -1)" aria-label="Decrease quantity">−</button>
                <span class="qty-display">${item.qty || item.quantity || 1}</span>
                <button type="button" onclick="HSSState.cart.updateQty(${idx}, 1)" aria-label="Increase quantity">+</button>
              </div>
              <span class="item-unit-price">${money((item.qty || 1) * item.price)}</span>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ----------------------------------------------------
  // 6. WHATSAPP CHECKOUT FROM HOMEPAGE CART
  // ----------------------------------------------------
  function handleCheckout() {
    const name = ($('cust-name')?.value || '').trim();
    const phone = ($('cust-phone')?.value || '').trim();
    const address = ($('cust-address')?.value || '').trim();

    if (!name || !phone || !address) {
      alert('Meharbani farma kar apna Naam, Phone number aur Delivery Address darj karein.');
      return;
    }

    const items = HSSState.cart.get().filter(i => i.selected !== false);
    if (!items.length) {
      alert('Order karne ke liye cart mein kam az kam ek item select karein.');
      return;
    }

    const subtotal = HSSState.cart.total(true);
    HSSState.whatsapp.openCheckout({
      customerName: name,
      phone,
      address,
      items,
      subtotal,
      deliveryFee: 250
    });
  }

  // ----------------------------------------------------
  // 7. RECENTLY VIEWED PRODUCTS
  // ----------------------------------------------------
  function initRecentlyViewed() {
    const list = HSSState.recent.get();
    const sec = $('recently-viewed-section');
    const target = $('recently-viewed-list');
    if (!sec || !target || !list.length) return;

    sec.style.display = 'block';
    target.innerHTML = list.map(p => `
      <div class="card" onclick="location.href='/product?id=${encodeURIComponent(p.id)}'">
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
        <h3>${esc(p.name)}</h3>
        <div class="price">${money(p.price)}</div>
      </div>
    `).join('');
  }

  // Expose global controller for inline listeners
  window.HSSHome = {
    toggleMenu(force) {
      HSSState.ui.toggleDrawer('site-side-menu', force);
    },
    toggleCart(force) {
      HSSState.ui.toggleDrawer('cart-drawer', force);
    },
    toggleWishlist(force) {
      HSSState.ui.toggleDrawer('wishlist-drawer', force);
    },
    closeAll() {
      HSSState.ui.closeAll();
    },
    filterCategory(category, btn) {
      document.querySelectorAll('.header-cat-nav button').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');

      const cards = document.querySelectorAll('#product-grid .card');
      cards.forEach(card => {
        if (category === 'all' || card.dataset.category === category) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    },
    openProductModal(name, price, mainImg, images, desc, videos) {
      const modal = $('product-modal');
      if (!modal) return;
      $('modal-title').textContent = name;
      $('modal-price').textContent = money(price);
      $('modal-desc').textContent = desc || '';
      $('modal-main-img').src = mainImg;

      const thumbs = $('modal-thumbs');
      if (thumbs) {
        thumbs.innerHTML = (images || []).map(img => `
          <img src="${esc(img)}" onclick="$('modal-main-img').src='${esc(img)}'" alt="">
        `).join('');
      }

      $('modal-add-cart').onclick = () => {
        HSSState.cart.add({ name, price, image: mainImg, qty: 1 });
        HSSHome.closeProductModal();
      };

      modal.classList.add('is-open');
    },
    closeProductModal() {
      const modal = $('product-modal');
      if (modal) modal.classList.remove('is-open');
    },
    openReel(index) {
      const reel = activeReels[index];
      if (!reel) return;
      currentReelIndex = index;
      const viewer = $('boutique-reel-viewer');
      const player = $('boutique-reel-player');
      const title = $('boutique-reel-title');
      const deal = $('boutique-reel-deal');

      if (title) title.textContent = reel.caption || 'Watch Reel';
      if (deal) deal.textContent = reel.deal || '';
      if (player) {
        player.src = reel.url;
        player.play().catch(() => {});
      }
      if (viewer) viewer.classList.add('is-open');
    },
    closeReel() {
      const viewer = $('boutique-reel-viewer');
      const player = $('boutique-reel-player');
      if (player) {
        player.pause();
        player.src = '';
      }
      if (viewer) viewer.classList.remove('is-open');
    },
    openSizeAssistant() {
      const modal = $('size-assistant-modal');
      if (modal) modal.classList.add('is-open');
    },
    closeSizeAssistant() {
      const modal = $('size-assistant-modal');
      if (modal) modal.classList.remove('is-open');
    },
    showSizeTab(tabName, btn) {
      document.querySelectorAll('.size-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.size-tab-content').forEach(c => c.style.display = 'none');
      if (btn) btn.classList.add('active');
      const target = $('size-tab-' + tabName);
      if (target) target.style.display = 'block';
    },
    handleCheckout
  };

  // Backwards compatibility for existing inline HTML onclicks and inventory-store.js
  window.cart = HSSState.cart.get();
  window.renderCart = () => renderCartDrawer({ items: HSSState.cart.get(), count: HSSState.cart.count(), total: HSSState.cart.total() });
  window.toggleMenu = window.HSSHome.toggleMenu;
  window.toggleCart = window.HSSHome.toggleCart;
  window.openCartDrawer = () => window.HSSHome.toggleCart(true);
  window.openProductModal = window.HSSHome.openProductModal;
  window.closeProductModal = window.HSSHome.closeProductModal;
  window.closeBoutiqueReel = window.HSSHome.closeReel;
  window.openSizeAssistant = window.HSSHome.openSizeAssistant;
  window.closeSizeAssistant = window.HSSHome.closeSizeAssistant;
  window.showSizeTab = window.HSSHome.showSizeTab;
  window.addToCart = (name, price, img) => HSSState.cart.add({ name, price, image: img, qty: 1 });
  window.addToCartCustom = (name, price) => HSSState.cart.add({ name, price, qty: 1 });
  window.checkoutWhatsApp = window.HSSHome.handleCheckout;
  window.checkoutCart = window.HSSHome.handleCheckout;
  window.filterProducts = () => {};
})();
