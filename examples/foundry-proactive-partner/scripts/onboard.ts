import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents } from "glove-foundry";
import computer from "../agents/computer/agent.js";
import partner from "../agents/partner/agent.js";
import { giveAccounts, writesVia } from "../lib/connect.js";
import { computerFor, partnerFor, threadFor } from "../lib/onboarding.js";

// Sign a person up: their partner, the computer it hands long jobs to, their
// one thread, and a first message so the brief and check-ins are on their
// clock. Connect their Gmail and Calendar with `pnpm connect`.
//   pnpm onboard ada "Ada" America/New_York

const [id = "ada", name = "Ada", timezone = "UTC"] = process.argv.slice(2);
// Bind the file-derived ids (partner, gmail…) so the imported values work here too.
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4147",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "onboard", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});

const person = { id, name, timezone };
const created = await foundry.createAgent(partner.id, partnerFor(person));
await giveAccounts(writesVia.client(foundry), created.id, person);
await foundry.createAgent(computer.id, computerFor(person));
const thread = await foundry.createConversation(created.id, threadFor(person));
const hello = await foundry.send(created.id, thread.id, `Hi, I'm ${name}. Keep an eye on things for me.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Signed up ${name}: partner ${created.id}, thread ${thread.id}, clock in ${timezone}. Connect apps with: pnpm connect ${id} gmail`);
