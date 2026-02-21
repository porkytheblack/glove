import React, { useState } from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM, type CartOps } from "../theme";
import { formatPrice, GRIND_OPTIONS, type CartItem } from "../products";

// ─── checkout — full checkout form (pushAndWait) ────────────────────────────

const displaySchema = z.object({
  items: z.array(z.any()),
});

const resolveSchema = z.union([
  z.object({ grind: z.string(), email: z.string() }),
  z.null(),
]);

export function createCheckoutTool(cartOps: CartOps) {
  return defineTool({
    name: "checkout",
    description:
      "Present the checkout form with the current cart, grind selection, and email input. Blocks until the user submits or cancels. Only call when the user is ready to checkout.",
    inputSchema: z.object({}),
    displayPropsSchema: displaySchema,
    resolveSchema,
    unAbortable: true,
    displayStrategy: "hide-on-complete",
    async do(_input, display) {
      const cart = cartOps.get();
      if (cart.length === 0) return "Cannot checkout — the bag is empty.";

      const result = await display.pushAndWait({ items: cart });
      if (!result)
        return {
          status: "success" as const,
          data: "User cancelled checkout and wants to continue shopping.",
          renderData: { cancelled: true },
        };

      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      cartOps.clear();
      return {
        status: "success" as const,
        data: `Order placed! Grind: ${result.grind}. Cart cleared. Total items ordered: ${cart.length}.`,
        renderData: {
          grind: result.grind,
          email: result.email,
          items: cart,
          total,
        },
      };
    },
    render({ props, resolve }) {
      return (
        <CheckoutForm
          items={props.items as CartItem[]}
          onSubmit={resolve}
        />
      );
    },
    renderResult({ data }) {
      const result = data as
        | { cancelled: true }
        | { grind: string; email: string; items: CartItem[]; total: number };

      if ("cancelled" in result) {
        return (
          <div
            style={{
              padding: 16,
              background: CREAM[50],
              border: `1px solid ${SAGE[100]}`,
              marginTop: 12,
              maxWidth: 360,
            }}
          >
            <p
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                color: SAGE[400],
                margin: 0,
                fontStyle: "italic",
              }}
            >
              Checkout cancelled — continued shopping.
            </p>
          </div>
        );
      }

      return (
        <div
          style={{
            background: CREAM[50],
            border: `1px solid ${SAGE[100]}`,
            borderLeft: "3px solid #4ade80",
            padding: 16,
            marginTop: 12,
            maxWidth: 360,
          }}
        >
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: SAGE[900],
              margin: "0 0 8px",
            }}
          >
            Order Confirmed
          </p>
          {result.items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: SAGE[600],
              }}
            >
              <span>
                {item.name} x{item.qty}
              </span>
              <span style={{ fontFamily: "'DM Mono', monospace" }}>
                {formatPrice(item.price * item.qty)}
              </span>
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${SAGE[100]}`,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: SAGE[500],
              }}
            >
              Grind: {result.grind}
            </div>
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: SAGE[500],
              }}
            >
              Confirmation: {result.email}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 4,
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                fontWeight: 600,
                color: SAGE[900],
              }}
            >
              <span>Total</span>
              <span>{formatPrice(result.total)}</span>
            </div>
          </div>
        </div>
      );
    },
  });
}

// ─── CheckoutForm ────────────────────────────────────────────────────────────

function CheckoutForm({
  items,
  onSubmit,
}: {
  items: CartItem[];
  onSubmit: (value: { grind: string; email: string } | null) => void;
}) {
  const [grind, setGrind] = useState("Whole Bean");
  const [email, setEmail] = useState("");

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = subtotal > 4000 ? 0 : 500;
  const total = subtotal + shipping;

  return (
    <div
      style={{
        background: CREAM[50],
        border: `1px solid ${SAGE[100]}`,
        padding: 24,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 20,
            fontWeight: 400,
            color: SAGE[900],
            margin: 0,
          }}
        >
          Your Bag
        </h3>
        <button
          onClick={() => onSubmit(null)}
          style={{
            background: "none",
            border: "none",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: SAGE[400],
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Continue shopping
        </button>
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 0",
            borderBottom: `1px solid ${SAGE[50]}`,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
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
                marginLeft: 8,
              }}
            >
              x{item.qty}
            </span>
          </div>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: SAGE[700],
            }}
          >
            {formatPrice(item.price * item.qty)}
          </span>
        </div>
      ))}

      {/* Grind selector */}
      <div style={{ marginTop: 20 }}>
        <label
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SAGE[500],
            display: "block",
            marginBottom: 8,
          }}
        >
          Grind
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {GRIND_OPTIONS.map((g) => (
            <button
              key={g}
              onClick={() => setGrind(g)}
              style={{
                padding: "6px 14px",
                background: grind === g ? SAGE[900] : "transparent",
                color: grind === g ? CREAM[50] : SAGE[600],
                border: `1px solid ${grind === g ? SAGE[900] : SAGE[200]}`,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Email input */}
      <div style={{ marginTop: 20 }}>
        <label
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SAGE[500],
            display: "block",
            marginBottom: 8,
          }}
        >
          Email for order confirmation
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: `1px solid ${SAGE[200]}`,
            background: "white",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: SAGE[900],
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = SAGE[500];
          }}
          onBlur={(e) => {
            e.target.style.borderColor = SAGE[200];
          }}
        />
      </div>

      {/* Totals */}
      <div
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: `1px solid ${SAGE[100]}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: SAGE[500],
            }}
          >
            Shipping
          </span>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: shipping === 0 ? SAGE[400] : SAGE[700],
            }}
          >
            {shipping === 0 ? "Free" : formatPrice(shipping)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px solid ${SAGE[100]}`,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 15,
              fontWeight: 600,
              color: SAGE[900],
            }}
          >
            Total
          </span>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 15,
              fontWeight: 600,
              color: SAGE[900],
            }}
          >
            {formatPrice(total)}
          </span>
        </div>
      </div>

      {/* Place order button */}
      <button
        onClick={() => onSubmit({ grind, email })}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "14px",
          background: SAGE[900],
          color: CREAM[50],
          border: "none",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "background 0.2s ease",
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.background = SAGE[700];
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.background = SAGE[900];
        }}
      >
        Place Order — {formatPrice(total)}
      </button>

      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: SAGE[300],
          textAlign: "center",
          marginTop: 12,
          marginBottom: 0,
        }}
      >
        Roasted within 24hrs · Ships in 48hrs · Free shipping over $40
      </p>
    </div>
  );
}
