import { MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { composeAgent, defineAgent } from "glove-foundry";
import currentTime from "./tools/current-time.tool.js";

/**
 * The file path is the identity: this is the agent `assistant`.
 *
 * Every field may be a value or a function; a function is called per run with
 * the request context. Add capabilities as sibling files — `tools/*.tool.ts`,
 * `apps/*.app.ts`, `memory/*.memory.ts` — and compose them below.
 */
export default defineAgent({
  description: "A general-purpose Glove assistant",
  components: composeAgent(currentTime),
  store: ({ conversationId }) => new MemoryStore(`assistant:${conversationId}`),
  model: () => createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
    stream: true,
  }),
  systemPrompt: (_agent, { message, history }) => [
    "You are a precise, practical assistant.",
    `Current request: ${message.text}`,
    `Prior messages: ${history.length}`,
  ].join("\n"),
  compactionInstructions: () => "Preserve decisions, open work, and important context.",
});
