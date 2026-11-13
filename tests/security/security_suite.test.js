'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TEST_PORT = 4088;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function httpRequest({ path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    if (body && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const req = http.request(url, {
      method,
      headers: reqHeaders
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: raw,
          json
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Security & Vulnerability Assessment Test Suite', () => {
  let serverProcess = null;

  before(async () => {
    // Start local server for security testing
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
      stdio: 'ignore'
    });

    // Wait for server ready
    for (let i = 0; i < 30; i++) {
      try {
        const res = await httpRequest({ path: '/api/health' });
        if (res.status === 200) break;
      } catch {
        await sleep(250);
      }
    }
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  describe('1. Path Traversal & Directory Traversal Attacks', () => {
    it('should block attempts to escape root via /../../etc/passwd', async () => {
      const res = await httpRequest({ path: '/../../etc/passwd' });
      assert.ok([400, 403, 404].includes(res.status), `Expected block, got ${res.status}`);
      assert.equal(res.body.includes('root:'), false, 'Must not leak passwd');
    });

    it('should block URL-encoded traversal /..%2f..%2fserver.js', async () => {
      const res = await httpRequest({ path: '/..%2f..%2fserver.js' });
      assert.ok([400, 403, 404].includes(res.status));
      assert.equal(res.body.includes('DatabaseSync'), false, 'Must not leak server source');
    });

    it('should reject path traversal in /css/ route (/css/../../server.js)', async () => {
      const res = await httpRequest({ path: '/css/../../server.js' });
      assert.equal(res.status, 404, 'Regex guard must reject traversal');
      assert.equal(res.body.includes('crypto.randomUUID'), false);
    });

    it('should reject path traversal in /js/ route (/js/../../server.js)', async () => {
      const res = await httpRequest({ path: '/js/../../server.js' });
      assert.equal(res.status, 404, 'Regex guard must reject traversal');
    });

    it('should reject path traversal in /fonts/ route (/fonts/../../data/her-second-skin.sqlite)', async () => {
      const res = await httpRequest({ path: '/fonts/../../data/her-second-skin.sqlite' });
      assert.equal(res.status, 404);
      assert.equal(res.body.includes('SQLite format 3'), false);
    });

    it('should reject path traversal in /uploads/ route (/uploads/../../.env)', async () => {
      const res = await httpRequest({ path: '/uploads/../../.env' });
      assert.equal(res.status, 404);
    });

    it('should reject null-byte poisoned paths (%00)', async () => {
      const res = await httpRequest({ path: '/css/common.css%00.html' });
      assert.ok([400, 404].includes(res.status));
    });
  });

  describe('2. Sensitive Files & Codebase Protection', () => {
    const sensitiveFiles = [
      '/server.js',
      '/package.json',
      '/data/her-second-skin.sqlite',
      '/.env',
      '/.git',
      '/.gitignore',
      '/Dockerfile',
      '/fly.toml'
    ];

    for (const file of sensitiveFiles) {
      it(`should return 404 Not Found for direct request to ${file}`, async () => {
        const res = await httpRequest({ path: file });
        assert.equal(res.status, 404, `Direct access to ${file} must be blocked (404)`);
        assert.equal(res.body.includes('SQLite format 3'), false);
      });
    }
  });

  describe('3. Authentication & Authorization (Broken Access Control)', () => {
    it('should reject unauthorized access to /api/dashboard with 401', async () => {
      const res = await httpRequest({ path: '/api/dashboard' });
      assert.equal(res.status, 401);
      assert.equal(res.json?.error, 'Please sign in to the admin panel.');
    });

    it('should reject unauthorized access to /api/orders with 401', async () => {
      const res = await httpRequest({ path: '/api/orders' });
      assert.equal(res.status, 401);
    });

    it('should reject unauthorized access to /api/sales with 401', async () => {
      const res = await httpRequest({ path: '/api/sales' });
      assert.equal(res.status, 401);
    });

    it('should reject unauthorized access to /api/admin/promos with 401', async () => {
      const res = await httpRequest({ path: '/api/admin/promos' });
      assert.equal(res.status, 401);
    });

    it('should reject unauthorized product creation (POST /api/products) with 401', async () => {
      const res = await httpRequest({
        path: '/api/products',
        method: 'POST',
        body: { name: 'Hacked Product', category: 'bras', price: 100 }
      });
      assert.equal(res.status, 401);
    });

    it('should reject unauthorized stock adjustment with 401', async () => {
      const res = await httpRequest({
        path: '/api/variants/00000000-0000-0000-0000-000000000001/adjust',
        method: 'POST',
        body: { mode: 'set', stock: 100 }
      });
      assert.equal(res.status, 401);
    });

    it('should reject requests with fake or forged session tokens', async () => {
      const res = await httpRequest({
        path: '/api/dashboard',
        headers: { 'Cookie': 'hss_admin=forged_token_evil_hacker_12345' }
      });
      assert.equal(res.status, 401, 'Forged token must return 401 Unauthorized');
    });

    it('should reject unauthorized password change attempts', async () => {
      const res = await httpRequest({
        path: '/api/auth/password',
        method: 'POST',
        body: { currentPassword: 'test', newPassword: 'newPassword123!' }
      });
      assert.equal(res.status, 401);
    });
  });

  describe('4. SQL Injection Resistance', () => {
    it('should prevent SQL injection in category parameter (?category=bras\' OR 1=1 --)', async () => {
      const res = await httpRequest({ path: "/api/products?category=bras' OR 1=1 --" });
      assert.equal(res.status, 400, 'Unknown category rejected');
      assert.equal(res.json?.error, 'Unknown category.');
    });

    it('should safely handle SQL injection in promo code validation', async () => {
      const res = await httpRequest({
        path: '/api/promos/validate',
        method: 'POST',
        body: { code: "' OR '1'='1", subtotal: 5000 }
      });
      assert.equal(res.status, 400);
      assert.equal(res.json?.error, 'Invalid promo code.');
    });

    it('should safely handle SQL injection attempts in review product IDs', async () => {
      const res = await httpRequest({ path: "/api/products/' OR 1=1 --/reviews" });
      // Non-matching regex route returns 404 or empty reviews safely without SQL error
      assert.ok([200, 404].includes(res.status));
      if (res.status === 200) {
        assert.deepEqual(res.json?.reviews, []);
      }
    });
  });

  describe('5. Information Disclosure & Stock Masking Integrity', () => {
    it('should never expose wholesale costPrice or cost_price on public products API', async () => {
      const res = await httpRequest({ path: '/api/products' });
      assert.equal(res.status, 200);
      const products = res.json?.products || [];
      for (const p of products) {
        assert.equal(p.costPrice, undefined, 'costPrice must be completely omitted from public API');
        assert.equal(p.cost_price, undefined, 'cost_price must be completely omitted from public API');
      }
    });

    it('should mask inventory quantities for public users (totalStock is 0 or 1, not wholesale number)', async () => {
      const res = await httpRequest({ path: '/api/products' });
      assert.equal(res.status, 200);
      const products = res.json?.products || [];
      for (const p of products) {
        assert.ok([0, 1].includes(p.totalStock), 'totalStock must be masked to boolean indicator (0 or 1)');
        for (const v of (p.variants || [])) {
          assert.ok([0, 1].includes(v.stock), 'variant stock must be masked to boolean indicator (0 or 1)');
        }
      }
    });

    it('should refuse to leak unmasked stock if unauthenticated user adds ?admin=1', async () => {
      const res = await httpRequest({ path: '/api/products?admin=1' });
      assert.equal(res.status, 401, 'Public user cannot access admin view via ?admin=1');
    });
  });

  describe('6. Order Placement Input Validation & Anti-Tampering', () => {
    it('should reject order with missing customer name, phone, or address', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: { customerName: '', phone: '03001234567', address: '', items: [] }
      });
      assert.equal(res.status, 400);
    });

    it('should reject order with non-Pakistani phone number', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: {
          customerName: 'Test Buyer',
          phone: '04212345678', // Landline, not mobile
          address: 'Islamabad',
          items: [{ variantId: 'test', quantity: 1 }]
        }
      });
      assert.equal(res.status, 400);
      assert.ok(res.json?.error.includes('Pakistani mobile number starting with 03'));
    });

    it('should reject order with invalid / negative quantity', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: {
          customerName: 'Test Buyer',
          phone: '03001234567',
          address: 'Islamabad',
          items: [{ variantId: 'test', quantity: -2 }]
        }
      });
      assert.equal(res.status, 400);
    });

    it('should reject order with non-integer quantity', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: {
          customerName: 'Test Buyer',
          phone: '03001234567',
          address: 'Islamabad',
          items: [{ variantId: 'test', quantity: 1.5 }]
        }
      });
      assert.equal(res.status, 400);
    });

    it('should reject order with excessive quantity (> 99)', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: {
          customerName: 'Test Buyer',
          phone: '03001234567',
          address: 'Islamabad',
          items: [{ variantId: 'test', quantity: 150 }]
        }
      });
      assert.equal(res.status, 400);
    });

    it('should reject order with empty items array', async () => {
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: {
          customerName: 'Test Buyer',
          phone: '03001234567',
          address: 'Islamabad',
          items: []
        }
      });
      assert.equal(res.status, 400);
      assert.ok(res.json?.error.includes('Add at least one item'));
    });
  });

  describe('7. Rate Limiting & Anti-Abuse Defenses', () => {
    it('should enforce rate limiting on admin login attempts after multiple failures', async () => {
      // Send failed login attempts
      let triggered429 = false;
      for (let i = 0; i < 10; i++) {
        const res = await httpRequest({
          path: '/api/auth/login',
          method: 'POST',
          body: { username: 'admin', password: 'wrong-password-attempt-' + i }
        });
        if (res.status === 429) {
          triggered429 = true;
          assert.ok(res.json?.error.includes('Too many login attempts'));
          break;
        }
      }
      assert.ok(triggered429, 'Rate limiter must trigger HTTP 429 after 8 failed attempts');
    });
  });

  describe('8. Security Headers & Protocol Hygiene', () => {
    it('should include X-Content-Type-Options: nosniff on API responses', async () => {
      const res = await httpRequest({ path: '/api/health' });
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('should include X-Content-Type-Options: nosniff on static assets', async () => {
      const res = await httpRequest({ path: '/css/common.css' });
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('should include Cache-Control: no-store on API responses', async () => {
      const res = await httpRequest({ path: '/api/health' });
      assert.ok(res.headers['cache-control']?.includes('no-store'));
    });

    it('should reject oversized request bodies with 413 Payload Too Large', async () => {
      // Send oversized payload to order checkout (64KB limit)
      const bigString = 'x'.repeat(128 * 1024);
      const res = await httpRequest({
        path: '/api/orders',
        method: 'POST',
        body: { customerName: 'Tester', notes: bigString }
      });
      assert.equal(res.status, 413, 'Oversized payload must return 413');
      assert.ok(res.json?.error?.includes('too large'));
    });
  });
});
