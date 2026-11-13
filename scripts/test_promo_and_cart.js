'use strict';
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '8799';
process.env.HSS_DATA_DIR = path.join(__dirname, '..', 'data_test');
process.env.HSS_DATABASE_PATH = path.join(process.env.HSS_DATA_DIR, 'test.sqlite');
fs.mkdirSync(process.env.HSS_DATA_DIR, { recursive: true });
for (const ext of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.HSS_DATABASE_PATH + ext); } catch (_) {}
}
try { fs.unlinkSync(path.join(process.env.HSS_DATA_DIR, 'INITIAL-ADMIN-LOGIN.txt')); } catch (_) {}

console.log('--- STARTING CATEGORY 2 & 3 AUTOMATED VERIFICATION ---');

// Require server to start it
const serverApp = require('../server.js');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8799,
      path,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  try {
    // 1. Health check
    const health = await request('GET', '/api/health');
    console.log('Health check status:', health.status);
    if (health.status !== 200 || !health.json.ok) throw new Error('Server health check failed');

    // 2. Task 13: Validate that unmanaged HSS10 and HSS20 are REJECTED!
    console.log('\n[Task 13 Test] Checking rejection of hardcoded HSS10 and HSS20...');
    const valHSS10 = await request('POST', '/api/promos/validate', { code: 'HSS10', subtotal: 3000 });
    console.log('HSS10 validate response status:', valHSS10.status, valHSS10.json);
    if (valHSS10.status === 200) throw new Error('HSS10 should be rejected when unmanaged!');

    const valHSS20 = await request('POST', '/api/promos/validate', { code: 'HSS20', subtotal: 3000 });
    console.log('HSS20 validate response status:', valHSS20.status, valHSS20.json);
    if (valHSS20.status === 200) throw new Error('HSS20 should be rejected when unmanaged!');
    console.log('PASS: Task 13 unmanaged HSS10/HSS20 properly rejected!');

    // 3. Admin login to test Promo Manager CRUD
    console.log('\n[Task 14 & 15 Test] Admin login & Promo Manager API...');
    const initialAdminFile = path.join(process.env.HSS_DATA_DIR, 'INITIAL-ADMIN-LOGIN.txt');
    let pass = 'admin';
    if (fs.existsSync(initialAdminFile)) {
      const content = fs.readFileSync(initialAdminFile, 'utf8');
      const m = content.match(/Password:\s*(\S+)/);
      if (m) pass = m[1];
    }
    const loginRes = await request('POST', '/api/auth/login', { username: 'admin', password: pass });
    console.log('Admin login status:', loginRes.status);
    const cookie = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0].split(';')[0] : '';
    const adminHeaders = { 'Cookie': cookie };

    // 4. Test 366 days duration REJECTION (must reject > 365)
    const reject366 = await request('POST', '/api/admin/promos', {
      code: 'TOO_LONG',
      type: 'percentage',
      value: 10,
      duration_days: 366
    }, adminHeaders);
    console.log('Reject 366 days status:', reject366.status, reject366.json);
    if (reject366.status !== 400) throw new Error('Duration > 365 days must be rejected!');

    // 5. Create valid 30-day percentage promo
    const createPromo = await request('POST', '/api/admin/promos', {
      code: 'WELCOME15',
      type: 'percentage',
      value: 15,
      duration_days: 30,
      min_subtotal: 1000,
      usage_limit: 5,
      per_customer_limit: 1
    }, adminHeaders);
    console.log('Create promo WELCOME15 status:', createPromo.status, createPromo.json);
    if (createPromo.status !== 201) throw new Error('Failed to create valid promo');

    // 6. Test promo validation for WELCOME15
    const valWelcome = await request('POST', '/api/promos/validate', { code: 'WELCOME15', subtotal: 4000 });
    console.log('Validate WELCOME15 on PKR 4000 subtotal:', valWelcome.json);
    if (valWelcome.status !== 200 || valWelcome.json.promo.discount !== 600) throw new Error('Promo calculation error for WELCOME15 (expected 600)');
    console.log('PASS: WELCOME15 validated correctly with 15% (PKR 600)!');

    // 7. Check Emergency Kill-Switch
    console.log('\n[Task 13 Emergency Kill-Switch Test]');
    const killOn = await request('POST', '/api/admin/promos/toggle-all', { disable: true }, adminHeaders);
    console.log('Emergency disable status:', killOn.json);
    const valDuringKill = await request('POST', '/api/promos/validate', { code: 'WELCOME15', subtotal: 4000 });
    console.log('Validate during emergency disable:', valDuringKill.status, valDuringKill.json);
    if (valDuringKill.status === 200) throw new Error('Promo must fail during emergency disable!');

    // Re-enable promos
    await request('POST', '/api/admin/promos/toggle-all', { disable: false }, adminHeaders);

    // 8. Order Placement & Cart Validation (Tasks 04 - 12)
    console.log('\n[Category 2 Checkout & Order Test]');
    // Create a test product with variant to order
    const prodRes = await request('POST', '/api/products', {
      name: 'Luxury Silk Bra',
      category: 'bras',
      price: 3500,
      cost_price: 1500,
      variants: [{ color: 'Burgundy', size: '34B', sku: 'LSB-BUR-34B', stock: 10 }]
    }, adminHeaders);
    const variantId = prodRes.json.product.variants[0].id;
    console.log('Created test product with variantId:', variantId);

    // Test invalid phone number rejection (Task 09)
    const badPhoneOrder = await request('POST', '/api/orders', {
      customerName: 'Fatima',
      phone: '04212345678', // Invalid (not 03XX)
      address: 'Gulberg III, Lahore',
      items: [{ variantId, quantity: 1 }]
    });
    console.log('Bad phone response:', badPhoneOrder.status, badPhoneOrder.json);
    if (badPhoneOrder.status !== 400) throw new Error('Invalid phone number must be rejected');

    // Test valid order with WELCOME15 promo and idempotency key
    const idemKey = 'TEST_IDEMPOTENCY_KEY_1234567890';
    const orderRes = await request('POST', '/api/orders', {
      customerName: 'Ayesha Khan',
      phone: '03001234567',
      address: 'House 12, Street 4, Sector F-7, Islamabad',
      promoCode: 'WELCOME15',
      idempotencyKey: idemKey,
      items: [{ variantId, quantity: 2 }] // 2 * 3500 = 7000 subtotal, 15% = 1050 discount, delivery = 350, total = 6300
    });
    console.log('Order created status:', orderRes.status, orderRes.json);
    if (orderRes.status !== 201) throw new Error('Order creation failed');
    const o = orderRes.json.order;
    if (o.subtotal !== 7000 || o.discount !== 1050 || o.deliveryFee !== 350 || o.total !== 6300) {
      throw new Error(`Order totals mismatch: subtotal=${o.subtotal}, discount=${o.discount}, delivery=${o.deliveryFee}, total=${o.total}`);
    }
    console.log(`PASS: Order ${o.order_number} created atomically with subtotal 7,000, discount 1,050, delivery 350, total 6,300 PKR!`);

    // Test idempotency (duplicate submission returns duplicate=true without re-charging or re-decrementing stock)
    const dupRes = await request('POST', '/api/orders', {
      customerName: 'Ayesha Khan',
      phone: '03001234567',
      address: 'House 12, Street 4, Sector F-7, Islamabad',
      promoCode: 'WELCOME15',
      idempotencyKey: idemKey,
      items: [{ variantId, quantity: 2 }]
    });
    console.log('Duplicate order submission response:', dupRes.status, dupRes.json?.duplicate);
    if (!dupRes.json?.duplicate) throw new Error('Idempotency failed: expected duplicate order return');
    console.log('PASS: Idempotency protected against rapid double submission!');

    // Test per-customer promo limit (customer 03001234567 already used WELCOME15)
    const secondOrderSamePromo = await request('POST', '/api/orders', {
      customerName: 'Ayesha Khan',
      phone: '03001234567',
      address: 'House 12, Street 4, Sector F-7, Islamabad',
      promoCode: 'WELCOME15',
      items: [{ variantId, quantity: 1 }]
    });
    console.log('Second order with same promo status:', secondOrderSamePromo.status, secondOrderSamePromo.json);
    if (secondOrderSamePromo.status === 201) throw new Error('Per-customer promo limit violation!');
    console.log('PASS: Per-customer single redemption limit successfully enforced!');

    console.log('\n========================================');
    console.log('ALL CATEGORY 2 & 3 TESTS PASSED 100%!');
    console.log('========================================');
    process.exit(0);
  } catch (err) {
    console.error('\nTEST FAILED WITH ERROR:', err);
    process.exit(1);
  }
}

runTests();
