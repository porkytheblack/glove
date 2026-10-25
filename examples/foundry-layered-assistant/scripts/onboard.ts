import { createFoundryClient } from "glove-foundry/client";
import { teamFor } from "../lib/team.js";

// Create a person's team on a running Foundry: their assistant and its two
// workers, in the person's own workspace. Over HTTP the kind of agent is its
// route; the records are the same data foundry.application.ts seeds.
//   pnpm tsx scripts/onboard.ts ada "Ada"

const [id = "ada", name = "Ada"] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4142" });
const team = teamFor({ id, name });
await foundry.createAgent("assistant", team.assistant);
await foundry.createAgent("coder", team.coder);
await foundry.createAgent("researcher", team.researcher);
console.log(`Created ${name}'s team: ${[team.assistant, team.coder, team.researcher].map((agent) => `${agent.name} (${agent.id})`).join(", ")}.`);
