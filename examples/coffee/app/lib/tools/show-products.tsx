import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM, type CartOps } from "../theme";
import { formatPrice, getProductById, getProductsByIds, type Product } from "../products";
import { IntensityBar } from "./shared";

// ─── show_products — product carousel (pushAndWait) ─────────────────────────

const inputSchema = z.object({
  product_ids: z
    .array(z.string())
    .describe(
      'Array of product IDs to show. Use ["all"] to show the full catalog. Available IDs: ethiopian-yirgacheffe, colombian-huila, kenyan-aa, sumatra-mandheling, guatemala-antigua, rwanda-kivu',
    ),
  prompt: z
    .string()
    .optional()
    .describe("Optional text shown above the products"),
});

const resolveSchema = z.object({
  productId: z.string(),
  action: z.enum(["select", "add"]),
});

export function createShowProductsTool(cartOps: CartOps) {
  return defineTool({
    name: "show_products",
    description:
      'Display a carousel of coffee products for the user to browse and select from. Blocks until the user picks a product. Pass product_ids as an array of IDs or "all" for the full catalog.',
    inputSchema,
    displayPropsSchema: inputSchema,
    resolveSchema,
    displayStrategy: "hide-on-complete",
    async do(input, display) {
      const selected = await display.pushAndWait(input);
      const product = getProductById(selected.productId);
      if (!product) return "Product not found.";

      const resultText =
        selected.action === "add"
          ? (() => {
              cartOps.add(selected.productId);
              const cart = cartOps.get();
              const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
              return `User added ${product.name} to their bag. Cart now has ${cart.length} item(s), total ${formatPrice(total)}.`;
            })()
          : `User selected ${product.name} (${product.origin}, ${product.roast} roast, ${formatPrice(product.price)}).`;

      return {
        status: "success" as const,
        data: resultText,
        renderData: {
          productId: selected.productId,
          action: selected.action,
          productName: product.name,
          price: product.price,
        },
      };
    },
    render({ props, resolve }) {
      const resolvedIds = props.product_ids.includes("all")
        ? ("all" as const)
        : props.product_ids;
      const products = getProductsByIds(resolvedIds);

      return (
        <div style={{ marginTop: 12 }}>
          {props.prompt && (
            <p
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                color: SAGE[500],
                margin: "0 0 8px",
                fontStyle: "italic",
              }}
            >
              {props.prompt}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 8,
              scrollbarWidth: "none",
            }}
          >
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSelect={() =>
                  resolve({ productId: product.id, action: "select" })
                }
                onAdd={() =>
                  resolve({ productId: product.id, action: "add" })
                }
              />
            ))}
          </div>
        </div>
      );
    },
    renderResult({ data }) {
      const { action, productName, price } = data as {
        action: string;
        productName: string;
        price: number;
      };
      return (
        <div
          style={{
            padding: 16,
            background: CREAM[50],
            border: `1px solid ${SAGE[100]}`,
            marginTop: 12,
            maxWidth: 360,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: action === "add" ? "#4ade80" : SAGE[400],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: SAGE[700],
            }}
          >
            {action === "add" ? "Added" : "Selected"}{" "}
            <strong>{productName}</strong>
            {" — "}
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: SAGE[500],
              }}
            >
              {formatPrice(price)}
            </span>
          </span>
        </div>
      );
    },
  });
}

// ─── ProductCard ─────────────────────────────────────────────────────────────

function ProductCard({
  product,
  onSelect,
  onAdd,
}: {
  product: Product;
  onSelect: () => void;
  onAdd: () => void;
}) {
  return (
    <div
      style={{
        background: CREAM[50],
        border: `1px solid ${SAGE[100]}`,
        padding: 0,
        cursor: "pointer",
        transition: "all 0.25s ease",
        overflow: "hidden",
        flex: "0 0 auto",
        width: 220,
        minWidth: 220,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = SAGE[300];
        (e.currentTarget as HTMLDivElement).style.transform =
          "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = SAGE[100];
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      <div
        style={{
          height: 80,
          background:
            product.roast === "Dark"
              ? `linear-gradient(135deg, ${SAGE[800]}, ${SAGE[950]})`
              : product.roast === "Medium"
                ? `linear-gradient(135deg, ${SAGE[500]}, ${SAGE[700]})`
                : `linear-gradient(135deg, ${SAGE[200]}, ${SAGE[400]})`,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 16px 10px",
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color:
              product.roast === "Dark" || product.roast === "Medium"
                ? CREAM[100]
                : SAGE[800],
            opacity: 0.8,
          }}
        >
          {product.origin}
        </span>
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <h3
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 20,
              fontWeight: 400,
              color: SAGE[900],
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {product.name}
          </h3>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: SAGE[600],
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            {formatPrice(product.price)}
          </span>
        </div>
        <div
          style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}
        >
          {product.notes.map((note) => (
            <span
              key={note}
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: SAGE[500],
                background: SAGE[50],
                padding: "3px 8px",
                border: `1px solid ${SAGE[100]}`,
              }}
            >
              {note}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                color: SAGE[400],
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Intensity
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                color: SAGE[400],
              }}
            >
              {product.roast}
            </span>
          </div>
          <IntensityBar level={product.intensity} />
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${SAGE[100]}`,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            style={{
              flex: 1,
              padding: "9px 0",
              background: "transparent",
              color: SAGE[700],
              border: `1px solid ${SAGE[200]}`,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = SAGE[700];
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = SAGE[200];
            }}
          >
            Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            style={{
              flex: 1,
              padding: "9px 0",
              background: SAGE[900],
              color: CREAM[50],
              border: "none",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.05em",
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
            Add to bag
          </button>
        </div>
      </div>
    </div>
  );
}
