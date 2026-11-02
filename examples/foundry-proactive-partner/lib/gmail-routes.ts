import { Schema } from "effect";
import { InboundRoute, OutboundRoute } from "glove-foundry";
import gmail from "../agents/partner/transmissions/gmail.transmission.js";

// Gmail's routes on their own, so the scripted models can name them without
// importing the partner definition (lib/connect.ts does, and the partner
// imports its computer, whose model is scripted here).

/**
 * Code ids (an app's or a transmission's, from its file name) are bound when
 * Foundry discovers the agents, which can be after this module loads. Like
 * Foundry's own install() and defineInboundRoute(), read them lazily.
 */
export function withLazy<T extends object>(value: T, key: string, read: () => string): T {
  const copy = { ...value };
  Object.defineProperty(copy, key, { enumerable: true, get: read });
  return Object.freeze(copy);
}

/** A person's Gmail routes. New mail joins their one thread with the partner. */
export function gmailRoutes(accountId: string) {
  const shared = { transmissionId: "pending", accountId, visibility: "private", enabled: true };
  return {
    in: withLazy(Schema.decodeUnknownSync(InboundRoute)({ ...shared, id: `${accountId}-in`, direction: "inbound", config: { label: "INBOX", conversation: "thread" } }), "transmissionId", () => gmail.id),
    out: withLazy(Schema.decodeUnknownSync(OutboundRoute)({ ...shared, id: `${accountId}-out`, direction: "outbound", config: {} }), "transmissionId", () => gmail.id),
  };
}
