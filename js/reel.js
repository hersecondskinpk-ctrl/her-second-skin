/**
 * Her Second Skin PK — Reel Viewer Controller (js/reel.js)
 */
(async () => {
  'use strict';
  const target = document.getElementById('viewer');
  try {
    const value = new URLSearchParams(location.search).get('id');
    if (!/^\d+$/.test(value || '')) throw Error('Invalid reel.');
    const result = await fetch('/api/homepage');
    if (!result.ok) throw Error('Unable to load reel.');
    const { homepage } = await result.json();
    const r = homepage.reels?.[Number(value)];
    if (!r || !/^\/uploads\/[a-f0-9-]+\.(mp4|webm)$/i.test(r.url)) throw Error('Reel not found.');

    document.getElementById('title').textContent = r.caption || 'Watch Reel';
    document.getElementById('deal').textContent = r.deal || '';
    target.replaceChildren();

    const v = document.createElement('video');
    v.src = r.url;
    v.controls = true;
    v.autoplay = false;
    v.playsInline = true;
    v.muted = false;
    v.loop = false;
    v.preload = 'metadata';
    target.appendChild(v);

    const hint = document.createElement('p');
    hint.textContent = 'Press Play for sound, volume, progress and fullscreen controls.';
    target.appendChild(hint);
  } catch (e) {
    target.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = e.message || 'Video unavailable';
    target.appendChild(p);
  }
})();
