import { Effect, Schema } from "effect";
import { defineInboundRoute } from "../../src/authoring.js";
import { defineAgentApplication } from "../../src/capabilities.js";
import { defineConnection } from "../../src/connection.js";
import { defineTransmission, defineTransmissionEvent } from "../../src/integration.js";

// One inbound transmission, shared by the gate tests and the agent that installs it.
export const ticketMessage = defineTransmissionEvent({ id: "ticket-message", direction: "inbound" });

export const tickets = defineTransmission({
  id: "tickets",
  name: "Tickets",
  description: "Inbound ticket messages",
  events: [ticketMessage],
  inbound: {
    config: Schema.Struct({}),
    event: Schema.Struct({ type: Schema.String, text: Schema.String }),
    classify: () => Effect.succeed(ticketMessage),
  },
});

export const ticketsApp = defineAgentApplication({
  id: "tickets-app",
  description: "Tickets",
  inbound: [tickets],
  connections: [defineConnection({
    id: "tickets-listener",
    description: "Listener",
    transmissions: [tickets],
    connect: (context) => Effect.gen(function* () {
      yield* context.ready();
      yield* Effect.never;
    }),
  })],
});

export const ticketsRoute = defineInboundRoute({
  id: "tickets-inbound",
  transmission: tickets,
  visibility: "workspace",
  enabled: true,
  config: {},
});
