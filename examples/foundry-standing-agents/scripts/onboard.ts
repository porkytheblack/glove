import { createFoundryClient } from "glove-foundry/client";
import { CHANNELS, builderFor, dotFor } from "../lib/dot.js";

// Create a feedback dot for a person: their builder, the dot, its app
// conversation, and a first message there so its research schedule and Slack
// playbook are set.
//   pnpm tsx scripts/onboard.ts sam "Sam" U0123456789

const [ownerId = "sam", owner = "Sam", slackUserId] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4145" });

const builder = builderFor(ownerId);
if (!(await foundry.agentInstances("builder")).some((item) => item.id === builder.id)) {
  await foundry.createAgent("builder", builder);
}
const dot = await foundry.createAgent("dot", dotFor(ownerId, {
  name: "feedback",
  owner,
  responsibility: {
    job: "Track product feedback from #feedback and the support inbox, and group the reports.",
    sources: ["#feedback", "support inbox"],
    attention: "A problem several people report, or anything that blocks a customer.",
    mustNot: "Reply to anyone.",
  },
  rules: { reply_to_customer: "ask", open_draft_pr: "on-request", merge_pr: "hand-off" },
  routing: { progress: "app", decisions: "slack" },
  ...(slackUserId ? { slackUserId } : {}),
}));
const app = await foundry.createConversation(dot.id, {
  id: `${dot.id}-app`,
  title: CHANNELS.app.title,
  context: { conversationKey: CHANNELS.app.key },
});
const hello = await foundry.send(dot.id, app.id, `Hi, I'm ${owner}. You're my feedback dot.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Created ${dot.id} for ${owner}: app conversation ${app.id}.`);
