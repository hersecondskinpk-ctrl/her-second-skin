/**
 * Her Second Skin PK — Central State Management & Event Bus
 * Single Source of Truth for Cart, Stock Masking, Recent Views & Checkout
 */
(() => {
  'use strict';

  const CART_KEY = 'hssp_cart';
  const RECENT_KEY = 'hssp_recent_ids';
  const WA_NUMBER = '923397055500';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

  const _storage = typeof localStorage !== 'undefined' ? localStorage : {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  function safeGet(key, def) {
    try {
      const v = JSON.parse(_storage.getItem(key));
      return v == null ? def : v;
    } catch {
      return def;
    }
  }

  function safeSet(key, val) {
    try {
      _storage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('Storage quota exceeded', e);
    }
  }

  // Toast UI notification element
  function getToastContainer() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('hss-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hss-toast-container';
      el.className = 'hss-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  const HSSState = {
    // ----------------------------------------------------
    // CART STATE
    // ----------------------------------------------------
    cart: {
      get() {
        return safeGet(CART_KEY, []);
      },

      count() {
        return this.get().reduce((sum, item) => sum + (Number(item.qty || item.quantity) || 1), 0);
      },

      total(selectedOnly = false) {
        return this.get()
          .filter(item => !selectedOnly || item.selected !== false)
          .reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty || item.quantity) || 1), 0);
      },

      add(product) {
        if (!product || !product.name) return;
        const items = this.get();
        const pId = String(product.id || product.name);
        const pSize = String(product.size || '');
        const pColor = String(product.color || '');
        const pCup = String(product.cupSize || '');

        const existing = items.find(i => 
          String(i.id || i.name) === pId &&
          String(i.size || '') === pSize &&
          String(i.color || '') === pColor &&
          String(i.cupSize || '') === pCup
        );

        const addQty = Number(product.qty || product.quantity || 1);

        if (existing) {
          existing.qty = (Number(existing.qty || existing.quantity) || 1) + addQty;
          if (product.maxStock && existing.qty > product.maxStock) {
            existing.qty = product.maxStock;
          }
        } else {
          items.push({
            id: pId,
            name: product.name,
            price: Number(product.price) || 0,
            size: pSize,
            color: pColor,
            cupSize: pCup,
            qty: addQty,
            image: product.image || product.image_url || '/brand-logo.jpg',
            maxStock: product.maxStock || 99,
            selected: true
          });
        }

        safeSet(CART_KEY, items);
        this._dispatch();
        HSSState.ui.toast(`Added "${product.name}" to cart! 🛍️`);
      },

      updateQty(index, delta) {
        const items = this.get();
        if (!items[index]) return;
        const cur = Number(items[index].qty || items[index].quantity || 1);
        const next = cur + delta;
        if (next <= 0) {
          items.splice(index, 1);
        } else {
          items[index].qty = next;
        }
        safeSet(CART_KEY, items);
        this._dispatch();
      },

      remove(index) {
        const items = this.get();
        if (items[index]) {
          const removed = items.splice(index, 1)[0];
          safeSet(CART_KEY, items);
          this._dispatch();
          HSSState.ui.toast(`Removed "${removed.name}" from cart`);
        }
      },

      setSelected(index, checked) {
        const items = this.get();
        if (items[index]) {
          items[index].selected = Boolean(checked);
          safeSet(CART_KEY, items);
          this._dispatch();
        }
      },

      selectAll(checked) {
        const items = this.get().map(i => ({ ...i, selected: Boolean(checked) }));
        safeSet(CART_KEY, items);
        this._dispatch();
      },

      clear() {
        safeSet(CART_KEY, []);
        this._dispatch();
      },

      _dispatch() {
        const items = this.get();
        const cnt = this.count();
        const tot = this.total();

        // Update all header badges across DOM if available
        if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
          document.querySelectorAll('.badge, [data-cart-badge]').forEach(el => {
            el.textContent = cnt;
            el.style.display = cnt > 0 ? '' : 'none';
          });
        }

        // Fire global custom event for reactive UI components
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('hss:cart-updated', {
            detail: { items, count: cnt, total: tot }
          }));
        }
      }
    },

    // ----------------------------------------------------
    // INVENTORY / STOCK MASKING (Client Security & Privacy)
    // ----------------------------------------------------
    stock: {
      cache: new Map(),

      mask(units) {
        const n = Number(units || 0);
        if (n <= 0) {
          return { inStock: false, label: 'Currently Out of Stock', badgeClass: 'out' };
        }
        if (n <= 5) {
          return { inStock: true, label: `Only ${n} left in stock!`, badgeClass: 'low' };
        }
        // Protect inventory counts: never reveal real wholesale count when > 5
        return { inStock: true, label: 'In Stock', badgeClass: 'ok' };
      },

      async load() {
        try {
          const res = await fetch('/api/products', { cache: 'no-store' });
          if (!res.ok) return [];
          const data = await res.json();
          const prods = data.products || [];
          prods.forEach(p => this.cache.set(p.id, p));
          return prods;
        } catch (e) {
          console.warn('Inventory fetch failed', e);
          return [];
        }
      },

      get(id) {
        return this.cache.get(id);
      }
    },

    // ----------------------------------------------------
    // RECENTLY VIEWED PRODUCTS
    // ----------------------------------------------------
    recent: {
      get() {
        return safeGet(RECENT_KEY, []);
      },

      add(product) {
        if (!product || !product.id) return;
        let list = this.get().filter(p => p.id !== product.id);
        list.unshift({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image || product.image_url || ''
        });
        if (list.length > 8) list = list.slice(0, 8);
        safeSet(RECENT_KEY, list);
        window.dispatchEvent(new CustomEvent('hss:recent-updated', { detail: list }));
      }
    },

    // ----------------------------------------------------
    // UI HELPERS (Modals, Drawers, Toasts)
    // ----------------------------------------------------
    ui: {
      toast(msg, duration = 3200) {
        if (typeof document === 'undefined') return;
        const container = getToastContainer();
        if (!container) return;
        const toastEl = document.createElement('div');
        toastEl.className = 'hss-toast';
        toastEl.textContent = msg;
        container.appendChild(toastEl);

        setTimeout(() => toastEl.classList.add('visible'), 20);
        setTimeout(() => {
          toastEl.classList.remove('visible');
          setTimeout(() => toastEl.remove(), 350);
        }, duration);
      },

      toggleDrawer(id, force) {
        const drawer = document.getElementById(id);
        const overlay = document.getElementById('site-overlay') || document.getElementById('side-overlay');
        if (!drawer) return;

        const willOpen = typeof force === 'boolean' ? force : !drawer.classList.contains('active');
        drawer.classList.toggle('active', willOpen);

        const anyOpen = document.querySelectorAll('.boutique-drawer.active, #side-menu.active, #cart-drawer.active, #wishlist-drawer.active').length > 0;
        if (overlay) {
          overlay.classList.toggle('active', anyOpen);
        }
        document.body.style.overflow = anyOpen ? 'hidden' : '';
      },

      closeAll() {
        document.querySelectorAll('.boutique-drawer, #side-menu, #cart-drawer, #wishlist-drawer').forEach(d => {
          d.classList.remove('active');
        });
        const overlay = document.getElementById('site-overlay') || document.getElementById('side-overlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    },

    // ----------------------------------------------------
    // WHATSAPP CHECKOUT ORDER GENERATOR
    // ----------------------------------------------------
    whatsapp: {
      number: WA_NUMBER,

      buildMessage(order) {
        const { customerName, phone, address, items, subtotal, deliveryFee = 250, discount = 0, promoCode } = order;
        const grandTotal = Math.max(0, subtotal - discount + deliveryFee);

        let lines = [
          '🛍️ *HER SECOND SKIN PK — NEW ORDER*',
          '━━━━━━━━━━━━━━━━━━━━━',
          `👤 *Customer:* ${customerName || 'Customer'}`,
          `📞 *Phone:* ${phone || 'Not provided'}`,
          `📍 *Address:* ${address || 'Across Pakistan'}`,
          '',
          '📦 *ITEMS ORDERED:*'
        ];

        items.forEach((item, i) => {
          const varDesc = [item.color, item.size, item.cupSize].filter(Boolean).join(' / ');
          lines.push(`${i + 1}. *${item.name}*`);
          if (varDesc) lines.push(`   └ Options: ${varDesc}`);
          lines.push(`   └ Qty: ${item.qty || item.quantity} × ${money(item.price)} = ${money((item.qty || item.quantity) * item.price)}`);
        });

        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━');
        lines.push(`💰 *Items Subtotal:* ${money(subtotal)}`);
        if (discount > 0) {
          lines.push(`🏷️ *Promo Discount (${promoCode || 'PROMO'}):* -${money(discount)}`);
        }
        lines.push(`🚚 *Delivery Charges:* ${money(deliveryFee)}`);
        lines.push(`✨ *Grand Total:* *${money(grandTotal)}* (Cash on Delivery)`);
        lines.push('');
        lines.push('Please confirm availability and dispatch! Thank you. ❤️');

        return lines.join('\n');
      },

      openCheckout(order) {
        const msg = this.buildMessage(order);
        const url = `https://wa.me/${this.number}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  // Expose globally & CommonJS export
  if (typeof window !== 'undefined') {
    window.HSSState = HSSState;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HSSState;
  }

  // Initialize badges on DOM ready if running in browser
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      HSSState.cart._dispatch();

      // Global drawer close on ESC
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') HSSState.ui.closeAll();
      });

      // Global overlay click
      const overlay = document.getElementById('site-overlay') || document.getElementById('side-overlay');
      if (overlay) {
        overlay.addEventListener('click', () => HSSState.ui.closeAll());
      }
    });
  }
})();
