import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { defineOutboundRoute } from "../src/authoring.js";
import {
  defineTransmission,
  defineTransmissionEvent,
  defineTransmissionPredicate,
} from "../src/integration.js";
import {
  composePlaybook,
  composedPlaybookRevision,
  definePlaybookAction,
  materializeComposedPlaybook,
} from "../src/playbook.js";
import { createAgentInstance } from "../src/primitives.js";
import { serializeInboundTransmissionXml } from "../src/transmission.js";

const priority = defineTransmissionPredicate({
  id: "priority",
  match: () => Effect.succeed(true),
});
const messageReceived = defineTransmissionEvent({ id: "message-received", direction: "inbound" });
const messageReply = defineTransmissionEvent({ id: "message-reply", direction: "outbound" });
const triage = definePlaybookAction({ id: "triage" });
const reply = definePlaybookAction({ id: "reply" });
const support = defineTransmission({
  id: "support",
  name: "Support",
  description: "Support messages",
  events: [messageReceived, messageReply],
  inbound: {
    config: Schema.Struct({}),
    event: Schema.Unknown,
    predicates: [priority],
  },
  outbound: {
    config: Schema.Struct({}),
    input: Schema.Unknown,
    output: Schema.Unknown,
  },
});
const replies = defineOutboundRoute({
  id: "support-replies",
  transmission: support,
  visibility: "private",
  enabled: true,
  config: {},
});

test("agent instances own frozen, data-only playbooks", () => {
  const composed = composePlaybook({
    name: "support-triage",
    transmission: support,
    match: {
      event: messageReceived,
      predicate: { definition: priority, parameters: { minimum: 2 } },
    },
    directives: [{
      action: triage,
      instruction: "Assess and answer the request.",
      parameters: { queue: "support" },
    }],
    outbound: [{ route: replies, event: messageReply }],
  });
  const playbook = materializeComposedPlaybook(composed, "support-triage", composedPlaybookRevision(composed));
  const instance = createAgentInstance("assistant", { playbooks: [playbook] });

  assert.equal(instance.playbooks[0]?.match?.predicate?.name, "priority");
  assert.equal(Object.isFrozen(instance.playbooks[0]?.directives), true);
  assert.throws(() => composePlaybook({
    name: "unsafe",
    transmission: support,
    directives: [{ action: "run", instruction: "unsafe", parameters: { handler: () => true } }],
  } as never), /serializable data/);
});

test("inbound transmissions serialize event data and directives into deterministic XML", () => {
  const composed = composePlaybook({
    name: "support-triage",
    transmission: support,
    directives: [{ action: reply, instruction: "Respond to <customer> & preserve context." }],
    outbound: [{ route: replies, instruction: "Send after approval." }],
  });
  const playbook = materializeComposedPlaybook(composed, "support-triage", composedPlaybookRevision(composed));
  const xml = serializeInboundTransmissionXml({
    transmissionId: "support",
    routeId: "support-inbound",
    eventId: "event-1",
    eventName: "message.received",
    threadKey: "thread-1",
    event: { message: "Hello & welcome", priority: 2 },
    playbooks: [playbook],
  });

  assert.match(xml, /<transmission direction="inbound"/);
  assert.match(xml, /event="message.received"/);
  assert.match(xml, /<directive action="reply">/);
  assert.match(xml, /&lt;customer&gt; &amp; preserve context/);
  assert.match(xml, /<outbound route="support-replies">Send after approval.<\/outbound>/);
});
