import test from 'node:test';
import assert from 'node:assert/strict';
import { subtotalCents } from './cart.js';

const cart = {
  items: [
    { sku: 'A', unitPriceCents: 1250, quantity: 2 },
    { sku: 'B', unitPriceCents: 500, quantity: 1 },
  ],
};

test('subtotalCents calculates the cart subtotal', () => {
  assert.equal(subtotalCents(cart), 3000);
});

test('subtotalCents does not mutate the cart', () => {
  const before = structuredClone(cart);
  subtotalCents(cart);
  assert.deepEqual(cart, before);
});
