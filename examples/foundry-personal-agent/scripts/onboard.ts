import { fileURLToPath } from "node:url";
import { createFoundryClient, discoverAgents, install } from "glove-foundry";
import muse from "../agents/muse/agent.js";
import whatsappApp from "../agents/muse/apps/whatsapp.app.js";
import { museNumber } from "../agents/muse/topology.js";
import { giveAccounts, whatsappFor, writesVia } from "../lib/connect.js";
import { channel, museFor } from "../lib/people.js";

// Sign a person up on a running Foundry: their Muse, its app and WhatsApp
// conversations, WhatsApp on their number, and any apps they already
// connected (read only until they choose more). Connect apps with `pnpm connect`.
// The last argument, if given, is what they call their agent.
//   pnpm onboard sam "Sam" 15550109999 Juniper

const [id = "sam", name = "Sam", phone, agentName] = process.argv.slice(2);
const person = { id, name, ...(phone ? { phone } : {}), ...(agentName ? { agentName } : {}) };
// Bind the file-derived ids (muse, gmail…) so the imported values work here too.
await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4149",
  ...(process.env.FOUNDRY_TOKEN ? { authorization: { identifier: "onboard", headers: () => ({ authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` }) } } : {}),
});

const created = await foundry.createAgent(muse.id, museFor(person));
await giveAccounts(writesVia.client(foundry), created.id, person);
if (phone) {
  const whatsapp = whatsappFor(created.id, { id, phone });
  await foundry.install(created.id, install(whatsappApp, undefined, { account: museNumber }));
  await foundry.putRoute(whatsapp.out);
  await foundry.putBinding(whatsapp.binding);
}
await foundry.createConversation(created.id, channel(created.id, "whatsapp"));
const app = await foundry.createConversation(created.id, channel(created.id, "app"));
const hello = await foundry.send(created.id, app.id, `Hi, I'm ${name}.`);
await hello.wait({ timeoutMs: 120_000 });
console.log(`Set up ${name}'s ${agentName ?? "Muse"} (${created.id})${phone ? ` with WhatsApp on ${phone}` : ""}. Connect apps with: pnpm connect ${id} gmail read`);
