import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from './pricing.js';

const cart = {
  items: [
    { sku: 'A', unitPriceCents: 1250, quantity: 2 },
    { sku: 'B', unitPriceCents: 500, quantity: 1 },
  ],
};

test('applyDiscount returns the unchanged subtotal for zero discount', () => {
  assert.equal(applyDiscount(cart, 0), 3000);
});

test('applyDiscount applies a percentage discount', () => {
  assert.equal(applyDiscount(cart, 10), 2700);
});

test('applyDiscount rejects invalid percentages', () => {
  assert.throws(() => applyDiscount(cart, -1), RangeError);
  assert.throws(() => applyDiscount(cart, 101), RangeError);
});
