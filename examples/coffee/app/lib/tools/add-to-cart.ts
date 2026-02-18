import type { ToolConfig } from "glove-react";
import { z } from "zod";
import type { CartOps } from "../theme";
import { formatPrice, getProductById } from "../products";

// ─── add_to_cart — pure tool, updates cart state (no render) ────────────────

export function createAddToCartTool(cartOps: CartOps): ToolConfig {
  return {
    name: "add_to_cart",
    description:
      "Add a product to the user's shopping bag. Returns confirmation with updated cart total. Use this after the user confirms they want a product.",
    inputSchema: z.object({
      product_id: z.string().describe("The product ID to add"),
      quantity: z
        .number()
        .optional()
        .default(1)
        .describe("Quantity to add (default 1)"),
    }),
    async do(input) {
      const { product_id, quantity } = input as {
        product_id: string;
        quantity: number;
      };
      const product = getProductById(product_id);
      if (!product)
        return { status: "error" as const, data: "Product not found." };

      cartOps.add(product_id, quantity);
      const cart = cartOps.get();
      const totalItems = cart.reduce((s, i) => s + i.qty, 0);
      const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
      return {
        status: "success" as const,
        data: `Added ${quantity}x ${product.name} to bag. Cart: ${totalItems} item(s), ${formatPrice(totalPrice)}.`,
      };
    },
  };
}
