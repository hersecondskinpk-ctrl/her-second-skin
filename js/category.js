/**
 * Her Second Skin PK — Category Page Controller (js/category.js)
 * Manages category inventory integration, drawers, and WhatsApp quick orders
 */
(() => {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

  document.addEventListener('DOMContentLoaded', () => {
    // Menu toggle listener
    const menuBtn = document.getElementById('menu-toggle-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => HSSState.ui.toggleDrawer('site-side-menu'));
    }
  });

  window.HSSCategory = {
    toggleMenu(force) {
      HSSState.ui.toggleDrawer('site-side-menu', force);
    },
    quickOrder(name, price) {
      const text = `Assalam-o-alaikum, I am interested in ${name} (${money(price)}). Please confirm availability, size and colours.`;
      const url = `https://wa.me/923397055500?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Backwards compatibility for existing inline HTML
  window.toggleMenu = window.HSSCategory.toggleMenu;
})();
