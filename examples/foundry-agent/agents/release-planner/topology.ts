import { defineAccount, defineInboundRoute, defineOutboundRoute } from "glove-foundry";
import supportTransmission from "./transmissions/support.transmission.js";

/** Runtime topology is data, so these ids remain data-owned and user-editable. */
export const supportAccount = defineAccount({
  id: "support-account",
  transmission: supportTransmission,
  externalAccountId: "workspace-demo",
  label: "Example support workspace",
  accessRef: "adapter://support/workspace-demo",
  metadata: { address: "support@example.test", workspace: "demo" },
});

export const supportInbound = defineInboundRoute({
  id: "support-inbound",
  transmission: supportTransmission,
  account: supportAccount,
  visibility: "private",
  enabled: true,
  config: { channel: "requests" },
});

export const supportOutbound = defineOutboundRoute({
  id: "support-outbound",
  transmission: supportTransmission,
  account: supportAccount,
  visibility: "private",
  enabled: true,
  config: { channel: "responses" },
});
