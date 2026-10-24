import { createFoundryClient } from "glove-foundry/client";
import { teamFor } from "../lib/team.js";

// Create a person's team on a running Foundry: their assistant and its two
// workers, in the person's own workspace.
//   pnpm tsx scripts/onboard.ts maya "Maya"

const [id = "maya", name = "Maya"] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4142" });
const team = teamFor({ id, name });
await foundry.createAgent(team.assistant.definition, team.assistant.options);
for (const worker of team.workers) await foundry.createAgent(worker.definition, worker.options);
console.log(`Created ${name}'s team: ${[team.assistant, ...team.workers].map((agent) => `${agent.options.name} (${agent.options.id})`).join(", ")}.`);
