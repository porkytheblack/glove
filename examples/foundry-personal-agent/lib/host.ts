import { fileURLToPath } from "node:url";
import { discoverAgents, installedApplicationTransmissionToolName } from "glove-foundry";
import gmailApp from "../agents/muse/apps/gmail.app.js";
import whatsappApp from "../agents/muse/apps/whatsapp.app.js";
import gmail from "../agents/muse/transmissions/gmail.transmission.js";
import whatsapp from "../agents/muse/transmissions/whatsapp.transmission.js";

// The host functions the web app's server calls (app/server/host.ts). Next
// loads this file with Node instead of bundling it, so discovery binds the
// file-derived ids (the gmail app, its transmission…) on the same modules the
// functions below use, the way scripts/onboard.ts does.

await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });

export * as accounts from "./accounts.js";
export * as activity from "./activity.js";
export * as connect from "./connect.js";
export * as handoffs from "./handoffs.js";
export * as people from "./people.js";
export { forget, memoryOf } from "./memory.js";
export { rulesOf } from "../agents/muse/sentinel.js";

/** The names Muse's send tools have once installed: what an approval or a log line says it used. */
export const toolNames = {
  gmailSend: installedApplicationTransmissionToolName(gmailApp, gmail),
  whatsappSend: installedApplicationTransmissionToolName(whatsappApp, whatsapp),
} as const;
