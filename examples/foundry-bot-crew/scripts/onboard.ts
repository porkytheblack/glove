import { createFoundryClient } from "glove-foundry/client";
import { MAIN_THREAD, botFor, chiefFor } from "../lib/people.js";

// Set up a person's account on a running Foundry: their Chief, its main
// thread, and one blank bot waiting to be told its job.
//   pnpm tsx scripts/onboard.ts maya "Maya" 1234567890

const [id = "maya", name = "Maya", xUserId] = process.argv.slice(2);
const person = { id, name, ...(xUserId ? { xUserId } : {}) };
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4143" });

const chief = await foundry.createAgent("bot", chiefFor(person));
await foundry.createConversation(chief.id, { id: `${id}-main`, title: MAIN_THREAD.title, context: { conversationKey: MAIN_THREAD.key } });
const hello = await foundry.send(chief.id, `${id}-main`, `Hi, I'm ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
const fresh = await foundry.createAgent("bot", botFor(person, { id: `${id}-bot-1`, apps: ["gmail", "sheets"] }));
console.log(`Set up ${name}: ${chief.name} (${chief.id}) and a new bot (${fresh.id}) waiting for its job.`);
