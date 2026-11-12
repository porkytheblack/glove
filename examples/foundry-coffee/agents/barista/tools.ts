import type { GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";
import { addLine, describeBag, removeLine, totals, EMPTY_BAG, type Order } from "../../lib/bag.js";
import { readBag, readOrders, writeBag, writeOrders } from "../../lib/bag-data.js";
import { GRIND_OPTIONS, PRODUCTS, formatPrice, getProductById, type Product } from "../../lib/catalog.js";
import { voiceTurn } from "./voice.js";

// The barista's tools. They run in Foundry, not in the browser: the web app
// sees each call as a run event and draws the matching card, and reads the
// bag back from the shop's workspace.

const productIds = PRODUCTS.map((p) => p.id);
const productId = z.string().describe(`A product id: ${productIds.join(", ")}`);

const describe = (p: Product): string =>
  `${p.name} (${p.id}): ${p.origin}, ${p.roast} roast, ${formatPrice(p.price)} for ${p.weight}. ` +
  `Notes: ${p.notes.join(", ")}. Intensity ${p.intensity}/10. ${p.stock > 0 ? `${p.stock} in stock` : "OUT OF STOCK"}. ${p.description}`;

const unknown = (id: string) => ({
  status: "error" as const,
  data: null,
  message: `There is no product "${id}". Ids: ${productIds.join(", ")}.`,
});

export function baristaTools(ctx: AgentAssemblyContext): GloveFoldArgs<any>[] {
  const { data, workspaceId, conversationId } = ctx;
  const voice = voiceTurn(ctx.request);

  const tools: GloveFoldArgs<any>[] = [
    {
      name: "show_products",
      description:
        'Put product cards on the customer\'s screen and get the same details back as text. Pass the ids to show, or ["all"] for the whole catalogue.',
      inputSchema: z.object({
        product_ids: z.array(z.string()).min(1).describe(`Product ids, or ["all"]. Ids: ${productIds.join(", ")}`),
        note: z.string().optional().describe("A short line shown above the cards"),
      }),
      async do({ product_ids }: { product_ids: string[] }) {
        const shown = product_ids.includes("all") ? PRODUCTS : PRODUCTS.filter((p) => product_ids.includes(p.id));
        if (shown.length === 0) return unknown(product_ids.join(", "));
        return { status: "success" as const, data: shown.map(describe).join("\n") };
      },
    },
    {
      name: "show_product_detail",
      description: "Show one coffee in full on the customer's screen and get its details back as text.",
      inputSchema: z.object({ product_id: productId }),
      async do({ product_id }: { product_id: string }) {
        const product = getProductById(product_id);
        return product ? { status: "success" as const, data: describe(product) } : unknown(product_id);
      },
    },
    {
      name: "add_to_cart",
      description: "Add a coffee to the bag. Returns the bag afterwards.",
      inputSchema: z.object({
        product_id: productId,
        quantity: z.number().int().min(1).max(20).default(1),
        for: z.string().optional().describe("Who it is for, when several people are ordering: their name, or their label such as \"Speaker A\""),
      }),
      async do(input: { product_id: string; quantity?: number; for?: string }) {
        const product = getProductById(input.product_id);
        if (!product) return unknown(input.product_id);
        if (product.stock <= 0) {
          return { status: "error" as const, data: null, message: `${product.name} is out of stock. Suggest another coffee.` };
        }
        const bag = addLine(await readBag(data, workspaceId, conversationId), product.id, input.quantity ?? 1, input.for?.trim() || undefined);
        await writeBag(data, workspaceId, conversationId, bag);
        return { status: "success" as const, data: `Added ${input.quantity ?? 1} x ${product.name}.\n${describeBag(bag)}` };
      },
    },
    {
      name: "remove_from_cart",
      description: "Take a coffee out of the bag: all of it, or `quantity` of it. Returns the bag afterwards.",
      inputSchema: z.object({
        product_id: productId,
        quantity: z.number().int().min(1).optional(),
        for: z.string().optional().describe("Only the line for this person"),
      }),
      async do(input: { product_id: string; quantity?: number; for?: string }) {
        if (!getProductById(input.product_id)) return unknown(input.product_id);
        const before = await readBag(data, workspaceId, conversationId);
        const bag = removeLine(before, input.product_id, input.quantity, input.for?.trim() || undefined);
        await writeBag(data, workspaceId, conversationId, bag);
        const changed = totals(before).count !== totals(bag).count;
        return { status: "success" as const, data: `${changed ? "Removed." : "That was not in the bag."}\n${describeBag(bag)}` };
      },
    },
    {
      name: "get_cart",
      description: "Read what is in the bag, with totals.",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: describeBag(await readBag(data, workspaceId, conversationId)) };
      },
    },
    {
      name: "show_info",
      description: "Show a short card on the customer's screen: a sourcing note, a brewing tip, or an order confirmation.",
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        variant: z.enum(["info", "tip", "success"]).default("info"),
      }),
      async do() {
        return { status: "success" as const, data: "Shown." };
      },
    },
    {
      name: "checkout",
      description:
        "Place the order for everything in the bag. The customer is asked to confirm on screen before anything happens; if they decline, nothing is ordered.",
      inputSchema: z.object({
        grind: z.enum(GRIND_OPTIONS),
        name: z.string().optional().describe("A name for the order"),
        email: z.string().optional().describe("Where to send the receipt, if they gave one"),
      }),
      // Foundry stores this call as an approval and holds the run until the
      // customer answers it in the web app.
      requiresPermission: true,
      async do(input: { grind: string; name?: string; email?: string }) {
        const bag = await readBag(data, workspaceId, conversationId);
        if (bag.lines.length === 0) {
          return { status: "error" as const, data: null, message: "The bag is empty, so there is nothing to order." };
        }
        const orders = await readOrders(data, workspaceId, conversationId);
        const order: Order = {
          // Keyed on the run, so a retried run cannot place the order twice.
          id: `order-${ctx.runId}`,
          lines: bag.lines,
          ...totals(bag),
          grind: input.grind,
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          placedAt: new Date().toISOString(),
        };
        if (!orders.some((placed) => placed.id === order.id)) {
          await writeOrders(data, workspaceId, conversationId, [...orders, order]);
        }
        await writeBag(data, workspaceId, conversationId, EMPTY_BAG);
        return {
          status: "success" as const,
          data: `Order placed: ${describeBag({ lines: order.lines })}\nGrind: ${order.grind}.`,
        };
      },
    },
  ];

  // Only when the voice pipeline is telling speakers apart.
  if (voice.speakers.length > 0) {
    tools.push({
      name: "name_speaker",
      description:
        "Record the name a speaker gave, so their lines are labelled with it from now on. Use the label you see in brackets.",
      inputSchema: z.object({
        speaker: z.string().describe('Their current label, e.g. "Speaker A"'),
        name: z.string().describe("The name they gave"),
      }),
      async do({ speaker, name }: { speaker: string; name: string }) {
        const known = voice.speakers.some((s) => s.label === speaker || s.name === speaker);
        if (!known) {
          return {
            status: "error" as const,
            data: null,
            message: `No speaker is labelled "${speaker}". Labels: ${voice.speakers.map((s) => s.label).join(", ")}.`,
          };
        }
        // The labels are kept by the voice pipeline in the customer's
        // browser. The web app follows this run's events and applies the name.
        ctx.controls.emit({ type: "coffee.speaker_named", data: { speaker, name } });
        return { status: "success" as const, data: { speaker, name } };
      },
    });
  }

  return tools;
}
