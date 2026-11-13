'use strict';
// Her Second Skin PK - Five-Stage WhatsApp Cloud API Automation
// Implements the SIX Meta-approved templates with durable outbox and retry mechanism.
const crypto = require('node:crypto');

function initWhatsApp({ db, getOrder, setOrderStatus, siteBase }) {
  const env = process.env;
  const enabled = env.WHATSAPP_AUTOMATION_ENABLED === '1';
  const token = env.WHATSAPP_ACCESS_TOKEN || '';
  const sender = env.WHATSAPP_PHONE_NUMBER_ID || '';
  const admin = (env.WHATSAPP_ADMIN_NUMBER || '').replace(/\D/g, '');
  const secret = env.META_APP_SECRET || '';
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN || '';
  const flowId = env.WHATSAPP_FLOW_ID || '';
  const version = env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const base = (env.PUBLIC_BASE_URL || siteBase || '').replace(/\/$/, '');
  const lang = env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';

  const templateNames = {
    customer_received: env.WA_TEMPLATE_CUSTOMER_RECEIVED || 'hss_customer_order_received_v1',
    shopkeeper_new: env.WA_TEMPLATE_SHOPKEEPER_NEW || 'hss_shopkeeper_new_order_v1',
    order_confirmation_1hr: env.WA_TEMPLATE_CONFIRMATION_1HR || 'hss_order_confirmation_1hr_v1',
    delivery_verification: env.WA_TEMPLATE_DELIVERY_VERIFY || 'hss_delivery_verification_v1',
    ready_to_pack: env.WA_TEMPLATE_READY_TO_PACK || 'hss_ready_to_pack_v1',
    order_dispatched: env.WA_TEMPLATE_DISPATCHED || 'hss_order_dispatched_v1'
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_orders (
      order_id TEXT PRIMARY KEY REFERENCES orders(id),
      stage TEXT NOT NULL DEFAULT 'awaiting_confirmation',
      due_at TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      courier TEXT NOT NULL DEFAULT '',
      tracking TEXT NOT NULL DEFAULT '',
      tracking_link TEXT NOT NULL DEFAULT '',
      dispatch_date TEXT NOT NULL DEFAULT '',
      dispatched_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_due ON wa_orders(stage, due_at);
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      destination TEXT NOT NULL,
      payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      tries INTEGER NOT NULL DEFAULT 0,
      next_attempt TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(order_id, kind, destination)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_outbox_pending ON wa_outbox(state, next_attempt);
  `);

  const now = () => new Date().toISOString();
  const makeId = () => crypto.randomUUID();

  const orderPhone = p => {
    let x = String(p || '').replace(/\D/g, '');
    if (/^03\d{9}$/.test(x)) x = '92' + x.slice(1);
    if (!/^\d{10,15}$/.test(x)) throw new Error('Invalid WhatsApp recipient number');
    return x;
  };

  function event(orderId, ev, data = {}) {
    db.prepare('INSERT INTO wa_events VALUES (?,?,?,?,?)').run(makeId(), orderId, ev, JSON.stringify(data), now());
  }

  function queue(orderId, kind, destination, payload, due = now()) {
    db.prepare(`INSERT INTO wa_outbox(id, order_id, kind, destination, payload, next_attempt, created_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(order_id, kind, destination) DO UPDATE SET next_attempt=excluded.next_attempt, payload=excluded.payload`)
      .run(makeId(), orderId, kind, orderPhone(destination), JSON.stringify(payload), due, now());
  }

  function money(n) {
    return 'PKR ' + Number(n || 0).toLocaleString('en-PK');
  }

  function itemText(o) {
    return (o.items || []).map(i => `${i.product_name || i.name} (${i.color || ''}, ${i.size || ''}) x ${i.quantity || 1} - ${money(i.unit_price || i.lineTotal || 0)}`).join('\n');
  }

  function itemCount(o) {
    return (o.items || []).reduce((sum, i) => sum + Number(i.quantity || 1), 0);
  }

  function publicImage(o) {
    const i = (o.items || [])[0];
    if (!i) return 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600';
    try {
      const row = db.prepare('SELECT image_url FROM product_images WHERE product_id=? ORDER BY is_primary DESC, sort_order LIMIT 1').get(i.product_id)
        || db.prepare('SELECT image_url FROM products WHERE id=?').get(i.product_id);
      const u = row?.image_url || '';
      if (!u) return 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600';
      if (u.startsWith('/') && base.startsWith('https://')) return base + u;
      if (/^https:\/\//i.test(u)) return u;
    } catch (_) {}
    return 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600';
  }

  // --- Exact Approved Template Builder ---
  function buildTemplatePayload(templateKey, params, imageUrl = null, buttons = null) {
    const components = [];
    if (imageUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: imageUrl } }]
      });
    }
    if (Array.isArray(params) && params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map(x => ({ type: 'text', text: String(x ?? '').slice(0, 900) }))
      });
    }
    if (Array.isArray(buttons) && buttons.length > 0) {
      buttons.forEach((btn, idx) => {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(idx),
          parameters: [{ type: 'payload', payload: String(btn.payload) }]
        });
      });
    }
    return {
      type: 'template',
      template: {
        name: templateNames[templateKey],
        language: { code: lang },
        components
      }
    };
  }

  // 1. Initial Order Placement Notifications (Customer + Merchant)
  function scheduleInitial(o) {
    const existing = db.prepare('SELECT order_id FROM wa_orders WHERE order_id=?').get(o.id);
    if (existing) return;
    const due1hr = new Date(Date.now() + 3600000).toISOString();
    db.prepare('INSERT INTO wa_orders(order_id, stage, due_at, phone, address, updated_at) VALUES(?,?,?,?,?,?)')
      .run(o.id, 'awaiting_confirmation', due1hr, o.phone, o.address, now());
    event(o.id, 'order_received');

    // Template A: hss_customer_order_received_v1 (10 body values, text)
    const customerParams = [
      o.customer_name,
      o.order_number,
      itemText(o),
      String(itemCount(o)),
      money(o.delivery_fee ?? o.deliveryFee),
      money(o.discount),
      money(o.total),
      o.address,
      'Cash on Delivery (COD)',
      'WhatsApp: +92 339 7055500'
    ];
    queue(o.id, 'step1_customer', o.phone, buildTemplatePayload('customer_received', customerParams));

    // Template B: hss_shopkeeper_new_order_v1 (14 body values, image header)
    if (admin) {
      const shopkeeperParams = [
        o.order_number,
        o.customer_name,
        o.phone,
        o.address,
        itemText(o),
        String(itemCount(o)),
        money(o.subtotal),
        money(o.discount),
        money(o.delivery_fee ?? o.deliveryFee),
        money(o.total),
        'Cash on Delivery',
        new Date(o.created_at || Date.now()).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
        'Pending Customer 1-Hr Confirmation',
        'Do not dispatch yet'
      ];
      queue(o.id, 'step1_admin_template', admin, buildTemplatePayload('shopkeeper_new', shopkeeperParams, publicImage(o)));
    }
  }

  async function send(to, payload) {
    if (!enabled) {
      // In development/test mode without live credentials, log to console
      return { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: 'mock_msg_' + Date.now() }] };
    }
    if (!token || !sender) throw new Error('Missing WhatsApp token or sender Phone Number ID.');
    const r = await fetch(`https://graph.facebook.com/${version}/${sender}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Meta HTTP ${r.status}: ${JSON.stringify(data).slice(0, 400)}`);
    return data;
  }

  let busy = false;
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      const currentTime = now();
      // Step 2: 1-hour durable reminder check
      const dueOrders = db.prepare(`SELECT w.order_id FROM wa_orders w
        JOIN orders o ON o.id = w.order_id
        WHERE w.stage = 'awaiting_confirmation' AND w.due_at <= ? AND o.status NOT IN ('cancelled', 'delivered')
        LIMIT 20`).all(currentTime);

      for (const row of dueOrders) {
        const o = getOrder(row.order_id);
        if (!o) continue;
        // Template C: hss_order_confirmation_1hr_v1 (8 body values + 2 quick reply buttons)
        const hourParams = [
          o.customer_name,
          o.order_number,
          itemText(o),
          o.address,
          money(o.delivery_fee ?? o.deliveryFee),
          money(o.total),
          'Please confirm your order by tapping below within 24 hours.',
          'Need help? Reply to this message.'
        ];
        const buttons = [
          { payload: 'HSS_CONFIRM:' + o.order_number },
          { payload: 'HSS_CANCEL:' + o.order_number }
        ];
        queue(o.id, 'step2_hour_confirmation', o.phone, buildTemplatePayload('order_confirmation_1hr', hourParams, null, buttons));
        db.prepare("UPDATE wa_orders SET stage='confirmation_requested', updated_at=? WHERE order_id=? AND stage='awaiting_confirmation'")
          .run(currentTime, o.id);
        event(o.id, 'confirmation_requested');
      }

      // Outbox processor
      const pendingJobs = db.prepare("SELECT * FROM wa_outbox WHERE state='pending' AND next_attempt<=? ORDER BY created_at LIMIT 15").all(currentTime);
      for (const job of pendingJobs) {
        try {
          const resp = await send(job.destination, JSON.parse(job.payload));
          db.prepare("UPDATE wa_outbox SET state='sent', last_error='', tries=tries+1 WHERE id=?").run(job.id);
          event(job.order_id, job.kind + '_sent', { meta_id: resp.messages?.[0]?.id || '' });
        } catch (e) {
          const tries = job.tries + 1;
          const nextAttempt = new Date(Date.now() + Math.min(3600000, 30000 * Math.pow(2, tries))).toISOString();
          db.prepare("UPDATE wa_outbox SET tries=?, state=?, next_attempt=?, last_error=? WHERE id=?")
            .run(tries, tries >= 6 ? 'failed' : 'pending', nextAttempt, String(e.message).slice(0, 1000), job.id);
          console.error('[WhatsApp Outbox Error]', job.kind, e.message);
        }
      }
    } finally {
      busy = false;
    }
  }

  function orderForReply(value, from) {
    const match = /HSS-\d{8}-\d{4}/.exec(String(value || ''));
    if (!match) return null;
    const o = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(match[0]);
    if (!o) return null;
    const fullOrder = getOrder(o.id);
    const state = db.prepare('SELECT * FROM wa_orders WHERE order_id=?').get(o.id);
    if (!state || orderPhone(state.phone) !== orderPhone(from)) return null;
    return { o: fullOrder, state };
  }

  function processWebhook(payload) {
    const entries = payload.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const val = change.value || {};
        if (sender && val.metadata?.phone_number_id && val.metadata.phone_number_id !== sender) continue;
        for (const m of val.messages || []) {
          try {
            const from = m.from;
            const key = m.interactive?.button_reply?.id
              || m.button?.payload
              || (m.interactive?.nfm_reply?.response_json && (JSON.parse(m.interactive.nfm_reply.response_json).order_id || m.interactive.nfm_reply.flow_token))
              || '';
            const ref = orderForReply(key, from);
            if (!ref) continue;
            let { o, state } = ref;

            // Customer clicked Confirm Order -> Send Template D: delivery_verification
            if (key.startsWith('HSS_CONFIRM:') && ['confirmation_requested', 'awaiting_confirmation'].includes(state.stage)) {
              db.prepare("UPDATE wa_orders SET stage='verifying_details', updated_at=? WHERE order_id=?").run(now(), o.id);
              event(o.id, 'order_confirmed_by_customer');
              setOrderStatus(o.id, 'confirmed', 'Confirmed by customer on WhatsApp');

              // Template D: hss_delivery_verification_v1 (4 body values + 2 buttons)
              const verifyParams = [
                o.customer_name,
                o.order_number,
                state.phone,
                state.address
              ];
              const buttons = [
                { payload: 'HSS_DETAILS_OK:' + o.order_number },
                { payload: 'HSS_DETAILS_EDIT:' + o.order_number }
              ];
              queue(o.id, 'step3_delivery_verification', from, buildTemplatePayload('delivery_verification', verifyParams, null, buttons));
              setImmediate(pump);
            }
            // Customer clicked Cancel Order
            else if (key.startsWith('HSS_CANCEL:') && ['confirmation_requested', 'awaiting_confirmation'].includes(state.stage)) {
              db.prepare("UPDATE wa_orders SET stage='cancelled', updated_at=? WHERE order_id=?").run(now(), o.id);
              event(o.id, 'order_cancelled_by_customer');
              setOrderStatus(o.id, 'cancelled', 'Cancelled by customer on WhatsApp');
            }
            // Customer clicked All Details Correct
            else if (key.startsWith('HSS_DETAILS_OK:') && ['verifying_details', 'review_details'].includes(state.stage)) {
              db.prepare("UPDATE wa_orders SET stage='ready_to_pack', updated_at=? WHERE order_id=?").run(now(), o.id);
              event(o.id, 'details_verified_ready_to_pack');
              setOrderStatus(o.id, 'processing', 'Details verified, ready to pack');

              // Template E: hss_ready_to_pack_v1 (14 body values to merchant/shopkeeper)
              if (admin) {
                const packParams = [
                  o.order_number,
                  o.customer_name,
                  state.phone,
                  state.address,
                  itemText(o),
                  String(itemCount(o)),
                  money(o.subtotal),
                  money(o.discount),
                  money(o.delivery_fee ?? o.deliveryFee),
                  money(o.total),
                  'Cash on Delivery',
                  new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
                  'Customer verified all details. Ready to pack and dispatch.',
                  'Book courier now'
                ];
                queue(o.id, 'step4_ready_to_pack_admin', admin, buildTemplatePayload('ready_to_pack', packParams, publicImage(o)));
              }
              setImmediate(pump);
            }
          } catch (e) {
            console.error('[WhatsApp webhook message handler error]', e.message);
          }
        }
      }
    }
  }

  function webhookGet(url, res) {
    if (url.searchParams.get('hub.mode') === 'subscribe' && verifyToken && url.searchParams.get('hub.verify_token') === verifyToken) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(url.searchParams.get('hub.challenge') || '');
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
  }

  function verifySignature(raw, signature) {
    if (!secret || !signature) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async function webhookPost(req, res) {
    const chunks = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > 1024 * 1024) { res.writeHead(413); res.end(); return; }
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks);
    if (secret && !verifySignature(raw, req.headers['x-hub-signature-256'])) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let body;
    try { body = JSON.parse(raw.toString('utf8')); }
    catch { res.writeHead(400); res.end('Bad JSON'); return; }
    processWebhook(body);
    res.writeHead(200);
    res.end('EVENT_RECEIVED');
  }

  // Template F: hss_order_dispatched_v1 (6 body values)
  function courierDispatch(orderId, data) {
    const o = getOrder(orderId);
    if (!o) throw Object.assign(new Error('Order not found'), { status: 404 });
    const st = db.prepare('SELECT * FROM wa_orders WHERE order_id=?').get(o.id);
    if (!st || st.stage !== 'ready_to_pack') throw Object.assign(new Error('Order must be verified and ready to pack before dispatch'), { status: 409 });
    const courier = String(data.courier || '').trim().slice(0, 80);
    const tracking = String(data.tracking || '').trim().slice(0, 120);
    const link = String(data.trackingLink || '').trim().slice(0, 500);
    const date = String(data.dispatchDate || '').trim();
    if (!courier || !tracking || !/^https:\/\//i.test(link) || !/\d{4}-\d{2}-\d{2}/.test(date)) {
      throw Object.assign(new Error('Courier name, tracking code, valid HTTPS tracking link, and dispatch date required'), { status: 400 });
    }
    const t = now();
    db.prepare('UPDATE wa_orders SET courier=?, tracking=?, tracking_link=?, dispatch_date=?, stage=?, dispatched_at=?, updated_at=? WHERE order_id=?')
      .run(courier, tracking, link, date, 'dispatched', t, t, o.id);
    setOrderStatus(o.id, 'shipped', `Dispatched via ${courier} (${tracking})`);
    event(o.id, 'dispatched', { courier, tracking, date, link });

    const dispatchParams = [
      o.customer_name,
      o.order_number,
      courier,
      tracking,
      date,
      link
    ];
    queue(o.id, 'step5_dispatched', st.phone, buildTemplatePayload('order_dispatched', dispatchParams));
    setImmediate(pump);
    return { stage: 'dispatched', courier, tracking, trackingLink: link, dispatchDate: date };
  }

  function detail(id) {
    const o = getOrder(id);
    if (!o) return null;
    return {
      workflow: db.prepare('SELECT * FROM wa_orders WHERE order_id=?').get(o.id),
      events: db.prepare('SELECT event, payload, created_at FROM wa_events WHERE order_id=? ORDER BY created_at DESC LIMIT 50').all(o.id),
      messages: db.prepare('SELECT kind, destination, state, tries, last_error, created_at FROM wa_outbox WHERE order_id=? ORDER BY created_at DESC').all(o.id)
    };
  }

  const interval = setInterval(() => pump().catch(e => console.error('[WhatsApp pump]', e.message)), 15000);
  interval.unref();

  return { enabled, scheduleInitial, webhookGet, webhookPost, courierDispatch, detail, pump };
}

module.exports = { initWhatsApp };
