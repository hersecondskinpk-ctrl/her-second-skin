'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Import HSSState and HSSRouter
const HSSState = require('../../js/state.js');
const HSSRouter = require('../../js/router.js');

describe('HSSState - Unit Tests', () => {

  beforeEach(() => {
    HSSState.cart.clear();
  });

  describe('Cart Operations', () => {
    it('should initialize with an empty cart', () => {
      assert.deepEqual(HSSState.cart.get(), []);
      assert.equal(HSSState.cart.count(), 0);
      assert.equal(HSSState.cart.total(), 0);
    });

    it('should add a single item to cart', () => {
      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '34',
        color: 'Burgundy',
        cupSize: 'B',
        qty: 1
      });

      const items = HSSState.cart.get();
      assert.equal(items.length, 1);
      assert.equal(items[0].id, 'prod-1');
      assert.equal(items[0].name, 'Lace Bralette');
      assert.equal(items[0].price, 2500);
      assert.equal(items[0].size, '34');
      assert.equal(items[0].color, 'Burgundy');
      assert.equal(items[0].cupSize, 'B');
      assert.equal(items[0].qty, 1);
      assert.equal(items[0].selected, true);

      assert.equal(HSSState.cart.count(), 1);
      assert.equal(HSSState.cart.total(), 2500);
    });

    it('should increment quantity when adding the exact same variant', () => {
      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '34',
        color: 'Burgundy',
        cupSize: 'B',
        qty: 1
      });

      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '34',
        color: 'Burgundy',
        cupSize: 'B',
        qty: 2
      });

      const items = HSSState.cart.get();
      assert.equal(items.length, 1, 'Should not duplicate cart line item');
      assert.equal(items[0].qty, 3);
      assert.equal(HSSState.cart.count(), 3);
      assert.equal(HSSState.cart.total(), 7500);
    });

    it('should treat different variants as separate line items', () => {
      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '34',
        color: 'Burgundy',
        cupSize: 'B',
        qty: 1
      });

      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '36', // different size
        color: 'Burgundy',
        cupSize: 'C',
        qty: 1
      });

      const items = HSSState.cart.get();
      assert.equal(items.length, 2);
      assert.equal(HSSState.cart.count(), 2);
      assert.equal(HSSState.cart.total(), 5000);
    });

    it('should update line item quantity with delta', () => {
      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        size: '34',
        color: 'Burgundy',
        qty: 2
      });

      // Increment
      HSSState.cart.updateQty(0, 1);
      assert.equal(HSSState.cart.get()[0].qty, 3);

      // Decrement
      HSSState.cart.updateQty(0, -1);
      assert.equal(HSSState.cart.get()[0].qty, 2);
    });

    it('should remove line item if quantity is decremented to 0 or below', () => {
      HSSState.cart.add({
        id: 'prod-1',
        name: 'Lace Bralette',
        price: 2500,
        qty: 1
      });

      HSSState.cart.updateQty(0, -1);
      assert.equal(HSSState.cart.get().length, 0);
      assert.equal(HSSState.cart.count(), 0);
    });

    it('should remove item by index', () => {
      HSSState.cart.add({ id: 'p1', name: 'Item 1', price: 1000, qty: 1 });
      HSSState.cart.add({ id: 'p2', name: 'Item 2', price: 2000, qty: 1 });

      HSSState.cart.remove(0);
      const items = HSSState.cart.get();
      assert.equal(items.length, 1);
      assert.equal(items[0].id, 'p2');
    });

    it('should support selection toggles and selected-only total calculation', () => {
      HSSState.cart.add({ id: 'p1', name: 'Item 1', price: 1000, qty: 1 });
      HSSState.cart.add({ id: 'p2', name: 'Item 2', price: 2000, qty: 2 });

      assert.equal(HSSState.cart.total(false), 5000);
      assert.equal(HSSState.cart.total(true), 5000);

      // Deselect second item
      HSSState.cart.setSelected(1, false);
      assert.equal(HSSState.cart.total(false), 5000);
      assert.equal(HSSState.cart.total(true), 1000);

      // Select all
      HSSState.cart.selectAll(true);
      assert.equal(HSSState.cart.total(true), 5000);
    });
  });

  describe('Stock Masking (Privacy & Urgency Rules)', () => {
    it('should return Out of Stock for <= 0 units', () => {
      const res0 = HSSState.stock.mask(0);
      assert.equal(res0.inStock, false);
      assert.equal(res0.label, 'Currently Out of Stock');
      assert.equal(res0.badgeClass, 'out');

      const resNeg = HSSState.stock.mask(-2);
      assert.equal(resNeg.inStock, false);
      assert.equal(resNeg.label, 'Currently Out of Stock');
    });

    it('should display urgency warning when stock is between 1 and 5', () => {
      const res1 = HSSState.stock.mask(1);
      assert.equal(res1.inStock, true);
      assert.equal(res1.label, 'Only 1 left in stock!');
      assert.equal(res1.badgeClass, 'low');

      const res3 = HSSState.stock.mask(3);
      assert.equal(res3.inStock, true);
      assert.equal(res3.label, 'Only 3 left in stock!');
      assert.equal(res3.badgeClass, 'low');

      const res5 = HSSState.stock.mask(5);
      assert.equal(res5.inStock, true);
      assert.equal(res5.label, 'Only 5 left in stock!');
      assert.equal(res5.badgeClass, 'low');
    });

    it('should mask stock to generic "In Stock" when units > 5 (never leaking real count)', () => {
      const res6 = HSSState.stock.mask(6);
      assert.equal(res6.inStock, true);
      assert.equal(res6.label, 'In Stock');
      assert.equal(res6.badgeClass, 'ok');
      assert.equal(res6.label.includes('6'), false, 'Must not leak quantity 6');

      const res50 = HSSState.stock.mask(50);
      assert.equal(res50.inStock, true);
      assert.equal(res50.label, 'In Stock');
      assert.equal(res50.badgeClass, 'ok');
      assert.equal(res50.label.includes('50'), false, 'Must not leak wholesale supplier quantity 50');
    });
  });

  describe('WhatsApp Order Formatter', () => {
    it('should format order message with items and standard 350 PKR delivery fee for orders under 10k', () => {
      const order = {
        customerName: 'Ayesha Khan',
        phone: '03001234567',
        address: 'House 12, Street 4, F-7/2, Islamabad',
        city: 'Islamabad',
        subtotal: 4500,
        deliveryFee: 350,
        items: [
          { name: 'Satin Silk Nightwear Set', size: 'M', color: 'Dusty Rose', qty: 1, price: 4500 }
        ]
      };

      const msg = HSSState.whatsapp.buildMessage(order);
      assert.ok(msg.includes('Ayesha Khan'), 'Customer name included');
      assert.ok(msg.includes('03001234567'), 'Phone included');
      assert.ok(msg.includes('Satin Silk Nightwear Set'), 'Product name included');
      assert.ok(msg.includes('PKR 4,500'), 'Item subtotal included');
      assert.ok(msg.includes('PKR 350'), 'Standard delivery fee included');
      assert.ok(msg.includes('PKR 4,850'), 'Total with delivery fee included');
    });

    it('should offer FREE delivery for orders equal to or above PKR 10,000', () => {
      const order = {
        customerName: 'Fatima Ali',
        phone: '03219876543',
        address: 'Gulberg III, Lahore',
        city: 'Lahore',
        subtotal: 11000,
        deliveryFee: 0,
        items: [
          { name: 'Luxury Bridal Set', size: '36B', color: 'White', qty: 2, price: 5500 } // Subtotal: 11,000
        ]
      };

      const msg = HSSState.whatsapp.buildMessage(order);
      assert.ok(msg.includes('Fatima Ali'), 'Customer name included');
      assert.ok(msg.includes('PKR 0'), 'Delivery fee is 0');
      assert.ok(msg.includes('PKR 11,000'), 'Total is 11,000');
    });
  });
});

describe('HSSRouter - Unit Tests', () => {
  it('should clean legacy .html URLs to modern clean routes', () => {
    assert.equal(HSSRouter.cleanUrl('bras.html'), 'bras');
    assert.equal(HSSRouter.cleanUrl('product.html?id=123'), 'product?id=123');
    assert.equal(HSSRouter.cleanUrl('/sets.html'), '/sets');
    assert.equal(HSSRouter.cleanUrl('admin.html'), 'admin');
    assert.equal(HSSRouter.cleanUrl(''), '/');
    assert.equal(HSSRouter.cleanUrl(null), '/');
  });
});
