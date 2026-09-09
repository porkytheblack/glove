import {
  defineAccount,
  defineInboundRoute,
  defineOutboundRoute,
} from "glove-foundry";
import chat from "./apps/messaging/transmissions/chat.transmission.js";
import fileDrop from "./apps/messaging/transmissions/file-drop.transmission.js";
import notification from "./apps/messaging/transmissions/notification.transmission.js";
import { hermesMessengerProvider } from "../../lib/account-sessions.js";

const messengerProvider = hermesMessengerProvider();

/** Runtime topology is editable deployment data; code references the values directly. */
export const operatorAccount = defineAccount({
  id: "hermes-operator",
  transmission: chat,
  externalAccountId: messengerProvider === "telegram" ? "telegram-bot" : "local-operator",
  label: messengerProvider === "telegram" ? "Telegram operator" : "Local operator",
  accessRef: `adapter://hermes/${messengerProvider}/operator`,
  metadata: { provider: messengerProvider, address: "operator" },
});

export const chatInbound = defineInboundRoute({
  id: "hermes-chat-inbound",
  transmission: chat,
  account: operatorAccount,
  visibility: "private",
  enabled: true,
  config: { provider: messengerProvider, channel: "operator" },
});

export const chatOutbound = defineOutboundRoute({
  id: "hermes-chat-outbound",
  transmission: chat,
  account: operatorAccount,
  visibility: "private",
  enabled: true,
  config: { provider: messengerProvider, channel: "operator" },
});

export const fileInbound = defineInboundRoute({
  id: "hermes-file-inbound",
  transmission: fileDrop,
  visibility: "private",
  enabled: true,
  config: { mountPoint: "/inbox" },
});

export const notificationOutbound = defineOutboundRoute({
  id: "hermes-notification-outbound",
  transmission: notification,
  visibility: "private",
  enabled: true,
  config: { channel: "operator" },
});
