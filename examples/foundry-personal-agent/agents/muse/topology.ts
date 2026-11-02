import { defineAccount, defineInboundRoute } from "glove-foundry";
import whatsapp from "./transmissions/whatsapp.transmission.js";

/**
 * Muse's WhatsApp number. It belongs to the application, not to a person:
 * everyone messages the same number, and each person's Muse only takes their
 * own messages (the from-person predicate on their playbook).
 */
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "100000000000001";

export const museNumber = defineAccount({
  id: "muse-whatsapp",
  transmission: whatsapp,
  externalAccountId: phoneNumberId,
  label: "Muse on WhatsApp",
  accessRef: "env://WHATSAPP_TOKEN", // only accountSessions reads it
  metadata: { phoneNumberId },
});

/** Every WhatsApp message to Muse's number arrives here (lib/whatsapp-webhook.ts forwards it). */
export const whatsappIn = defineInboundRoute({
  id: "whatsapp-in",
  transmission: whatsapp,
  account: museNumber,
  visibility: "workspace",
  enabled: true,
  config: { phoneNumberId },
});
