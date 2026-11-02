import { composeAgent, defineAgent, restrictApp } from "glove-foundry";
import researcher from "../researcher/agent.js";
import personal from "./personal.memory.js";
import library from "./library.app.js";
import { searchDocuments } from "./tools.js";
import { frontModel, textModel } from "../../lib/models.js";
import { FileStore } from "../../lib/file-store.js";
import { isLiveStart, runFront } from "./live.js";

export default defineAgent({
  description: "A responsive realtime front with an owned durable researcher",
  components: composeAgent(personal, library),
  memory: [personal],
  tools: [searchDocuments],
  model: (_definition, ctx) => isLiveStart(ctx.request) ? frontModel() : textModel(),
  runTimeoutMs: 35 * 60 * 1000,
  eventDelivery: { whenIdle: "wake" },
  durableSubagents: {
    research: {
      agent: researcher,
      // This slot overrides the reusable researcher's default.
      eventDelivery: { whenIdle: "defer", deferTimeoutMs: 30_000 },
      inherit: {
        context: true,
        tools: ["search_documents"],
        memory: { scope: "shared", access: "reader", profiles: ["personal"] },
        apps: [restrictApp(library, {
          tools: ["read_document"], operations: [], transmissions: [],
        })],
      },
      // Shared parent memory and workspace notes are not owned by the worker.
      cleanup: async ({ conversationIds }) => {
        for (const id of conversationIds) await FileStore.remove(id);
      },
    },
  },
  systemPrompt: (_definition, ctx) => `You are the user's realtime research assistant.
Your conversation ID is ${ctx.conversationId}.
Keep responding while research works. Use glove_foundry_delegate(to="research")
for tracked work; results and questions return to this conversation automatically.
Answer worker questions with glove_foundry_reply, or ask the user first.
Use glove_foundry_message for spontaneous updates, not tasks. Include this parent
conversation ID in direct messages when you want a reply here. Use delivery.whenIdle="wake"
for urgent messages; ordinary updates may wait for the worker's next turn.
When sending to research, omit delivery.conversationId to use its default conversation.
Your own conversation ID belongs in the message content as a reply address, not in
the outgoing delivery target. Set delivery.conversationId only to a known recipient-owned ID.
Never report completion before a result arrives. Treat source events as external information.`,
  run: runFront,
});
