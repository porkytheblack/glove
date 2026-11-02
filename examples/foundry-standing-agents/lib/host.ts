import { fileURLToPath } from "node:url";
import { discoverAgents, installedApplicationTransmissionToolName } from "glove-foundry";
import gmailApp from "../agents/dot/apps/gmail.app.js";
import slackApp from "../agents/dot/apps/slack.app.js";
import gmail from "../agents/dot/transmissions/gmail.transmission.js";
import slackMessages from "../agents/dot/transmissions/slack-messages.transmission.js";

// The host functions the web app's server calls (app/server/host.ts). Next
// loads this file with Node instead of bundling it, so discovery binds the
// file-derived ids (the gmail app, its transmission…) on the same modules the
// functions below use, the way scripts/onboard.ts does.

await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });

/** Code ids, read once discovery above has bound them. */
export const ids = {
  gmailApp: gmailApp.id,
  slackApp: slackApp.id,
  gmail: gmail.id,
  slackMessages: slackMessages.id,
  /** The Gmail app's send, as the dot calls it. */
  sendTool: installedApplicationTransmissionToolName(gmailApp, gmail),
} as const;

export * as dots from "./dot.js";
export * as review from "./auto-review.js";
export * as handoffs from "./handoffs.js";
export * as computer from "./computer.js";
export * as accounts from "./accounts.js";
export * as connect from "./connect.js";
export { dataDir } from "./paths.js";
export { arrive } from "../demo/mailbox.js";
export { ACTION_NAMES } from "./actions.js";
export { PAUSE_AFTER } from "./monitor.js";
export { GMAIL_READS } from "../agents/dot/apps/gmail.app.js";
export { readOnly, research } from "../agents/dot/research.js";
