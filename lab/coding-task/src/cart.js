export function subtotalCents(cart) {
  return cart.items.reduce(
    (total, item) => total + item.unitPriceCents * item.quantity,
    0,
  );
}
