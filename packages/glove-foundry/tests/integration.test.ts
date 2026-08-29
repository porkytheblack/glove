import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import {
  AccountReference,
  AgentBinding,
  OutboundRoute,
} from "../src/domain.js";
import { defineApplication } from "../src/application.js";
import { createFoundryClient } from "../src/client.js";
import { defineTransmission } from "../src/integration.js";
import { defineAgentApplication } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { discoverAgents } from "../src/discovery.js";
import { FoundryRuntime } from "../src/runtime.js";
import { FoundryServer } from "../src/server.js";
import { MemoryFoundryDataAdapter, createAgentInstance } from "../src/primitives.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

test("Foundry serves a typed run and a complete observable trace", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  const server = new FoundryServer(runtime, { port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const manifestResponse = await fetch(`${listening.url}/api/manifest`);
    assert.equal(manifestResponse.status, 200);
    const manifest = (await manifestResponse.json()) as {
      agents: { agents: Array<{ id: string }> };
      definitions: Record<string, {
        capabilities: {
          tools: unknown[];
          applications: unknown[];
          mcp: unknown[];
          memory: unknown[];
        };
        surfaces: { layers: unknown[]; subscribers: unknown[] };
      }>;
    };
    assert.deepEqual(manifest.agents.agents.map((agent) => agent.id), ["assistant"]);
    assert.deepEqual(manifest.definitions.assistant?.capabilities, {
      tools: [],
      applications: [],
      mcp: [],
      memory: [],
    });
    const control = createFoundryClient({ baseUrl: listening.url });
    assert.deepEqual(
      await control.capabilities("assistant"),
      manifest.definitions.assistant?.capabilities,
    );
    assert.deepEqual(
      await control.surfaces("assistant"),
      manifest.definitions.assistant?.surfaces,
    );
    assert.deepEqual(manifest.definitions.assistant?.surfaces, {
      layers: [],
      subscribers: [],
    });
    const agent = await control.agent("assistant").create({ id: "assistant-test", workspaceId: "test" });
    const conversation = await control.createConversation(agent.id, { id: "conversation-test" });
    const handle = await control.send(agent.id, conversation.id, "hello");
    const accepted = handle.initial;
    assert.equal(accepted.status, "pending");

    const completed = await runtime.waitForRun<{ value: string }>(accepted.id, {
      pollMs: 25,
      timeoutMs: 20_000,
    });
    assert.equal(completed?.status, "completed");
    assert.match(completed?.output?.value ?? "", /hello/);

    const runResponse = await fetch(`${listening.url}/api/runs/${accepted.id}`);
    assert.equal(runResponse.status, 200);
    const run = (await runResponse.json()) as { output: { value: string } };
    assert.match(run.output.value, /foundry-echo/);

    const eventsResponse = await fetch(
      `${listening.url}/api/runs/${accepted.id}/events`,
    );
    const events = (await eventsResponse.json()) as Array<{ type: string }>;
    assert.ok(events.some((event) => event.type === "run.completed"));
    assert.ok(events.some((event) => event.type === "agent.text_delta"));
    assert.ok(
      events.some(
        (event) => event.type === "agent.foundry.assembly.resolve.complete",
      ),
    );
    assert.ok(events.some((event) => event.type === "agent.test.lazy-tools"));

    const streamAbort = new AbortController();
    const streamResponse = await fetch(
      `${listening.url}/api/events?runId=${accepted.id}`,
      {
        headers: { accept: "text/event-stream" },
        signal: streamAbort.signal,
      },
    );
    assert.match(
      streamResponse.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    const streamReader = streamResponse.body?.getReader();
    const firstStreamChunk = await streamReader?.read();
    assert.match(
      new TextDecoder().decode(firstStreamChunk?.value),
      /data: \{"id"/,
    );
    await streamReader?.cancel();
    streamAbort.abort();

    const dashboard = await fetch(listening.url).then((result) => result.text());
    assert.match(dashboard, /Runtime inspector/);
    assert.match(dashboard, /data-brand="glove"/);
    assert.match(dashboard, /viewBox="0 0 1024 1024"/);
    assert.match(dashboard, /data-phosphor="agent"/);
    assert.match(dashboard, /data-phosphor="search"/);
    assert.match(dashboard, /Definitions and instances are intentionally separate/);
    assert.match(dashboard, /Run spine/);

    const nestedInspector = await fetch(`${listening.url}/runs/${accepted.id}`);
    assert.equal(nestedInspector.status, 200);
    assert.match(await nestedInspector.text(), /Observable event trace/);

    const activations = await control.activations();
    assert.deepEqual(activations, []);
  } finally {
    await server.close();
    await runtime.stop();
  }
});

test("Foundry rejects malformed framework requests before creating a run", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  const server = new FoundryServer(runtime, { port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const response = await fetch(
      `${listening.url}/api/agents/assistant/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: 42 }),
      },
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /agentId is required/);
    assert.deepEqual(await runtime.listRuns(), []);
  } finally {
    await server.close();
    await runtime.stop();
  }
});

test("Foundry serves validated topology without exposing account access references", async () => {
  const transport = defineTransmission({
    id: "transport",
    name: "Transport",
    description: "Test transport",
    account: {
      required: true,
      metadata: Schema.Struct({ address: Schema.String }),
    },
    capabilities: [
      {
        id: "transport:send",
        description: "Send a message",
        account: "required",
        effect: "write",
      },
    ],
    outbound: {
      config: Schema.Struct({ channel: Schema.String }),
      input: Schema.Struct({ message: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
    },
  });
  const account = Schema.decodeUnknownSync(AccountReference)({
    id: "account-1",
    transmissionId: "transport",
    externalAccountId: "external-1",
    accessRef: "adapter://accounts/1",
    metadata: { address: "test@example.test" },
  });
  const route = Schema.decodeUnknownSync(OutboundRoute)({
    id: "outbound-1",
    transmissionId: "transport",
    accountId: account.id,
    direction: "outbound",
    visibility: "private",
    enabled: true,
    config: { channel: "test" },
  });
  const assistantInstance = createAgentInstance("assistant", { id: "assistant-control" });
  const binding = Schema.decodeUnknownSync(AgentBinding)({
    id: "assistant-transport",
    agentId: assistantInstance.id,
    transmissionId: "transport",
    accountId: account.id,
    routeId: route.id,
    capabilities: ["transport:send"],
    reply: { mode: "route", routeId: route.id },
    enabled: true,
  });
  const [discovered] = await discoverAgents({ agentsDir });
  const transportApp = defineAgentApplication({
    id: "transport-app",
    description: "Test transport application",
    transmissions: [transport],
    install: () => Effect.succeed({ tools: [] }),
  });
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [{
      ...discovered!,
      definition: Object.freeze({
        ...discovered!.definition,
        components: composeAgent(transportApp),
      }),
    }],
    application: defineApplication({
      name: "Control plane test",
      accounts: [account],
      routes: [route],
      bindings: [binding],
      data: new MemoryFoundryDataAdapter({ agents: [assistantInstance] }),
    }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  const server = new FoundryServer(runtime, { port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const client = createFoundryClient({ baseUrl: listening.url });
    const accounts = await client.accounts();
    assert.equal(accounts.length, 1);
    assert.equal("accessRef" in accounts[0]!, false);
    assert.equal((await client.routes()).length, 1);
    assert.equal((await client.bindings()).length, 1);
    assert.equal((await client.health()).agents, 1);

    const grant = await client.resolveGrant({
      runId: Schema.decodeUnknownSync(
        Schema.NonEmptyTrimmedString.pipe(Schema.brand("FoundryRunId")),
      )("run-control-plane"),
      agentId: binding.agentId,
    });
    assert.deepEqual(grant.capabilities, ["transport:send"]);

    const invalidRoute = await fetch(`${listening.url}/api/routes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...route, config: { channel: 42 } }),
    });
    assert.equal(invalidRoute.status, 400);
  } finally {
    await server.close();
    await runtime.stop();
  }
});
