import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { fileURLToPath } from "node:url";
import { conciergeDemo, conciergeDemoReplies } from "./agents/concierge/instances.js";
import { travellerAccount, travellerInbound, travellerOutbound } from "./agents/concierge/topology.js";

/**
 * The application is where runtime data enters: which adapter persists
 * instances, which accounts, routes and bindings exist.
 *
 * Instances, conversations, schedules, workspace data and the concierge's VFS
 * are saved to `.data/foundry.json`, so they survive restarts — including the
 * restart `dev` performs every time you save a file. `conciergeDemo` is seeded
 * on first start. Delete `.data/` to start fresh. Use a database-backed adapter
 * when several hosts share one runtime.
 */
export const data = new FileFoundryDataAdapter({
  file: fileURLToPath(new URL("./.data/foundry.json", import.meta.url)),
  agents: [conciergeDemo],
});

export default defineApplication({
  name: "{{projectName}}",
  data,
  accounts: [travellerAccount],
  routes: [travellerInbound, travellerOutbound],
  bindings: [conciergeDemoReplies],
});
