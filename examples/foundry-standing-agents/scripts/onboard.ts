import { createFoundryClient } from "glove-foundry/client";
import { CHANNELS, builderFor, primaryDot } from "../lib/dot.js";

// Give a person their primary dot on a running Foundry: their builder, the dot
// with the name they chose, its app conversation, and a first message there
// so its research schedule and Slack playbook are set. Route names are used
// here because this talks to Foundry over HTTP.
//   pnpm tsx scripts/onboard.ts ada "Ada" Juniper U0123456789

const [ownerId = "ada", owner = "Ada", name = "Juniper", slackUserId] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145" });

const builder = builderFor(ownerId);
if (!(await foundry.agentInstances("builder")).some((item) => item.id === builder.id)) {
  await foundry.createAgent("builder", builder);
}
const dot = await foundry.createAgent("dot", primaryDot(ownerId, {
  name,
  owner,
  responsibilities: [{
    job: "Track product feedback from #feedback and the support inbox, and group the reports.",
    sources: ["#feedback", "support inbox"],
    attention: "A problem several people report, or anything that blocks a customer.",
    mustNot: `Reply to anyone without ${owner}'s approval.`,
  }],
  rules: { reply_to_customer: "ask", open_draft_pr: "allow", merge_pr: "block" },
  routing: { progress: "app", decisions: "slack" },
  ...(slackUserId ? { slackUserId } : {}),
}));
const app = await foundry.createConversation(dot.id, {
  id: `${dot.id}-app`,
  title: CHANNELS.app.title,
  context: { conversationKey: CHANNELS.app.key },
});
const hello = await foundry.send(dot.id, app.id, `Hi, I'm ${owner}. I've named you ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Created ${name} (${dot.id}) for ${owner}: app conversation ${app.id}.`);
