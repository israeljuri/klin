import assert from 'node:assert/strict';
import test from 'node:test';
import { orderTotalCents } from './checkout.js';

test('orderTotalCents calculates the final checkout amount after discount and tax', () => {
  const cart = {
    items: [
      { sku: 'LAPTOP', unitPriceCents: 10000, quantity: 1 },
      { sku: 'MOUSE', unitPriceCents: 2500, quantity: 2 },
    ],
  };

  // 15,000 subtotal -> 10% discount = 13,500 -> 7.5% tax = 14,512.5, rounded to 14,513.
  assert.equal(orderTotalCents(cart, 10, 7.5), 14513);
});

test('orderTotalCents does not mutate the cart', () => {
  const cart = {
    items: [{ sku: 'A', unitPriceCents: 999, quantity: 2 }],
  };
  const before = structuredClone(cart);

  orderTotalCents(cart, 5, 10);

  assert.deepEqual(cart, before);
});

test('orderTotalCents supports zero discount and zero tax', () => {
  const cart = {
    items: [{ sku: 'A', unitPriceCents: 1250, quantity: 2 }],
  };

  assert.equal(orderTotalCents(cart, 0, 0), 2500);
});
