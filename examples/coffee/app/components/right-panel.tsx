"use client";

import React from "react";
import { formatPrice, type CartItem } from "../lib/products";
import type { TimelineEntry } from "glove-react";
import { BagIcon } from "./icons";

interface OrderData {
  grind: string;
  email: string;
  items: CartItem[];
  total: number;
}

interface RightPanelProps {
  cart: CartItem[];
  timeline: TimelineEntry[];
  stats: { turns: number; tokens_in: number; tokens_out: number };
}

export function RightPanel({ cart, timeline, stats }: RightPanelProps) {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shipping = subtotal > 4000 ? 0 : 500;

  // Extract completed orders from the current session's timeline
  const orders = timeline
    .filter(
      (e): e is Extract<TimelineEntry, { kind: "tool" }> =>
        e.kind === "tool" &&
        e.name === "checkout" &&
        e.status === "success" &&
        e.renderData !== undefined,
    )
    .map((e) => e.renderData as OrderData | { cancelled: true })
    .filter((d): d is OrderData => !("cancelled" in d));

  return (
    <aside className="right-panel">
      {/* ── Cart section ─────────────────────────────────── */}
      <div className="rp-section">
        <div className="rp-section-header">
          <BagIcon color="#3d5a3d" />
          <span className="rp-section-title">Your Bag</span>
          {totalItems > 0 && (
            <span className="rp-badge">{totalItems}</span>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="rp-empty">
            <p>Your bag is empty</p>
            <p className="rp-empty-hint">
              Ask the barista to help you find the perfect beans
            </p>
          </div>
        ) : (
          <>
            <div className="rp-items">
              {cart.map((item) => (
                <div key={item.id} className="rp-item">
                  <div className="rp-item-info">
                    <span className="rp-item-name">{item.name}</span>
                    <span className="rp-item-meta">
                      {item.origin} · {item.weight}
                    </span>
                  </div>
                  <div className="rp-item-right">
                    <span className="rp-item-qty">x{item.qty}</span>
                    <span className="rp-item-price">
                      {formatPrice(item.price * item.qty)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="rp-totals">
              <div className="rp-total-row">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="rp-total-row">
                <span>Shipping</span>
                <span className={shipping === 0 ? "rp-free" : ""}>
                  {shipping === 0 ? "Free" : formatPrice(shipping)}
                </span>
              </div>
              <div className="rp-total-row rp-total-final">
                <span>Total</span>
                <span>{formatPrice(subtotal + shipping)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Order History section ─────────────────────────── */}
      <div className="rp-section">
        <div className="rp-section-header">
          <CheckIcon />
          <span className="rp-section-title">Orders</span>
          {orders.length > 0 && (
            <span className="rp-badge">{orders.length}</span>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="rp-empty">
            <p>No orders yet</p>
            <p className="rp-empty-hint">
              Completed orders will appear here
            </p>
          </div>
        ) : (
          <div className="rp-orders">
            {orders.map((order, idx) => (
              <div key={idx} className="rp-order">
                <div className="rp-order-header">
                  <span className="rp-order-label">
                    Order #{orders.length - idx}
                  </span>
                  <span className="rp-order-total">
                    {formatPrice(order.total)}
                  </span>
                </div>
                <div className="rp-order-items">
                  {order.items.map((item) => (
                    <span key={item.id} className="rp-order-item">
                      {item.name} x{item.qty}
                    </span>
                  ))}
                </div>
                <div className="rp-order-meta">
                  {order.grind} grind
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats footer ──────────────────────────────── */}
      {stats.turns > 0 && (
        <div className="rp-footer">
          <span className="rp-stats">
            {stats.turns} turns · {stats.tokens_in + stats.tokens_out} tokens
          </span>
        </div>
      )}
    </aside>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#3d5a3d"
      strokeWidth="2"
    >
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
