import { stationDaemon } from "glove-foundry/station";
import { createResources } from "./lib/resources.js";
import { writeState } from "./lib/state.js";
import { port, workerId } from "./lib/settings.js";
import { defineApplication, FileFoundryDataAdapter } from "glove-foundry";
import { join } from "node:path";
import { stateDir } from "./lib/settings.js";
import { ConversationStore } from "./lib/store.js";
export default defineApplication({
  name: "Operator",
  daemon: stationDaemon({
    stationId: workerId,
    name: "Operator",
    port: port + 1,
    resources: createResources,
    onReady: connection => writeState("worker-client.json", connection),
  }),
  data: new FileFoundryDataAdapter({ file: join(stateDir, "foundry.json") }),
  conversationStore: ({ conversationId }) => ConversationStore.open(conversationId),
});
