import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents } from "glove-foundry";
import bot from "../agents/bot/agent.js";
import { giveAccounts, writesVia } from "../lib/connect.js";
import { MAIN_THREAD, mainBotFor } from "../lib/people.js";

// Sign a person up on a running Foundry: their main bot and its thread, with
// any apps they already connected. Connect more with `pnpm connect`.
//   pnpm onboard ada "Ada"

const [id = "ada", name = "Ada"] = process.argv.slice(2);
const person = { id, name };
// Bind the file-derived ids (bot, gmail…) so the imported values work here too.
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4143",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "onboard", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});

const created = await foundry.createAgent(bot.id, mainBotFor(person, { name: "Main" }));
await giveAccounts(writesVia.client(foundry), created.id, person);
await foundry.createConversation(created.id, { id: `${id}-main-thread`, title: MAIN_THREAD.title, context: { conversationKey: MAIN_THREAD.key } });
const hello = await foundry.send(created.id, `${id}-main-thread`, `Hi, I'm ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Set up ${name}: main bot ${created.name} (${created.id}). Connect apps with: pnpm connect ${id} gmail`);
