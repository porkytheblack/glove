import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents } from "glove-foundry";
import builderDefinition from "../agents/builder/agent.js";
import dotDefinition from "../agents/dot/agent.js";
import { giveAccounts, writesVia } from "../lib/connect.js";
import { CHANNELS, builderFor, primaryDot } from "../lib/dot.js";

// Give a person their primary dot on a running Foundry: their builder, the dot
// with the name they chose and any apps they connected, its app conversation,
// and a first message there so its research schedule and playbooks are set.
// Connect their Gmail with `pnpm connect`.
//   pnpm onboard ada "Ada" Juniper U0123456789

const [ownerId = "ada", owner = "Ada", name = "Juniper", slackUserId] = process.argv.slice(2);
// Bind the file-derived ids (dot, builder, slack…) so the imported values work here too.
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "onboard", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});

const builder = builderFor(ownerId);
if (!(await foundry.agentInstances(builderDefinition.id)).some((item) => item.id === builder.id)) {
  await foundry.createAgent(builderDefinition.id, builder);
}
const dot = await foundry.createAgent(dotDefinition.id, primaryDot(ownerId, {
  name,
  owner,
  responsibilities: [{
    job: "Track product feedback from #feedback and the support inbox, and group the reports.",
    sources: ["#feedback", "support inbox"],
    attention: "A problem several people report, or anything that blocks a customer.",
    mustNot: `Reply to anyone without ${owner}'s approval.`,
  }],
  rules: { send_email: "ask", open_draft_pr: "allow", merge_pr: "block" },
  routing: { progress: "app", decisions: "slack" },
  ...(slackUserId ? { slackUserId } : {}),
}));
await giveAccounts(writesVia.client(foundry), dot.id, { id: ownerId });
const app = await foundry.createConversation(dot.id, {
  id: `${dot.id}-app`,
  title: CHANNELS.app.title,
  context: { conversationKey: CHANNELS.app.key },
});
const hello = await foundry.send(dot.id, app.id, `Hi, I'm ${owner}. I've named you ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Created ${name} (${dot.id}) for ${owner}: app conversation ${app.id}.`);
