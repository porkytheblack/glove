import { MemoryFoundryDataAdapter, defineApplication } from "glove-foundry";
import { travellerAccount, travellerInbound, travellerOutbound } from "./agents/concierge/topology.js";

/**
 * The application is where runtime data enters: which adapter persists
 * instances, which accounts and routes exist. `MemoryFoundryDataAdapter` keeps
 * everything in process, so restarting `pnpm dev` starts clean. Swap it for
 * your own adapter to persist across restarts.
 */
export const data = new MemoryFoundryDataAdapter();

export default defineApplication({
  name: "{{projectName}}",
  data,
  accounts: [travellerAccount],
  routes: [travellerInbound, travellerOutbound],
  bindings: [],
});
