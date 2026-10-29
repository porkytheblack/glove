import { MemoryStore } from "glove-core";
import { z } from "zod";
import { defineAgent } from "../../../../src/index.js";
import { ScriptedModel, log } from "../../delegation-scripted.js";

export default defineAgent({
  description: "Refunds only after a person agrees",
  systemPrompt: "You refund payments only after a person approves the exact amount.",
  store: ({ conversationId }) => new MemoryStore(`approval:${conversationId}`),
  model: () => new ScriptedModel(
    (text) => {
      if (text.includes("denied") || text.includes("Do not call") || text.includes("not approved")) {
        return { say: "not approved" };
      }
      if (text.includes("refund") || text.includes("approved")) {
        return { call: "refund_payment", input: { amount: 80 } };
      }
      return { say: "ok" };
    },
    () => "refunded",
  ),
  tools: [{
    name: "refund_payment",
    description: "Refund a captured payment",
    inputSchema: z.object({ amount: z.number() }),
    requiresPermission: true,
    async do(input: { amount: number }) {
      log("refunded", { amount: input.amount });
      return { status: "success" as const, data: { refunded: input.amount } };
    },
  }],
});
