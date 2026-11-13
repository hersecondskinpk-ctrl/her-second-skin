'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { initWhatsApp } = require('../whatsapp-automation.js');

console.log('--- STARTING CATEGORY 5 WHATSAPP CLOUD API AUTOMATED VERIFICATION ---');

const testDbPath = path.join(__dirname, '..', 'data_test', 'wa_test.sqlite');
fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (_) {}
}
const db = new DatabaseSync(testDbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE,
    customer_name TEXT,
    phone TEXT,
    address TEXT,
    subtotal INTEGER,
    discount INTEGER,
    delivery_fee INTEGER,
    total INTEGER,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);

const mockOrder = {
  id: 'order_123',
  order_number: 'HSS-20261031-9999',
  customer_name: 'Zainab Bibi',
  phone: '03123456789',
  address: 'Apartment 4B, Clifton Block 2, Karachi',
  subtotal: 5500,
  discount: 500,
  delivery_fee: 350,
  deliveryFee: 350,
  total: 5350,
  status: 'pending',
  items: [
    { product_id: 'p1', product_name: 'Lace Bralette', color: 'Ivory', size: '36C', quantity: 1, unit_price: 3000, lineTotal: 3000 },
    { product_id: 'p2', product_name: 'Cotton Panty', color: 'Blush', size: 'M', quantity: 2, unit_price: 1250, lineTotal: 2500 }
  ]
};

db.prepare(`INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(mockOrder.id, mockOrder.order_number, mockOrder.customer_name, mockOrder.phone, mockOrder.address, mockOrder.subtotal, mockOrder.discount, mockOrder.delivery_fee, mockOrder.total, mockOrder.status, new Date().toISOString(), new Date().toISOString());

let orderStatus = mockOrder.status;
const setOrderStatus = (id, st, note) => { orderStatus = st; };
const getOrder = id => ({ ...mockOrder, status: orderStatus });

process.env.WHATSAPP_ADMIN_NUMBER = '03001234567';
process.env.META_APP_SECRET = 'test_meta_app_secret_32bytes_key!';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test_verify_token_123';

const wa = initWhatsApp({ db, getOrder, setOrderStatus, siteBase: 'https://example.com' });

// 1. Test Task 25 & 26: Initial Order Scheduling & Outbox Payload Verification
console.log('\n[Task 25 & 26] Testing initial order scheduling and template payloads...');
wa.scheduleInitial(mockOrder);

const outboxJobs = db.prepare('SELECT * FROM wa_outbox WHERE order_id = ?').all(mockOrder.id);
console.log(`Outbox jobs created: ${outboxJobs.length}`);
if (outboxJobs.length !== 2) throw new Error('Expected 2 outbox messages (customer received + shopkeeper new order)');

const customerJob = outboxJobs.find(j => j.kind === 'step1_customer');
const shopkeeperJob = outboxJobs.find(j => j.kind === 'step1_admin_template');

const custPayload = JSON.parse(customerJob.payload);
console.log('Customer Template Name:', custPayload.template.name);
console.log('Customer Template Body Parameters Count:', custPayload.template.components[0].parameters.length);
if (custPayload.template.name !== 'hss_customer_order_received_v1') throw new Error('Customer template name mismatch');
if (custPayload.template.components[0].parameters.length !== 10) throw new Error('Template A must have exactly 10 body values');

const shopPayload = JSON.parse(shopkeeperJob.payload);
console.log('Shopkeeper Template Name:', shopPayload.template.name);
console.log('Shopkeeper Header Image:', shopPayload.template.components[0].parameters[0].image.link);
console.log('Shopkeeper Body Parameters Count:', shopPayload.template.components[1].parameters.length);
if (shopPayload.template.name !== 'hss_shopkeeper_new_order_v1') throw new Error('Shopkeeper template name mismatch');
if (shopPayload.template.components[1].parameters.length !== 14) throw new Error('Template B must have exactly 14 body values');

console.log('PASS: Task 25 & 26 verified (Templates A & B formatted correctly)!');

// 2. Test Task 27: Webhook interactive button responses
console.log('\n[Task 27 & 28] Testing Webhook response and state transitions...');

// Simulate customer pressing "Confirm Order" button (payload HSS_CONFIRM:HSS-20261031-9999)
const fakeConfirmPayload = {
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: '923123456789',
          interactive: {
            button_reply: {
              id: 'HSS_CONFIRM:' + mockOrder.order_number,
              title: 'Confirm Order'
            }
          }
        }]
      }
    }]
  }]
};

// Process webhook payload directly
const rawPayload = Buffer.from(JSON.stringify(fakeConfirmPayload));
const signature = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawPayload).digest('hex');

let fakeResEnded = false;
let fakeResCode = 0;
const fakeReq = {
  headers: { 'x-hub-signature-256': signature },
  [Symbol.asyncIterator]: async function* () { yield rawPayload; }
};
const fakeRes = {
  writeHead: (code) => { fakeResCode = code; },
  end: () => { fakeResEnded = true; }
};

wa.webhookPost(fakeReq, fakeRes).then(() => {
  console.log('Webhook POST status:', fakeResCode);
  if (fakeResCode !== 200) throw new Error('Webhook post failed with status ' + fakeResCode);

  const waOrder = db.prepare('SELECT * FROM wa_orders WHERE order_id = ?').get(mockOrder.id);
  console.log('Order stage after confirm button:', waOrder.stage);
  if (waOrder.stage !== 'verifying_details') throw new Error('Order stage should be verifying_details');

  // Check Template D (delivery_verification, 4 body params + 2 buttons) was queued
  const verifyJob = db.prepare("SELECT * FROM wa_outbox WHERE order_id = ? AND kind = 'step3_delivery_verification'").get(mockOrder.id);
  if (!verifyJob) throw new Error('Template D delivery verification was not queued');
  const dPayload = JSON.parse(verifyJob.payload);
  console.log('Template D name:', dPayload.template.name);
  console.log('Template D body params:', dPayload.template.components[0].parameters.length);
  if (dPayload.template.name !== 'hss_delivery_verification_v1') throw new Error('Template D name mismatch');
  if (dPayload.template.components[0].parameters.length !== 4) throw new Error('Template D must have 4 parameters');
  console.log('PASS: Template D (4 values + 2 buttons) queued on confirmation!');

  // 3. Test Template F: Courier Dispatch
  console.log('\n[Task 25 & 27 Test] Testing Template F Courier Dispatch...');
  // Move stage to ready_to_pack
  db.prepare("UPDATE wa_orders SET stage = 'ready_to_pack' WHERE order_id = ?").run(mockOrder.id);

  const dispatchResult = wa.courierDispatch(mockOrder.id, {
    courier: 'TCS Express',
    tracking: 'TCS-987654321',
    trackingLink: 'https://www.tcsexpress.com/track/TCS-987654321',
    dispatchDate: '2026-11-01'
  });
  console.log('Courier dispatch result:', dispatchResult);

  const dispatchJob = db.prepare("SELECT * FROM wa_outbox WHERE order_id = ? AND kind = 'step5_dispatched'").get(mockOrder.id);
  if (!dispatchJob) throw new Error('Template F dispatch message not queued');
  const fPayload = JSON.parse(dispatchJob.payload);
  console.log('Template F name:', fPayload.template.name);
  console.log('Template F body params:', fPayload.template.components[0].parameters.length);
  if (fPayload.template.name !== 'hss_order_dispatched_v1') throw new Error('Template F name mismatch');
  if (fPayload.template.components[0].parameters.length !== 6) throw new Error('Template F must have 6 parameters');

  console.log('\n========================================');
  console.log('ALL CATEGORY 5 WHATSAPP TESTS PASSED 100%!');
  console.log('========================================');
  db.close();
  process.exit(0);
}).catch(e => {
  console.error('Category 5 test failed:', e);
  db.close();
  process.exit(1);
});
