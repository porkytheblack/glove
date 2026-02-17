import React from "react";
import { formatPrice, type CartItem } from "../lib/products";
import { BagIcon } from "./icons";

// ─── Cart badge ─────────────────────────────────────────────────────────────

export function CartBadge({ cart }: { cart: CartItem[] }) {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce(
    (sum, item) => sum + item.price * item.qty,
    0,
  );

  if (totalItems === 0) return null;

  return (
    <div className="cart-badge">
      <BagIcon />
      <span className="cart-count">
        {totalItems} {totalItems === 1 ? "item" : "items"}
      </span>
      <span className="cart-total">{formatPrice(totalPrice)}</span>
    </div>
  );
}
