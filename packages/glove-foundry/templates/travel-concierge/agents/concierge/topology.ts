import { defineAccount, defineInboundRoute, defineOutboundRoute } from "glove-foundry";
import messaging from "./transmissions/messaging.transmission.js";

/**
 * Topology is runtime *data*, not code identity — which is why these carry
 * explicit ids. Edit them, load them from your database, or create them from
 * the inspector; the agent definition above does not change.
 */
export const travellerAccount = defineAccount({
  id: "traveller-chat",
  transmission: messaging,
  externalAccountId: "demo-traveller",
  label: "Demo traveller chat",
  // The real credential stays behind this reference, inside an adapter you own.
  accessRef: "adapter://messaging/demo-traveller",
  metadata: { handle: "@demo_traveller", provider: "telegram" },
});

export const travellerInbound = defineInboundRoute({
  id: "traveller-inbound",
  transmission: messaging,
  account: travellerAccount,
  visibility: "private",
  enabled: true,
  config: { provider: "telegram" },
});

export const travellerOutbound = defineOutboundRoute({
  id: "traveller-outbound",
  transmission: messaging,
  account: travellerAccount,
  visibility: "private",
  enabled: true,
  config: { provider: "telegram" },
});
