import { FileFoundryDataAdapter, createConversation, defineAgentInstance, defineApplication } from "glove-foundry";
import builder from "./agents/builder/agent.js";
import dot from "./agents/dot/agent.js";
import { slackBot, slackMessagesIn } from "./agents/dot/topology.js";
import { readAccount, saveAccount, servicesWith } from "./lib/accounts.js";
import { requestAuthorization } from "./lib/authorization.js";
import { accountFor, gmailRoutes, installationFor, sampleConnection, sendBinding } from "./lib/connect.js";
import { CHANNELS, SAM, builderFor, primaryDot } from "./lib/dot.js";
import { dataPath } from "./lib/paths.js";

/**
 * The support mailbox Sam connected for Pip, as a sample account. Saved once,
 * like the seeds; connecting the real mailbox under the same id replaces it.
 */
const samsGmail = accountFor({ id: SAM.id }, "gmail", sampleConnection({ id: SAM.id }, "gmail").identity, true);
if (!(await readAccount(samsGmail.id))) await saveAccount(samsGmail, sampleConnection({ id: SAM.id }, "gmail").tokens);

/** Sam's dot, Pip, and his builder: agents are data, seeded from the definitions they are instances of. */
export const samsDot = defineAgentInstance(dot, primaryDot(SAM.id, SAM.dot, [installationFor(samsGmail)]));
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

const mailRoutes = gmailRoutes(samsGmail.id);

export default defineApplication({
  name: "Standing agents",
  data,
  // Connected accounts from your store, plus the Slack bot user, which is the
  // app's own. Routes and bindings written when someone connects are kept in
  // .data/topology.json.
  services: servicesWith([slackBot]),
  routes: [slackMessagesIn, mailRoutes.in, mailRoutes.out],
  bindings: [sendBinding(samsDot.id, samsGmail.id)],
  ...(requestAuthorization ? { requestAuthorization } : {}),
});
