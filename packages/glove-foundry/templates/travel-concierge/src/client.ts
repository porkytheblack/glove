/**
 * A typed client for this project's agents. `FoundryRoutes` is generated into
 * .foundry/routes.d.ts on every `glove foundry dev`, so `agent("concierge")`
 * is checked against the files that actually exist.
 *
 * Run with: npx tsx src/client.ts (while `pnpm dev` is running)
 */
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

const agent = await foundry.agent("concierge").create({
  workspaceId: "demo",
  context: { budgetUsd: 2_500 },
});
const conversation = await foundry.createConversation(agent.id);
const run = await foundry.send(agent.id, conversation.id, "I want to fly from Lisbon to Nairobi in April.");

console.log(`run ${run.id} -> http://127.0.0.1:4141/runs/${run.id}`);
const completed = await run.wait();
console.log(completed.output);
