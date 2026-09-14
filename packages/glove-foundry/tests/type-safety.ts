import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  defineAgentApplication,
  defineConfig,
  defineInboundRoute,
  composePlaybook,
  definePlaybookAction,
  defineTransmission,
  defineTransmissionEvent,
  install,
  AccountReference,
} from "../src/index.js";

const config = defineConfig({
  server: { port: 4141 },
  execution: { maxConcurrent: 4 },
});
const typedPort: number | undefined = config.server.port;
void typedPort;

defineConfig({
  server: {
    port: 4141,
    // @ts-expect-error unknown nested config keys are rejected
    typo: true,
  },
});

const configuredApplication = defineAgentApplication({
  description: "Typed config fixture",
  config: z.object({ channel: z.string(), retries: z.number().int().default(2) }),
});

install(configuredApplication, { channel: "support" });
// @ts-expect-error a configured application requires its schema input
install(configuredApplication);
// @ts-expect-error channel is inferred as a string from the definition
install(configuredApplication, { channel: 42 });

const typedInboundEvent = defineTransmissionEvent({ direction: "inbound" });
const typedAction = definePlaybookAction();

const transmission = defineTransmission({
  name: "Typed ingress",
  description: "Typed route fixture",
  events: [typedInboundEvent],
  inbound: {
    config: Schema.Struct({ channel: Schema.String, batchSize: Schema.Number }),
    event: Schema.Struct({ body: Schema.String }),
    classify: () => Effect.succeed(typedInboundEvent),
  },
});

composePlaybook({
  name: "typed-policy",
  transmission,
  match: { event: typedInboundEvent },
  directives: [{ action: typedAction, instruction: "Handle it." }],
});

composePlaybook({
  name: "invalid-event-policy",
  transmission,
  // @ts-expect-error code-authored event references must use the imported definition
  match: { event: "message-received" },
  directives: [{ action: typedAction, instruction: "Handle it." }],
});

composePlaybook({
  name: "invalid-action-policy",
  transmission,
  // @ts-expect-error code-authored action references must use the imported definition
  directives: [{ action: "respond", instruction: "Handle it." }],
});

const selectedAccount = {} as Schema.Schema.Type<typeof AccountReference>;
install(configuredApplication, { channel: "support" }, { account: selectedAccount });
// @ts-expect-error installation account selection uses an AccountReference, not an id
install(configuredApplication, { channel: "support" }, { account: "account-1" });

defineInboundRoute({
  id: "typed-route",
  transmission,
  visibility: "private",
  enabled: true,
  config: { channel: "support", batchSize: 25 },
});

defineInboundRoute({
  id: "invalid-typed-route",
  transmission,
  visibility: "private",
  enabled: true,
  // @ts-expect-error batchSize is inferred as a number from the transmission
  config: { channel: "support", batchSize: "many" },
});
