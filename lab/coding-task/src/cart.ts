export type CartItem = {
  sku: string;
  unitPriceCents: number;
  quantity: number;
};

export type Cart = {
  items: CartItem[];
};

export function subtotalCents(cart: Cart): number {
  return cart.items.reduce(
    (total, item) => total + item.unitPriceCents * item.quantity,
    0,
  );
}
