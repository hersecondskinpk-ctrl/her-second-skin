/**
 * Her Second Skin PK — Exchange & Refund Care Controller (js/exchange.js)
 * Bilingual Policy, Evidence Submission, and Real-time Status Tracking
 */
'use strict';

const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let policy = [], activeLang = 'both', verified = null, trackCred = null, trackRunning = false;

function page(p) {
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  for (const n of ['policy', 'request', 'track']) {
    $('page-' + n)?.classList.toggle('hidden', n !== p);
  }
  trackRunning = p === 'track' && !!trackCred;
}

function showMessage(id, message, error = false) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `<div class="status" role="status" style="border-color:${error ? '#ce5a68' : '#b8d8c4'}">${esc(message)}</div>`;
}

async function post(url, b) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
    credentials: 'same-origin'
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || 'Request failed');
  return j;
}

function faqRender() {
  const target = $('faq-list');
  if (!target) return;
  target.innerHTML = policy.map(q => `
    <details class="faq">
      <summary>${q.number}. ${activeLang === 'ur' ? esc(q.question_ur) : esc(q.question_en)}</summary>
      <div>
        ${activeLang !== 'ur' ? `<p><b>Answer:</b> ${esc(q.answer_en)}</p>` : ''}
        ${activeLang !== 'en' ? `<p class="urdu"><b>جواب:</b> ${esc(q.answer_ur)}</p>` : ''}
      </div>
    </details>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => page(b.dataset.page)));

  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
    activeLang = b.dataset.lang;
    document.querySelectorAll('[data-lang]').forEach(x => x.classList.toggle('selected', x === b));
    faqRender();
  }));

  fetch('/api/exchange-policy').then(r => r.json()).then(d => {
    policy = d.policy || [];
    faqRender();
  }).catch(() => {
    if ($('faq-list')) $('faq-list').textContent = 'Policy temporarily unavailable. Please contact WhatsApp support.';
  });

  $('verify-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const number = $('verify-order').value.trim(), phone = $('verify-phone').value.trim();
      const d = await post('/api/exchanges/verify', { orderNumber: number, phone });
      verified = { orderNumber: number, phone };
      $('request-item').innerHTML = d.items.map(i => `<option value="${esc(i.id)}" data-qty="${i.quantity}">${esc(i.product_name)} · ${esc(i.color)} / ${esc(i.size)} · Qty ${i.quantity}</option>`).join('');
      $('request-step')?.classList.remove('hidden');
      $('request-message').textContent = '';
      updateQty();
    } catch (err) {
      $('request-step')?.classList.add('hidden');
      showMessage('request-message', err.message, true);
    }
  });

  function updateQty() {
    const item = $('request-item')?.selectedOptions[0];
    const max = Number(item?.dataset.qty || 1);
    if ($('request-qty')) {
      $('request-qty').max = String(max);
      $('request-qty').value = '1';
    }
  }
  $('request-item')?.addEventListener('change', updateQty);

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Unable to read photo'));
      reader.readAsDataURL(file);
    });
  }

  $('exchange-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('submit-request');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      if (!verified) throw Error('Verify the order first.');
      const files = Array.from($('request-photos').files);
      if (!files.length || files.length > 3 || files.some(f => f.size > 2 * 1024 * 1024 || !['image/png', 'image/webp', 'image/jpeg'].includes(f.type))) {
        throw Error('Please select 1–3 JPG/PNG/WebP images, each under 2 MB.');
      }
      const photos = await Promise.all(files.map(readFile));
      const d = await post('/api/exchanges', {
        ...verified,
        orderItemId: $('request-item').value,
        reason: $('request-reason').value,
        deliveryDate: $('request-date').value,
        quantity: Number($('request-qty').value),
        description: $('request-description').value.trim(),
        replacementRelated: $('replacement-related').checked,
        photos
      });
      showMessage('request-message', `Request submitted: ${d.number}\n${d.message}`);
      $('exchange-form').reset();
      $('request-step')?.classList.add('hidden');
      $('track-order').value = verified.orderNumber;
      $('track-phone').value = verified.phone;
    } catch (err) {
      showMessage('request-message', err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Exchange Request';
    }
  });

  $('track-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    trackCred = { orderNumber: $('track-order').value.trim(), phone: $('track-phone').value.trim() };
    trackRunning = true;
    await runTracking();
  });

  if (location.hash === '#track') page('track');
  if (location.hash === '#request') page('request');
});

async function runTracking(quiet = false) {
  if (!trackCred) return;
  try {
    const d = await post('/api/exchanges/track', trackCred);
    renderTracking(d);
  } catch (err) {
    if (!quiet) showMessage('track-results', err.message, true);
  }
}

function renderTracking(data) {
  const summary = $('order-tracking-summary');
  if (summary) {
    summary.innerHTML = `<div class="exchange-result"><h3>Order ${esc(data.orderNumber)} · ${esc(data.orderStatus || 'Pending')}</h3></div>`;
  }
  const arr = data.exchanges || [];
  if ($('track-results')) {
    $('track-results').innerHTML = arr.length ? arr.map(x => `
      <article class="exchange-result">
        <h3>${esc(x.number)} · ${esc(x.statusLabel)}</h3>
        <p><b>${esc(x.product)}</b> · ${esc(x.color)} / ${esc(x.size)}</p>
        <p class="help">Submitted: ${new Date(x.createdAt).toLocaleString()}</p>
      </article>
    `).join('') : '<p>No exchange requests found for this order.</p>';
  }
}

setInterval(() => {
  if (trackRunning && !document.hidden) runTracking(true);
}, 25000);
