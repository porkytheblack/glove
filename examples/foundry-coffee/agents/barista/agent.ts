import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { baristaModel } from "../../lib/models.js";
import { baristaPrompt } from "./prompt.js";
import { baristaTools } from "./tools.js";
import { voiceTurn } from "./voice.js";

/**
 * The shop's barista. One definition; the shop it works for is the instance
 * (see foundry.application.ts), and each customer is a conversation.
 *
 * This file only assembles. The prompt, tools and voice handling live beside it.
 */
export default defineAgent({
  description: "Helps a customer choose, bag and order coffee beans, typed or spoken",

  model: () => baristaModel(),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: (_agent, ctx) => baristaPrompt(String(ctx.agentInstance.context.shop ?? ctx.agentInstance.name ?? "the shop"), voiceTurn(ctx.request)),
  tools: (_agent, ctx) => baristaTools(ctx),

  // Who is speaking, for this request only: read by the model with the turn
  // and never saved to the conversation.
  contextProviders: (_agent, ctx) => voiceTurn(ctx.request).context.map((note) => () => note),

  // A customer-facing agent: no schedules, spawns or workspace tools.
  builtins: { allow: [] },
});
