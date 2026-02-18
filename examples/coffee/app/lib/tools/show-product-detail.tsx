import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { SAGE, CREAM } from "../theme";
import { formatPrice, getProductById } from "../products";
import { IntensityBar } from "./shared";

// ─── show_product_detail — expanded product card (pushAndForget) ────────────

const inputSchema = z.object({
  product_id: z.string().describe("The product ID to show details for"),
});

function ProductDetailCard({ productId }: { productId: string }) {
  const product = getProductById(productId);
  if (!product) return null;

  return (
    <div
      style={{
        background: CREAM[50],
        border: `1px solid ${SAGE[100]}`,
        padding: 0,
        marginTop: 12,
        overflow: "hidden",
        maxWidth: 360,
      }}
    >
      <div
        style={{
          height: 60,
          background:
            product.roast === "Dark"
              ? `linear-gradient(135deg, ${SAGE[800]}, ${SAGE[950]})`
              : product.roast === "Medium"
                ? `linear-gradient(135deg, ${SAGE[500]}, ${SAGE[700]})`
                : `linear-gradient(135deg, ${SAGE[200]}, ${SAGE[400]})`,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 16px 8px",
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
          {product.origin} · {product.roast} Roast
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
            }}
          >
            {product.name}
          </h3>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: SAGE[600],
            }}
          >
            {formatPrice(product.price)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 10,
            flexWrap: "wrap",
          }}
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
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            lineHeight: 1.6,
            color: SAGE[600],
            margin: "14px 0 0",
            paddingTop: 14,
            borderTop: `1px solid ${SAGE[100]}`,
          }}
        >
          {product.description}
        </p>
      </div>
    </div>
  );
}

export function createShowProductDetailTool() {
  return defineTool({
    name: "show_product_detail",
    description:
      "Display a detailed product card with full description, tasting notes, and intensity. Non-blocking — the card stays visible in the chat.",
    inputSchema,
    displayPropsSchema: inputSchema,
    async do(input, display) {
      const product = getProductById(input.product_id);
      if (!product) return "Product not found.";
      await display.pushAndForget(input);
      return {
        status: "success" as const,
        data: `Displayed details for ${product.name}: ${product.description}`,
        renderData: { product_id: input.product_id },
      };
    },
    render({ props }) {
      return <ProductDetailCard productId={props.product_id} />;
    },
    renderResult({ data }) {
      const { product_id } = data as { product_id: string };
      return <ProductDetailCard productId={product_id} />;
    },
  });
}
