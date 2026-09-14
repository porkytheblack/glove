import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defineAgent,
  defineAgentFromModule,
  internalAgentName,
  isFoundryAgent,
  isFoundryAgentDefinition,
} from "../src/definition.js";

const typed = defineAgent({
  id: "support/triage",
  description: "Triage support requests",
  run: (_agent, { input }) => ({ queue: input.payload }),
});

const fileRouted = defineAgent({
  description: "File routed handler",
  handler: ({ input }) => ({ value: input.payload }),
});

test("defineAgent is a pure typed data definition, not an execution job", () => {
  assert.equal(typed.id, "support/triage");
  assert.equal(isFoundryAgent(typed), true);
  assert.equal("name" in typed, false);
  assert.equal("input" in typed, false);
  assert.equal("output" in typed, false);
  assert.equal(internalAgentName(typed.id!), "foundry_support__triage");
});

test("definition-first agents derive identity from the file route", () => {
  assert.equal(isFoundryAgent(fileRouted), true);
  assert.equal(isFoundryAgentDefinition(fileRouted), true);
  assert.throws(() => fileRouted.id, /identity has not been bound/);
  const discovered = defineAgentFromModule("file-routed", { default: fileRouted });
  assert.equal(discovered, fileRouted);
  assert.equal(discovered.id, "file-routed");
});

test("defineAgent rejects unsafe routes and framework-owned contracts", () => {
  assert.throws(
    () =>
      defineAgent({
        id: "../escape",
        description: "bad",
        run: () => "never",
      }),
    /Invalid Foundry agent id/,
  );
  assert.throws(
    () =>
      defineAgent({
        id: "contracts",
        description: "bad",
        input: {} as never,
        run: () => "never",
      } as never),
    /cannot define input/,
  );
  assert.throws(
    () =>
      defineAgent({
        id: "static-inbox",
        description: "bad",
        inboxes: [] as never,
        run: () => "never",
      }),
    /inboxes must be a lazy resolver function/,
  );
});

test("named convention exports normalize to the same definition shape", () => {
  const named = defineAgentFromModule("named", {
    description: "Named exports",
    systemPrompt: (_agent, context) => `Handle ${context.agentId}`,
    model: {} as never,
  });
  assert.equal(named.id, "named");
  assert.equal(named.description, "Named exports");
  assert.equal(typeof named.systemPrompt, "function");
});
