import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents } from "glove-foundry";
import { makeBot, writesVia } from "../lib/connect.js";
import { chatWith } from "../lib/people.js";

// Sign a person up on a running Foundry: their first bot, starred as their
// Primary Bot, and its chat, with any apps they already connected. The bot
// asks what it is for and names itself. Make more bots the same way (up to
// 50); connect apps with `pnpm connect`.
//   pnpm onboard ada "Ada"

const [id = "ada", name = "Ada"] = process.argv.slice(2);
const person = { id, name };
// Bind the file-derived ids (bot, gmail…) so the imported values work here too.
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4143",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "onboard", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});

const created = await makeBot(writesVia.client(foundry), person, { id: `${id}-bot-1`, starred: true });
const chat = await foundry.createConversation(created.id, chatWith(created.id));
const hello = await foundry.send(created.id, chat.id, `Hi, I'm ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Set up ${name}: their first bot (${created.id}) is asking what it is for. Connect apps with: pnpm connect ${id} gmail`);
