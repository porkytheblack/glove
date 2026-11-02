import { defineAgent } from "glove-foundry";
import { textModel } from "../../lib/models.js";

export default defineAgent({
  description: "A persistent researcher with a generous work deadline",
  model: textModel,
  runTimeoutMs: 4 * 60 * 60 * 1000,
  maxConcurrentRuns: 1,
  answerWaitMs: 30_000,
  eventDelivery: { whenIdle: "wake" },
  systemPrompt: `Research the requested question using search_documents and read_document.
Search first and use the exact document IDs returned. Never invent document IDs.
Cite document IDs; these are fictional demo briefs, not facts about real vendors.
Read inherited personal context to respect the user's preferences. Do not change it.
For a delegated task, ask glove_foundry_ask if blocked; your final answer returns automatically.
For a direct message, use glove_foundry_message to notify parent when appropriate.
If the message includes a parent conversation ID, set delivery.conversationId to that exact ID.
Keep unsolicited findings brief. Do not bounce acknowledgments back and forth.`,
});
