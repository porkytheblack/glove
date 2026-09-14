import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
  defineApplication,
} from "glove-foundry";
import { RACERS } from "./lib/racers.js";

const instances = RACERS.map((racer) =>
  createAgentInstance(racer.definitionId, {
    id: racer.agentId,
    workspaceId: "drag-strip",
    context: { racerId: racer.id, paddock: "foundry-night" },
  }),
);
const conversations = instances.map((instance, index) =>
  createConversation(instance, {
    id: RACERS[index]!.conversationId,
    title: `${RACERS[index]!.nickname} paddock call`,
    context: { channel: "voice", persistent: true },
  }),
);

export const data = new MemoryFoundryDataAdapter({
  identifier: "drag-racer-demo-data",
  agents: instances,
  conversations,
});

export default defineApplication({
  name: "Foundry Drag Racer Calls",
  data,
  conversationStore: ({ conversationId }) =>
    import("glove-core").then(({ MemoryStore }) => new MemoryStore(`foundry-racer:${conversationId}`)),
});
