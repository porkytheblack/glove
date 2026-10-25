import { createFoundryClient } from "glove-foundry/client";
import { MAIN_THREAD, mainBotFor, type AppName } from "../lib/people.js";

// Set up a person's account on a running Foundry: their main bot and its
// thread, with the apps they connected. Over HTTP, definitions and apps are
// named by their routes ("bot", "gmail"), the ids Foundry derives from the
// file names; inside the runtime, use the imported values instead.
//   pnpm tsx scripts/onboard.ts ada "Ada" 1234567890

const [id = "ada", name = "Ada", xUserId] = process.argv.slice(2);
const person = { id, name, ...(xUserId ? { xUserId } : {}) };
const apps: AppName[] = ["gmail", "sheets"];
const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4143" });

const { installations: _apps, ...mainBot } = mainBotFor(person, { name: "Main", apps: [] });
const created = await foundry.createAgent("bot", mainBot);
for (const app of apps) await foundry.install(created.id, { kind: "application", id: app });
if (xUserId) await foundry.install(created.id, { kind: "application", id: "x", accountId: "x-bot" });

await foundry.createConversation(created.id, { id: `${id}-main-thread`, title: MAIN_THREAD.title, context: { conversationKey: MAIN_THREAD.key } });
const hello = await foundry.send(created.id, `${id}-main-thread`, `Hi, I'm ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Set up ${name}: main bot ${created.name} (${created.id}) with ${apps.join(", ")}${xUserId ? " and @bot on X" : ""}.`);
