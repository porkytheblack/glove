import type { ToolConfig } from "glove-react";
import type { CartOps } from "../theme";
import { createAskPreferenceTool } from "./ask-preference";
import { createShowProductsTool } from "./show-products";
import { createShowProductDetailTool } from "./show-product-detail";
import { createAddToCartTool } from "./add-to-cart";
import { createShowCartTool } from "./show-cart";
import { createCheckoutTool } from "./checkout";
import { createShowInfoTool } from "./show-info";

// ─── Tool factory — assembles all 7 coffee tools ───────────────────────────

export function createCoffeeTools(cartOps: CartOps): ToolConfig[] {
  return [
    createAskPreferenceTool(),
    createShowProductsTool(cartOps),
    createShowProductDetailTool(),
    createAddToCartTool(cartOps),
    createShowCartTool(cartOps),
    createCheckoutTool(cartOps),
    createShowInfoTool(),
  ];
}

export type { CartOps } from "../theme";
