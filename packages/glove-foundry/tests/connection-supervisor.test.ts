import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { defineInboundRoute } from "../src/authoring.js";
import { defineAgentApplication } from "../src/capabilities.js";
import { ApplicationConnectionSupervisor } from "../src/connection-supervisor.js";
import { defineConnection } from "../src/connection.js";
import { defineTransmission } from "../src/integration.js";

test("completion-aware receives keep the connection effect open until delivery settles", async () => {
  const transmission = defineTransmission({
    id: "messages",
    name: "Messages",
    description: "Completion-aware receive fixture",
    inbound: {
      config: Schema.Struct({}),
      event: Schema.Struct({ text: Schema.String }),
    },
  });
  let releaseReceive!: () => void;
  const receiveGate = new Promise<void>((resolve) => {
    releaseReceive = resolve;
  });
  let received = false;
  let receiveReturned = false;
  const connection = defineConnection({
    id: "listener",
    description: "Completion-aware listener",
    transmissions: [transmission],
    connect: (context) => Effect.gen(function* () {
      yield* context.ready();
      yield* context.receive({
        route: context.routes[0]!,
        eventId: "event-1",
        threadKey: "thread-1",
        awaitCompletion: true,
        raw: { text: "hello" },
      });
      receiveReturned = true;
      yield* Effect.never;
    }),
  });
  const application = defineAgentApplication({
    id: "messaging",
    description: "Messaging fixture",
    inbound: [transmission],
    connections: [connection],
  });
  const route = defineInboundRoute({
    id: "messages-inbound",
    transmission,
    visibility: "private",
    enabled: true,
    config: {},
  });
  const supervisor = new ApplicationConnectionSupervisor({
    receive: async (input) => {
      assert.equal(input.awaitCompletion, true);
      assert.ok(input.signal);
      received = true;
      await receiveGate;
    },
    emit: () => undefined,
  });

  await supervisor.reconcile([{
    id: "messaging-listener",
    application,
    connection,
    definitionId: "assistant",
    workspaceId: "workspace-1",
    routes: [route],
  }]);
  try {
    const deadline = Date.now() + 1_000;
    while (!received && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    assert.equal(received, true);
    assert.equal(receiveReturned, false);
    releaseReceive();
    const returnDeadline = Date.now() + 1_000;
    while (!receiveReturned && Date.now() < returnDeadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    assert.equal(receiveReturned, true);
  } finally {
    releaseReceive();
    await supervisor.stopAll();
  }
});
