import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createManifest,
  discoverAgents,
  routeFromAgentFile,
} from "../src/discovery.js";
import { discoverFoundryRegistry } from "../src/registry.js";
import respond from "./fixtures/file-identity-agents/assistant/actions/respond.action.js";
import messageReceived from "./fixtures/file-identity-agents/assistant/events/message-received.event.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, "fixtures/agents");

test("agent files compile into stable routes and a secret-safe manifest", async () => {
  const discovered = await discoverAgents({ agentsDir });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0]?.route, "assistant");
  assert.equal(discovered[0]?.definition.description, "Test assistant");
  assert.equal(discovered[0]?.executionName, "foundry_assistant");

  const manifest = createManifest(discovered);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.agents[0]?.id, "assistant");
  assert.equal(manifest.agents[0]?.invocationContract, "foundry/request-v1");
  assert.equal(manifest.agents[0]?.assembly, "foundry");
  assert.equal(manifest.agents[0]?.handler, "glove");
  assert.equal(manifest.agents[0]?.resultContract, "foundry/result-v1");
});

test("colocated definitions derive nested identities from convention files", async () => {
  const [agent] = await discoverAgents({
    agentsDir: resolve(here, "fixtures/file-identity-agents"),
  });
  assert.equal(agent?.definition.id, "assistant");
  assert.equal(
    agent?.definition.components?.capabilities.tools[0]?.id,
    "time/clock",
  );
  assert.equal(
    agent?.definition.components?.capabilities.tools[1]?.id,
    "diagnostics/status",
  );
  assert.equal(
    agent?.definition.components?.capabilities.tools[1]?.tool?.name,
    "diagnostics__status",
  );
  assert.equal(respond.id, "respond");
  assert.equal(messageReceived.id, "message-received");
});

test("routeFromAgentFile supports nested Next-style and suffix-style routes", () => {
  assert.equal(
    routeFromAgentFile("/app/agents", "/app/agents/research/deep/agent.ts"),
    "research/deep",
  );
  assert.equal(
    routeFromAgentFile("/app/agents", "/app/agents/research/deep.agent.ts"),
    "research/deep",
  );
  assert.equal(
    routeFromAgentFile("/app/agents", "/app/agents/research/helper.ts"),
    null,
  );
});

test("capability folders compile into separate registries", async () => {
  const rootDir = resolve(here, "fixtures/registry-root");
  const registry = await discoverFoundryRegistry({ rootDir });
  assert.deepEqual(
    registry.files.map((file) => `${file.kind}:${file.id}`).sort(),
    [
      "application:notes",
      "mcp:search",
      "memory:personal",
      "tool:clock",
    ],
  );
  assert.deepEqual(
    registry.nativeFiles.map((file) => `${file.kind}:${file.id}`).sort(),
    ["layer:audit", "subscriber:metrics"],
  );
});
