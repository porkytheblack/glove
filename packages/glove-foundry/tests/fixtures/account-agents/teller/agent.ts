import { MemoryStore } from "glove-core";
import { composeAgent, defineAgent } from "../../../../src/index.js";
import notes from "./apps/notes.app.js";

export default defineAgent({
  description: "Reads its installed app's account session",
  components: composeAgent(notes),
  store: ({ conversationId }) => new MemoryStore(conversationId),
  accountSessions: {
    identifier: "fixture-sessions",
    withSession: (request, use) => use({ token: `token-for-${request.accountId}`, operation: request.operation }),
  },
  run: async (agent) => {
    const whoami = agent.tools.find((tool) => tool.name === "whoami");
    return whoami ? (await whoami.run({}, undefined, undefined) as { data: unknown }).data : "not installed";
  },
});
