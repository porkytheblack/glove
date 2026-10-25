import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import builder from "./agents/builder/agent.js";
import dot from "./agents/dot/agent.js";
import { slackBot, slackMessagesIn } from "./agents/dot/topology.js";
import { requestAuthorization } from "./lib/authorization.js";
import { CHANNELS, SAM, builderFor, primaryDot } from "./lib/dot.js";
import { dataPath } from "./lib/paths.js";

/** Sam's dot, Pip, and his builder: agents are data, seeded from the definitions they are instances of. */
export const samsDot = defineAgentInstance(dot, primaryDot(SAM.id, SAM.dot));
export const samsBuilder = defineAgentInstance(builder, builderFor(SAM.id));

/** Pip's conversation in the app. Slack gets its own when Sam first messages there. */
export const samsApp = createConversation(samsDot, {
  id: `${samsDot.id}-app`,
  title: CHANNELS.app.title,
  context: { conversationKey: CHANNELS.app.key },
});

/**
 * Dots, builders, their conversations, schedules, mesh threads and computers
 * live in `.data/foundry.json`. Seeds are written only when their id is new;
 * everyone else's dot is created at runtime (scripts/onboard.ts).
 */
export const data = new FileFoundryDataAdapter({
  file: dataPath("foundry.json"),
  agents: [samsDot, samsBuilder],
  conversations: [samsApp],
});

export default defineApplication({
  name: "Standing agents",
  data,
  accounts: [slackBot],
  routes: [slackMessagesIn],
  bindings: [],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});
