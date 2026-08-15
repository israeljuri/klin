import type { Cart } from './cart.js';
import { subtotalCents } from './cart.js';

export function applyDiscount(cart: Cart, discountPercent: number): number {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new RangeError('discountPercent must be between 0 and 100');
  }

  const subtotal = subtotalCents(cart);
  return Math.round(subtotal * (1 - discountPercent / 100));
}
