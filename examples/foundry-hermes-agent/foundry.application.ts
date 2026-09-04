import {
  MemoryFoundryDataAdapter,
  defineApplication,
  defineBinding,
} from "glove-foundry";
import { hermesConversation, hermesInstance } from "./agents/hermes/instances.js";
import messaging from "./agents/hermes/apps/messaging.app.js";
import chat, { sendMessage } from "./agents/hermes/apps/messaging/transmissions/chat.transmission.js";
import notification, { sendNotification } from "./agents/hermes/apps/messaging/transmissions/notification.transmission.js";
import {
  chatInbound,
  chatOutbound,
  fileInbound,
  notificationOutbound,
  operatorAccount,
} from "./agents/hermes/topology.js";
import { hermesConversationStore } from "./lib/stores.js";

export const data = new MemoryFoundryDataAdapter({
  identifier: "foundry-hermes-data",
  agents: [hermesInstance],
  conversations: [hermesConversation],
});

const chatBinding = defineBinding({
  id: "hermes-chat",
  agent: hermesInstance,
  application: messaging,
  transmission: chat,
  account: operatorAccount,
  route: chatOutbound,
  capabilities: [sendMessage],
  reply: { mode: "none" },
  enabled: true,
});

const notificationBinding = defineBinding({
  id: "hermes-notifications",
  agent: hermesInstance,
  application: messaging,
  transmission: notification,
  route: notificationOutbound,
  capabilities: [sendNotification],
  reply: { mode: "none" },
  enabled: true,
});

export default defineApplication({
  name: "Hermes on Glove Foundry",
  data,
  conversationStore: hermesConversationStore,
  accounts: [operatorAccount],
  routes: [chatInbound, chatOutbound, fileInbound, notificationOutbound],
  bindings: [chatBinding, notificationBinding],
});
