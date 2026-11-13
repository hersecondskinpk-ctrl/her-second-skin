/**
 * Her Second Skin PK — Client Router & Navigation Utility
 * Handles clean URLs, query parameters, and page state navigation.
 */
(() => {
  'use strict';

  const HSSRouter = {
    getParam(name) {
      return new URLSearchParams(window.location.search).get(name);
    },

    setParam(name, val) {
      const url = new URL(window.location);
      if (val == null || val === '') {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, val);
      }
      window.history.replaceState({}, '', url);
    },

    getPageName() {
      const path = window.location.pathname.replace(/\/$/, '').toLowerCase();
      const last = path.split('/').pop() || '';
      const clean = last.replace(/\.html$/, '');
      if (!clean || clean === 'index') return 'home';
      return clean;
    },

    navigate(url) {
      window.location.href = url;
    },

    // Convert legacy or mixed links to clean routes
    cleanUrl(url) {
      if (!url) return '/';
      return url.replace(/\.html(\?|$)/, '$1');
    }
  };

  if (typeof window !== 'undefined') {
    window.HSSRouter = HSSRouter;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HSSRouter;
  }
})();
