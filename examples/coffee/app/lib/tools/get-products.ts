import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { formatPrice, getProductsByIds } from "../products";

// ─── get_products — voice-friendly product lookup (no display) ──────────────
//
// Returns product details as structured text so the LLM can narrate them
// during voice conversations. Unlike show_products (which blocks on a
// clickable carousel), this is non-blocking and returns immediately.

export function createGetProductsTool(): ToolConfig {
  return {
    name: "get_products",
    description:
      'Look up product details and return them as text. Use this in voice mode instead of show_products. Pass product_ids as an array of IDs or ["all"] for the full catalog. Available IDs: ethiopian-yirgacheffe, colombian-huila, kenyan-aa, sumatra-mandheling, guatemala-antigua, rwanda-kivu',
    inputSchema: z.object({
      product_ids: z
        .array(z.string())
        .describe('Array of product IDs to look up, or ["all"] for everything'),
    }),
    async do(input) {
      const ids = (input as { product_ids: string[] }).product_ids;
      const products = getProductsByIds(ids.includes("all") ? "all" : ids);

      if (products.length === 0) {
        return { status: "error" as const, data: "No products found for the given IDs." };
      }

      const lines = products.map(
        (p) =>
          `• ${p.name} (${p.id}): ${p.origin}, ${p.roast} roast, ${formatPrice(p.price)}/${p.weight}. Notes: ${p.notes.join(", ")}. Intensity: ${p.intensity}/10. ${p.description}`,
      );

      return {
        status: "success" as const,
        data: lines.join("\n"),
      };
    },
  };
}
