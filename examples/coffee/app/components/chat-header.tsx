import React from "react";
import type { CartItem } from "../lib/products";
import { CoffeeIcon } from "./icons";
import { CartBadge } from "./cart-badge";

// ─── Chat header ────────────────────────────────────────────────────────────

interface ChatHeaderProps {
  cart: CartItem[];
  stats: { turns: number; tokens_in: number; tokens_out: number };
}

export function ChatHeader({ cart, stats }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="header-brand">
        <div className="header-logo">
          <CoffeeIcon color="#fefdfb" size={16} />
        </div>
        <div>
          <div className="header-title">Glove Coffee</div>
          <div className="header-subtitle">Direct from origin</div>
        </div>
      </div>
      <div className="header-right">
        <CartBadge cart={cart} />
        {stats.turns > 0 && (
          <span className="header-stats">
            {stats.turns} turns ·{" "}
            {stats.tokens_in + stats.tokens_out} tokens
          </span>
        )}
        <div className="online-badge">
          <div className="online-dot" />
          <span className="online-text">Online</span>
        </div>
      </div>
    </header>
  );
}
