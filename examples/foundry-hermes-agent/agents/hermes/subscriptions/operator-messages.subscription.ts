import { definePlaybookSubscription } from "glove-foundry";
import hermes from "../agent.js";
import { messagingPlaybooks } from "../apps/messaging/policy.js";
import {
  hermesInstance,
  hermesMessagingInstallation,
} from "../instances.js";

/** Starts messenger ingress on boot and attaches the policy to the saved primary instance. */
export default definePlaybookSubscription({
  workspaceId: hermesInstance.workspaceId,
  playbook: messagingPlaybooks("Hermes")[0],
  targets: [{
    agent: hermes,
    provisioning: { mode: "existing", agentIds: [hermesInstance.id] },
    installations: [hermesMessagingInstallation],
  }],
});
