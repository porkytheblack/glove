import { fileURLToPath } from "node:url";
import { discoverAgents } from "glove-foundry";

// The host functions the web app's server calls (app/server/host.ts). Next
// loads this file with Node instead of bundling it, so discovery binds the
// file-derived ids (the gmail app, its transmission…) on the same modules the
// functions below use, the way scripts/onboard.ts does.

await discoverAgents({ agentsDir: fileURLToPath(new URL("../agents", import.meta.url)) });

export * as accounts from "./accounts.js";
export * as connect from "./connect.js";
export * as groups from "./groups.js";
export * as oauth from "./oauth.js";
export * as people from "./people.js";
export * as templates from "./templates.js";
export { memoryOf } from "./memory.js";
export { dataDir } from "./paths.js";
export { arrive } from "../demo/mailbox.js";
export { skillKey, type SavedSkill } from "../agents/bot/skills.js";
