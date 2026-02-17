import React from "react";
import type { SlotRenderProps, ToolConfig } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM, type CartOps } from "../theme";
import { formatPrice, type CartItem } from "../products";

// ─── show_cart — cart summary (pushAndForget) ───────────────────────────────

export function createShowCartTool(cartOps: CartOps): ToolConfig {
  return {
    name: "show_cart",
    description:
      "Display the current shopping bag contents as a summary card. Non-blocking.",
    inputSchema: z.object({}),
    async do(_input, display) {
      const cart = cartOps.get();
      if (cart.length === 0) return "The bag is empty.";
      await display.pushAndForget({ input: { items: cart } });
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      return `Displayed cart: ${cart.length} item(s), ${formatPrice(total)}.`;
    },
    render({ data }: SlotRenderProps) {
      const { items } = data as { items: CartItem[] };
      if (!items || items.length === 0) return null;
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const shipping = subtotal > 4000 ? 0 : 500;

      return (
        <div
          style={{
            background: CREAM[50],
            border: `1px solid ${SAGE[100]}`,
            padding: 16,
            marginTop: 12,
            maxWidth: 360,
          }}
        >
          <h4
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 16,
              fontWeight: 400,
              color: SAGE[900],
              margin: "0 0 12px",
            }}
          >
            Your Bag
          </h4>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: `1px solid ${SAGE[50]}`,
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 13,
                    fontWeight: 500,
                    color: SAGE[900],
                  }}
                >
                  {item.name}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 12,
                    color: SAGE[400],
                    marginLeft: 6,
                  }}
                >
                  x{item.qty}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  color: SAGE[700],
                }}
              >
                {formatPrice(item.price * item.qty)}
              </span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 12,
              paddingTop: 8,
              borderTop: `1px solid ${SAGE[100]}`,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                color: SAGE[500],
              }}
            >
              Subtotal
            </span>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                color: SAGE[700],
              }}
            >
              {formatPrice(subtotal)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: SAGE[400],
              }}
            >
              Shipping
            </span>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: shipping === 0 ? SAGE[400] : SAGE[600],
              }}
            >
              {shipping === 0 ? "Free" : formatPrice(shipping)}
            </span>
          </div>
        </div>
      );
    },
  };
}
