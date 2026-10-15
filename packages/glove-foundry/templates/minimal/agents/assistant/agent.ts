import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";

/**
 * The file path is the identity: this is the agent `assistant`.
 *
 * Every field may be a value or a function; a function is called per run with
 * the request context. Each run executes in its own process, so state that must
 * outlive one message — like the conversation below — lives on disk.
 */
export default defineAgent({
  description: "A general-purpose Glove assistant",
  model: () => createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
    stream: true,
  }),

  // Durable history: without it the assistant forgets the previous message.
  store: ({ conversationId }) => FileStore.open(conversationId),

  systemPrompt: (_agent, { history }) => [
    "You are a precise, practical assistant.",
    `Prior messages in this conversation: ${history.length}.`,
  ].join("\n"),

  // Tools listed here are on every instance of this agent. To make a tool
  // installable per instance instead, put it in tools/<name>.tool.ts with
  // defineSharedTool, add it to composeAgent(...), and install it (see README).
  tools: [{
    name: "current_time",
    description: "Return the current ISO timestamp",
    inputSchema: z.object({}),
    async do() {
      return { status: "success", data: new Date().toISOString() };
    },
  }],

  compactionInstructions: () => "Preserve decisions, open work, and important context.",
});
