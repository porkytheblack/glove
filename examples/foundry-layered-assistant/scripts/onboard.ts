import { createFoundryClient } from "glove-foundry/client";
import { assistantFor } from "../lib/team.js";

// Create a person's assistant on a running Foundry, in the person's own
// workspace. Over HTTP the kind of agent is its route; the record is the same
// data foundry.application.ts seeds. Its workers come on the first task.
//   pnpm tsx scripts/onboard.ts ada "Ada"

const [id = "ada", name = "Ada"] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4142" });
const assistant = await foundry.createAgent("assistant", assistantFor({ id, name }));
console.log(`Created ${name}'s assistant: ${assistant.name} (${assistant.id}).`);
