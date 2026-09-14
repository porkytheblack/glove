import { MemoryStore, createAdapter } from "glove-core";
import { defineAgent } from "glove-foundry";
import { Effect } from "effect";
import { executeCampaignBatch } from "../../lib/campaign-runtime.js";
import { normalizeCampaignBatch } from "../../lib/campaigns.js";

export default defineAgent({
  description: "Durable campaign-batch coordinator for Braind Storm workforce runs.",
  tags: ["braind-storm", "campaigns", "orchestration", "parallel", "sequential"],
  store: ({ conversationId }) => new MemoryStore(`braind:campaign-orchestrator:${conversationId}`),
  model: () => createAdapter({
    provider: "gemini",
    model: process.env.BRAIND_TEXT_MODEL ?? "gemini-3.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
    stream: false,
  }),
  systemPrompt: "You are the headless Braind Storm campaign coordinator. Execution is handled by the typed run function.",
  run: (_agent, context) => Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => normalizeCampaignBatch(context.request.payload),
      catch: (cause) => new Error(`Invalid campaign batch: ${cause instanceof Error ? cause.message : String(cause)}`),
    });
    return yield* executeCampaignBatch(input, context);
  }),
});
