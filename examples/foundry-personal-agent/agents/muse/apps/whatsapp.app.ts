import { defineApp } from "glove-foundry";
import whatsapp from "../transmissions/whatsapp.transmission.js";

/**
 * Talk with Muse on WhatsApp, like messaging a person. Messages come in
 * through the transmission; Muse answers with its send tool, on the route
 * that only reaches its own person. Install it with Muse's number as the
 * account.
 */
export default defineApp({
  description: "Talk with Muse on WhatsApp: messages in, answers out to the same person",
  inbound: [whatsapp],
  outbound: [whatsapp],
});
