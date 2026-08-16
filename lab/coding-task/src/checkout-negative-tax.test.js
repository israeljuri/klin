import assert from 'node:assert/strict';
import test from 'node:test';
import { orderTotalCents } from './checkout.js';

test('orderTotalCents rejects a negative tax rate', () => {
  const cart = {
    items: [{ sku: 'A', unitPriceCents: 1000, quantity: 1 }],
  };

  assert.throws(() => orderTotalCents(cart, 10, -1), RangeError);
});
