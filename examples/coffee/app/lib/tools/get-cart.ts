import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { formatPrice } from "../products";
import type { CartOps } from "../theme";

// ─── get_cart — voice-friendly cart lookup (no display) ─────────────────────
//
// Returns full cart breakdown as text so the LLM can narrate contents,
// item names, quantities, and totals during voice conversations.
// Unlike show_cart (which renders a visual card), this returns
// structured text the LLM can speak directly.

export function createGetCartTool(cartOps: CartOps): ToolConfig {
  return {
    name: "get_cart",
    description:
      "Look up the current shopping bag contents and return them as text. Use this in voice mode instead of show_cart.",
    inputSchema: z.object({}),
    async do() {
      const cart = cartOps.get();

      if (cart.length === 0) {
        return { status: "success" as const, data: "The bag is empty." };
      }

      const lines = cart.map(
        (item) => `• ${item.name} x${item.qty} — ${formatPrice(item.price * item.qty)}`,
      );
      const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const totalItems = cart.reduce((s, i) => s + i.qty, 0);

      return {
        status: "success" as const,
        data: `${totalItems} item(s) in bag:\n${lines.join("\n")}\nSubtotal: ${formatPrice(subtotal)}`,
      };
    },
  };
}
