import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { defineApplication } from "../src/application.js";
import { defineAgentApplication } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { defineTransmission } from "../src/integration.js";

const messaging = defineTransmission({
  id: "messaging",
  name: "Messaging",
  description: "Test messaging contract",
  inbound: {
    config: Schema.Struct({ channel: Schema.String }),
    event: Schema.Struct({ message: Schema.String }),
  },
});

test("transmissions are owned by headless agent applications", () => {
  const notes = defineAgentApplication({
    id: "notes",
    description: "Notes",
    transmissions: [messaging],
    install: () => Effect.succeed({ tools: [] }),
  });
  const composition = composeAgent(() => notes);

  assert.equal(composition.capabilities.applications[0], notes);
  assert.equal(
    composition.capabilities.applications[0]?.transmissions?.[0],
    messaging,
  );
  assert.equal(Object.isFrozen(composition), true);
});

test("root applications contain infrastructure, not agent capabilities", () => {
  const application = defineApplication({ name: "Infrastructure" });
  assert.equal(Object.isFrozen(application), true);
  assert.equal("transmissions" in application, false);
  assert.equal("agentApplications" in application, false);
  assert.equal("memory" in application, false);
  assert.equal("mcp" in application, false);
});

test("root application topology rejects duplicate ids", () => {
  assert.throws(
    () => defineApplication({
      name: "Invalid",
      routes: [
        { id: "same", transmissionId: "messaging", direction: "inbound", visibility: "private", enabled: true, config: {} } as never,
        { id: "same", transmissionId: "messaging", direction: "outbound", visibility: "private", enabled: true, config: {} } as never,
      ],
    }),
    /Duplicate Foundry route id/,
  );
});
