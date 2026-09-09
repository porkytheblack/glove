import { createConversation, defineAgentInstance, install } from "glove-foundry";
import hermes from "./agent.js";
import messaging from "./apps/messaging.app.js";
import mediaStudio from "./apps/media-studio.app.js";
import knowledge from "./tools/knowledge.tool.js";
import { status } from "./composition.js";
import { operatorAccount } from "./topology.js";
import { hermesMessengerProvider } from "../../lib/account-sessions.js";

export const hermesMessagingInstallation = install(
  messaging,
  { provider: hermesMessengerProvider(), homeChannel: "operator" },
  { account: operatorAccount },
);

export const hermesInstance = defineAgentInstance(hermes, {
  id: "hermes-primary",
  workspaceId: "hermes-home",
  context: {
    displayName: "Hermes",
    personality: "direct, resourceful, curious, and careful with side effects",
    ownerName: "operator",
    enabledSkills: ["planning", "research"],
    enableDailyReview: true,
    maxTurns: 20,
  },
  installations: [
    install(status, undefined),
    install(knowledge, {
      sources: [
        {
          title: "Foundry architecture",
          body: "Definitions live in code. Instances, installations, conversations, playbooks, and schedules are mutable data.",
        },
        {
          title: "Hermes reference policy",
          body: "Use the sandboxed working environment for files and code. Delegate focused research. Ask before consequential external effects.",
        },
      ],
    }),
    hermesMessagingInstallation,
    install(mediaStudio, { provider: "auto", candidates: 1 }),
  ],
  playbooks: [],
});

export const hermesConversation = createConversation(hermesInstance, {
  id: "hermes-main",
  title: "Hermes",
  context: { channel: "foundry", persistent: true },
});
