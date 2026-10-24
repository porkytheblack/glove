import { createFoundryClient } from "glove-foundry/client";
import { partnerFor, threadFor } from "../lib/onboarding.js";

// Connect a person: their partner, their one thread, and a first message so
// the brief and check-ins are on their clock.
//   pnpm tsx scripts/onboard.ts ada "Ada" America/New_York

const [id = "ada", name = "Ada", timezone = "UTC"] = process.argv.slice(2);
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4147" });

const person = { id, name, timezone };
const partner = await foundry.createAgent("partner", partnerFor(person));
const thread = await foundry.createConversation(partner.id, threadFor(person));
const hello = await foundry.send(partner.id, thread.id, `Hi, I'm ${name}. Keep an eye on things for me.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Connected ${name}: partner ${partner.id}, thread ${thread.id}, clock in ${timezone}.`);
