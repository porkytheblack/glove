import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { defineApplication } from "../src/application.js";
import { defineInboundRoute } from "../src/authoring.js";
import { defineAgentApplication, install } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { defineConnection } from "../src/connection.js";
import { discoverAgents } from "../src/discovery.js";
import { defineTransmission, defineTransmissionEvent } from "../src/integration.js";
import {
  composePlaybook,
  composedPlaybookRevision,
  definePlaybookAction,
  materializeComposedPlaybook,
} from "../src/playbook.js";
import { MemoryFoundryDataAdapter } from "../src/primitives.js";
import { FoundryRuntime } from "../src/runtime.js";
import { definePlaybookSubscription } from "../src/subscription.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

test("an inbound playbook lazily provisions one or many subscribed agents", async () => {
  const ticketCreated = defineTransmissionEvent({ id: "ticket-created", direction: "inbound" });
  const triage = definePlaybookAction({ id: "triage" });
  const transmission = defineTransmission({
    id: "support",
    name: "Support",
    description: "Inbound support messages",
    events: [ticketCreated],
    inbound: {
      config: Schema.Struct({}),
      event: Schema.Struct({ type: Schema.String, text: Schema.String }),
      classify: () => Effect.succeed(ticketCreated),
    },
  });
  const connection = defineConnection({
    id: "listener",
    description: "Test provider listener",
    transmissions: [transmission],
    connect: (context) => Effect.gen(function* () {
      yield* context.ready();
      yield* Effect.never;
    }),
  });
  const support = defineAgentApplication({
    id: "support-app",
    description: "Support application",
    inbound: [transmission],
    connections: [connection],
  });
  const route = defineInboundRoute({
    id: "support-inbound",
    transmission,
    visibility: "workspace",
    enabled: true,
    config: {},
  });
  const composed = composePlaybook({
    name: "triage",
    transmission,
    match: { event: ticketCreated, routes: [route] },
    directives: [{
      action: triage,
      instruction: "Triage the support request.",
    }],
    applications: [support],
  });
  const playbook = materializeComposedPlaybook(composed, "triage", composedPlaybookRevision(composed));
  const [base] = await discoverAgents({ agentsDir });
  const definition = Object.freeze({
    ...base!.definition,
    components: composeAgent(support),
  });
  const discovered = { ...base!, definition };
  const subscription = definePlaybookSubscription({
    id: "support-workforce",
    workspaceId: "workspace-1",
    playbook,
    targets: [
      {
        agent: definition,
        provisioning: { mode: "per-thread" },
        installations: [install(support)],
        context: { role: "lead" },
      },
      {
        agent: definition,
        provisioning: { mode: "per-thread" },
        installations: [install(support)],
        context: { role: "reviewer" },
      },
    ],
  });
  const data = new MemoryFoundryDataAdapter({ subscriptions: [subscription] });
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [discovered],
    application: defineApplication({
      name: "Subscription test",
      data,
    }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });

  assert.equal((await runtime.listAgentInstances()).length, 0);
  await runtime.putRoute(route);
  assert.deepEqual((await runtime.listRoutes()).map((item) => item.id), [route.id]);
  await runtime.start();
  try {
    const runs = await runtime.dispatchInbound({
      routeId: route.id,
      eventId: "event-1",
      threadKey: "thread-1",
      raw: { type: "ticket.created", text: "Help" },
    });
    assert.equal(runs.length, 2);
    const agents = await runtime.listAgentInstances();
    assert.equal(agents.length, 2);
    assert.deepEqual(
      agents.map((agent) => agent.context.role).sort(),
      ["lead", "reviewer"],
    );
    assert.ok(agents.every((agent) => agent.provisioningKey?.includes("thread-1")));
    assert.ok(agents.every((agent) => agent.playbooks[0]?.id === playbook.id));

    const repeated = await runtime.dispatchInbound({
      routeId: route.id,
      eventId: "event-1",
      threadKey: "thread-1",
      raw: { type: "ticket.created", text: "Help" },
    });
    assert.deepEqual(repeated.map((run) => run.id), runs.map((run) => run.id));
    assert.equal((await runtime.listAgentInstances()).length, 2);

    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    assert.equal(runtime.listApplicationConnections()[0]?.status, "connected");
  } finally {
    await runtime.stop();
  }
});
