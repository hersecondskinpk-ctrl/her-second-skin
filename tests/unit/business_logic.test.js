'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Helpers matching server.js implementations
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, digest };
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

const cleanText = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = n => Math.max(0, Math.round(Number(n) || 0));

function calculateDeliveryFee(subtotal, discount = 0) {
  return (subtotal - discount) >= 10000 ? 0 : 350;
}

function calculatePromoDiscount(promo, subtotal) {
  if (promo.min_subtotal > 0 && subtotal < promo.min_subtotal) {
    throw new Error(`Minimum order subtotal for this code is PKR ${promo.min_subtotal}.`);
  }
  let discount = 0;
  if (promo.type === 'percentage') {
    discount = Math.round(subtotal * (Number(promo.value) / 100));
  } else {
    discount = Math.round(Number(promo.value));
  }
  if (promo.max_discount > 0 && discount > promo.max_discount) {
    discount = Number(promo.max_discount);
  }
  if (discount > subtotal) {
    discount = subtotal;
  }
  return discount;
}

const PAK_MOBILE_REGEX = /^03\d{9}$/;

describe('Backend Business Logic - Unit Tests', () => {

  describe('Password Hashing & Timing-Safe Verification', () => {
    it('should correctly hash password using scrypt with random salt', () => {
      const { salt, digest } = hashPassword('MySecretAdminPass123!');
      assert.ok(salt && salt.length === 32, 'Salt should be 32 hex chars (16 bytes)');
      assert.ok(digest && digest.length === 128, 'Digest should be 128 hex chars (64 bytes)');
    });

    it('should verify password match with timing-safe comparison', () => {
      const password = 'SuperSecurePass2026';
      const stored = hashPassword(password);

      const attemptHash = hashPassword(password, stored.salt).digest;
      assert.ok(safeEqual(attemptHash, stored.password_hash || stored.digest), 'Correct password must verify');

      const wrongAttempt = hashPassword('WrongPassword!', stored.salt).digest;
      assert.equal(safeEqual(wrongAttempt, stored.password_hash || stored.digest), false, 'Wrong password must fail');
    });

    it('should fail verification if candidate lengths differ', () => {
      assert.equal(safeEqual('abc', 'abcd'), false);
      assert.equal(safeEqual('', 'a'), false);
    });
  });

  describe('Input Sanitization & Boundary Protections', () => {
    it('cleanText should strip whitespace, handle null/undefined and enforce max length', () => {
      assert.equal(cleanText('   hello world   '), 'hello world');
      assert.equal(cleanText(null), '');
      assert.equal(cleanText(undefined), '');
      assert.equal(cleanText(12345), '12345');

      const longString = 'a'.repeat(600);
      assert.equal(cleanText(longString, 50).length, 50);
    });

    it('money should clamp negative numbers to 0 and round floats', () => {
      assert.equal(money(-500), 0);
      assert.equal(money(0), 0);
      assert.equal(money(299.75), 300);
      assert.equal(money(150.2), 150);
      assert.equal(money('4999'), 4999);
      assert.equal(money('invalid'), 0);
    });
  });

  describe('Promotions & Discounts Calculations', () => {
    it('should calculate percentage discount correctly', () => {
      const promo = { type: 'percentage', value: 20, min_subtotal: 0, max_discount: 0 };
      const discount = calculatePromoDiscount(promo, 5000);
      assert.equal(discount, 1000);
    });

    it('should cap percentage discount at max_discount limit', () => {
      const promo = { type: 'percentage', value: 25, min_subtotal: 0, max_discount: 1500 };
      // 25% of 10,000 = 2500, but capped at 1500
      const discount = calculatePromoDiscount(promo, 10000);
      assert.equal(discount, 1500);
    });

    it('should calculate fixed PKR discount correctly', () => {
      const promo = { type: 'fixed', value: 750, min_subtotal: 0, max_discount: 0 };
      const discount = calculatePromoDiscount(promo, 4000);
      assert.equal(discount, 750);
    });

    it('should not allow discount to exceed subtotal', () => {
      const promo = { type: 'fixed', value: 3000, min_subtotal: 0, max_discount: 0 };
      const discount = calculatePromoDiscount(promo, 2000);
      assert.equal(discount, 2000, 'Discount must not exceed subtotal');
    });

    it('should reject promo if order subtotal does not meet min_subtotal', () => {
      const promo = { type: 'percentage', value: 10, min_subtotal: 6000, max_discount: 0 };
      assert.throws(() => {
        calculatePromoDiscount(promo, 4500);
      }, /Minimum order subtotal/);
    });
  });

  describe('Delivery Fee Rules', () => {
    it('should charge PKR 350 for orders below PKR 10,000 net', () => {
      assert.equal(calculateDeliveryFee(5000, 0), 350);
      assert.equal(calculateDeliveryFee(9999, 0), 350);
      assert.equal(calculateDeliveryFee(10500, 1000), 350, 'Net subtotal 9500 is under 10k threshold');
    });

    it('should grant FREE delivery (PKR 0) for orders equal to or above PKR 10,000 net', () => {
      assert.equal(calculateDeliveryFee(10000, 0), 0);
      assert.equal(calculateDeliveryFee(15000, 0), 0);
      assert.equal(calculateDeliveryFee(12000, 2000), 0, 'Net subtotal 10000 qualifies for free delivery');
    });
  });

  describe('Pakistani Mobile Number Validator', () => {
    it('should accept valid 11-digit Pakistani mobile numbers starting with 03', () => {
      assert.ok(PAK_MOBILE_REGEX.test('03001234567'), '0300 Jazz');
      assert.ok(PAK_MOBILE_REGEX.test('03219876543'), '0321 Warid');
      assert.ok(PAK_MOBILE_REGEX.test('03451122334'), '0345 Telenor');
      assert.ok(PAK_MOBILE_REGEX.test('03335566778'), '0333 Ufone');
      assert.ok(PAK_MOBILE_REGEX.test('03129988776'), '0312 Zong');
      assert.ok(PAK_MOBILE_REGEX.test('03397055500'), '0339 Onic / HSS Official');
    });

    it('should reject invalid phone numbers', () => {
      assert.equal(PAK_MOBILE_REGEX.test('1234567890'), false, 'Random numbers');
      assert.equal(PAK_MOBILE_REGEX.test('04235881234'), false, 'Landline (042)');
      assert.equal(PAK_MOBILE_REGEX.test('+923001234567'), false, 'International prefix not allowed in 03 format');
      assert.equal(PAK_MOBILE_REGEX.test('0300123456'), false, 'Too short (10 digits)');
      assert.equal(PAK_MOBILE_REGEX.test('030012345678'), false, 'Too long (12 digits)');
      assert.equal(PAK_MOBILE_REGEX.test('0300abc4567'), false, 'Contains letters');
    });
  });
});
