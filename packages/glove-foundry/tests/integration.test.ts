import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { MemoryStore } from "glove-core";
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
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
} from "../src/primitives.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

test("Foundry refuses an unauthenticated non-loopback control surface", async () => {
  const runtime = await FoundryRuntime.discover({ rootDir, agentsDir });
  const server = new FoundryServer(runtime, { host: "0.0.0.0", port: 0 });
  await assert.rejects(
    server.listen(),
    /refuses to bind 0\.0\.0\.0 without application\.requestAuthorization/,
  );
  assert.equal(server.address(), null);
});

test("Foundry delegates HTTP authorization without retaining credentials", async () => {
  const inspected: Array<{ method: string; path: string; credentialPresent: boolean }> = [];
  const application = defineApplication({
    name: "Authorized control plane",
    requestAuthorization: {
      identifier: "test-control-authorization",
      challenge: 'Bearer realm="Foundry test"',
      authorize: (request) => Effect.sync(() => {
        inspected.push({
          method: request.method,
          path: request.path,
          credentialPresent: Boolean(request.authorization),
        });
        return request.authorization === "Bearer private-test-control-token";
      }),
    },
  });
  const runtime = await FoundryRuntime.discover({ rootDir, agentsDir, application });
  const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const denied = await fetch(`${listening.url}/health`);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("www-authenticate"), 'Bearer realm="Foundry test"');

    const control = createFoundryClient({
      baseUrl: listening.url,
      authorization: {
        identifier: "test-client-authorization",
        headers: () => ({ authorization: "Bearer private-test-control-token" }),
      },
    });
    assert.equal((await control.health()).ok, true);
    const dashboard = await fetch(listening.url, {
      headers: { authorization: "Bearer private-test-control-token" },
    });
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /Glove Foundry/);

    assert.deepEqual(inspected, [
      { method: "GET", path: "/health", credentialPresent: false },
      { method: "GET", path: "/health", credentialPresent: true },
      { method: "GET", path: "/", credentialPresent: true },
    ]);
    assert.equal(JSON.stringify(runtime.observability.list()).includes("private-test-control-token"), false);
  } finally {
    await server.close();
    await runtime.stop();
  }
});

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
    const transcript = await control.conversationTranscript(agent.id, conversation.id);
    assert.equal(transcript.persisted, true);
    assert.ok(Array.isArray(transcript.messages));

    const runResponse = await fetch(`${listening.url}/api/runs/${accepted.id}`);
    assert.equal(runResponse.status, 200);
    const run = (await runResponse.json()) as { output: { value: string } };
    assert.match(run.output.value, /foundry-echo/);

    const modelsResponse = await fetch(`${listening.url}/v1/models`);
    assert.equal(modelsResponse.status, 200);
    const models = (await modelsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(models.data.some((model) => model.id === agent.id));

    const completionResponse = await fetch(`${listening.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: agent.id,
        user: "integration-client",
        messages: [{ role: "user", content: "hello over the OpenAI protocol" }],
      }),
    });
    assert.equal(completionResponse.status, 200);
    assert.match(completionResponse.headers.get("x-foundry-conversation-id") ?? "", /^openai-/);
    const completion = (await completionResponse.json()) as {
      object: string;
      choices: Array<{ message: { content: string } }>;
    };
    assert.equal(completion.object, "chat.completion");
    assert.match(completion.choices[0]?.message.content ?? "", /hello over the OpenAI protocol/);

    const streamingResponse = await fetch(`${listening.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: agent.id,
        stream: true,
        messages: [{ role: "user", content: "stream this reply" }],
      }),
    });
    assert.equal(streamingResponse.status, 200);
    assert.match(streamingResponse.headers.get("content-type") ?? "", /text\/event-stream/);
    const streamingBody = await streamingResponse.text();
    assert.match(streamingBody, /chat\.completion\.chunk/);
    assert.match(streamingBody, /\[DONE\]/);

    const capabilitiesResponse = await fetch(`${listening.url}/v1/capabilities`);
    assert.equal(capabilitiesResponse.status, 200);
    const capabilities = (await capabilitiesResponse.json()) as {
      protocols: {
        openaiResponses: { streaming: boolean };
        runControl: { steer: boolean; steeringMode: string };
        approvals: { list: boolean; resolve: boolean; default: string };
      };
    };
    assert.equal(capabilities.protocols.openaiResponses.streaming, true);
    assert.equal(capabilities.protocols.runControl.steer, true);
    assert.equal(capabilities.protocols.runControl.steeringMode, "interrupt-and-restart");
    assert.deepEqual(capabilities.protocols.approvals, {
      list: true,
      resolve: true,
      default: "deny",
    });
    assert.deepEqual(await control.approvals({ status: "pending" }), []);

    const responseResponse = await fetch(`${listening.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: agent.id,
        instructions: "Answer as the integration fixture.",
        input: "hello over the Responses protocol",
      }),
    });
    assert.equal(responseResponse.status, 200);
    assert.match(responseResponse.headers.get("x-foundry-conversation-id") ?? "", /^responses-/);
    const openAiResponse = (await responseResponse.json()) as {
      object: string;
      status: string;
      output: Array<{ content: Array<{ text: string }> }>;
      metadata: Record<string, string>;
    };
    assert.equal(openAiResponse.object, "response");
    assert.equal(openAiResponse.status, "completed");
    assert.match(openAiResponse.output[0]?.content[0]?.text ?? "", /Responses protocol/);
    assert.match(openAiResponse.metadata["glove.foundry.run_id"] ?? "", /.+/);

    const streamingResponsesResponse = await fetch(`${listening.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: agent.id,
        stream: true,
        input: [{
          role: "user",
          content: [{ type: "input_text", text: "stream a Responses reply" }],
        }],
      }),
    });
    assert.equal(streamingResponsesResponse.status, 200);
    assert.match(streamingResponsesResponse.headers.get("content-type") ?? "", /text\/event-stream/);
    const streamingResponsesBody = await streamingResponsesResponse.text();
    assert.match(streamingResponsesBody, /event: response\.created/);
    assert.match(streamingResponsesBody, /event: response\.in_progress/);
    assert.match(streamingResponsesBody, /event: response\.output_text\.delta/);
    assert.match(streamingResponsesBody, /event: response\.content_part\.done/);
    assert.match(streamingResponsesBody, /event: response\.completed/);

    const controlRunResponse = await fetch(`${listening.url}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: agent.id,
        conversation_id: "control-integration",
        message: "hello through asynchronous run control",
        context: { caller: "integration-test" },
      }),
    });
    assert.equal(controlRunResponse.status, 202);
    assert.match(controlRunResponse.headers.get("x-foundry-conversation-id") ?? "", /^control-/);
    const controlRun = (await controlRunResponse.json()) as { id: string; status: string };
    assert.equal(controlRun.status, "pending");
    const completedControlRun = await runtime.waitForRun<{ value: string }>(controlRun.id, {
      pollMs: 25,
      timeoutMs: 20_000,
    });
    assert.equal(completedControlRun?.status, "completed");

    const controlStatusResponse = await fetch(`${listening.url}/v1/runs/${controlRun.id}`);
    assert.equal(controlStatusResponse.status, 200);
    const controlStatus = (await controlStatusResponse.json()) as { output?: { value?: string } };
    assert.match(controlStatus.output?.value ?? "", /asynchronous run control/);

    const controlEventsResponse = await fetch(`${listening.url}/v1/runs/${controlRun.id}/events`);
    assert.equal(controlEventsResponse.status, 200);
    const controlEvents = (await controlEventsResponse.json()) as Array<{ type: string }>;
    assert.ok(controlEvents.some((event) => event.type === "run.completed"));

    const controlEventStreamResponse = await fetch(`${listening.url}/v1/runs/${controlRun.id}/events`, {
      headers: { accept: "text/event-stream" },
    });
    assert.equal(controlEventStreamResponse.status, 200);
    const controlEventStream = await controlEventStreamResponse.text();
    assert.match(controlEventStream, /data: \{"id"/);
    assert.match(controlEventStream, /"type":"run\.completed"/);

    const stopResponse = await fetch(`${listening.url}/v1/runs/${controlRun.id}/stop`, {
      method: "POST",
    });
    assert.equal(stopResponse.status, 200);
    const stopped = (await stopResponse.json()) as { id: string; stopped: boolean };
    assert.equal(stopped.id, controlRun.id);
    assert.equal(typeof stopped.stopped, "boolean");

    const steerResponse = await fetch(`${listening.url}/v1/runs/${controlRun.id}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guidance: "continue with the revised direction" }),
    });
    assert.equal(steerResponse.status, 202);
    const steered = (await steerResponse.json()) as {
      fromRunId: string;
      interrupted: boolean;
      run: { id: string; conversationId: string };
    };
    assert.equal(steered.fromRunId, controlRun.id);
    assert.equal(steered.interrupted, false, "a completed run becomes a follow-up without cancellation");
    assert.notEqual(steered.run.id, controlRun.id);
    assert.equal(steered.run.conversationId, completedControlRun?.conversationId);
    const completedSteer = await runtime.waitForRun<{ value: string }>(steered.run.id, {
      pollMs: 25,
      timeoutMs: 20_000,
    });
    assert.equal(completedSteer?.status, "completed");
    assert.match(completedSteer?.output?.value ?? "", /revised direction/);
    assert.ok(runtime.observability.list({ runId: steered.run.id }).some((event) => event.type === "run.steered"));

    const typedSteer = await handle.steer("follow the typed client direction");
    assert.equal(typedSteer.fromRunId, handle.id);
    assert.equal(typedSteer.interrupted, false);
    const completedTypedSteer = await typedSteer.run.wait({
      pollMs: 25,
      timeoutMs: 20_000,
    });
    assert.equal(completedTypedSteer.status, "completed");
    assert.match(String(completedTypedSteer.output?.value ?? ""), /typed client direction/);

    const detailedHealthResponse = await fetch(`${listening.url}/health/detailed`);
    assert.equal(detailedHealthResponse.status, 200);
    const detailedHealth = (await detailedHealthResponse.json()) as { runs: unknown[]; connections: unknown[] };
    assert.ok(detailedHealth.runs.length >= 6);
    assert.ok(Array.isArray(detailedHealth.connections));

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

    const dashboardResponse = await fetch(listening.url);
    const policy = dashboardResponse.headers.get("content-security-policy") ?? "";
    assert.match(policy, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    assert.match(policy, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
    const dashboard = await dashboardResponse.text();
    assert.match(dashboard, /Runtime inspector/);
    assert.match(dashboard, /data-brand="glove"/);
    assert.match(dashboard, /viewBox="0 0 1024 1024"/);
    assert.match(dashboard, /data-phosphor="agent"/);
    assert.match(dashboard, /data-phosphor="search"/);
    assert.match(dashboard, /data-phosphor="chat"/);
    assert.match(dashboard, /href="\/chat"/);
    assert.match(dashboard, /function renderChat\(\)/);
    assert.match(dashboard, /function liveAssistantMessage\(run\)/);
    assert.match(dashboard, /agent\.text_delta/);
    assert.match(dashboard, /function sendChat\(event,agent,conversation,activeRun\)/);
    assert.match(dashboard, /History comes from the agent's StoreAdapter/);
    assert.match(dashboard, /\/api\/conversations\//);
    assert.match(dashboard, /\/steer/);
    assert.match(dashboard, /\.chat-shell/);
    assert.match(dashboard, /Definitions and instances are intentionally separate/);
    assert.match(dashboard, /Run spine/);
    assert.match(dashboard, /Decision required/);
    assert.match(dashboard, /Approve this input/);
    assert.match(dashboard, /\/api\/approvals/);
    assert.match(dashboard, /\.approval-rail/);
    // Every truncated id ships with a copy affordance.
    assert.match(dashboard, /function copyButton\(value,label\)/);
    assert.match(dashboard, /function idCell\(value,extraClass\)/);
    // Run filters are URL state, so a filtered view stays shareable.
    assert.match(dashboard, /function runQuery\(\)/);
    assert.match(dashboard, /params\.get\("status"\)/);
    // Live events are coalesced, and a repaint restores what the operator was doing.
    assert.match(dashboard, /function scheduleRefresh\(\)/);
    assert.match(dashboard, /function captureView\(\)/);
    assert.match(dashboard, /function restoreView\(view\)/);
    // The Glove brand typefaces load, which means the CSP has to name their
    // origins -- the stylesheet import alone is not enough.
    assert.match(dashboard, /fonts\.googleapis\.com/);
    assert.match(dashboard, /DM Sans/);
    assert.match(dashboard, /JetBrains Mono/);

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

test("Foundry exposes exact adapter-backed conversation history", async () => {
  const [discovered] = await discoverAgents({ agentsDir });
  assert.ok(discovered);
  const store = new MemoryStore("foundry-transcript-test");
  await store.appendMessages([
    { sender: "user", text: "Persist this exact question." },
    { sender: "agent", text: "This exact answer is stored." },
  ]);
  await store.incrementTurn();
  await store.addTokens({ tokens_in: 7, tokens_out: 5 });
  const instance = createAgentInstance(discovered.route, {
    id: "transcript-agent",
    workspaceId: "transcript-workspace",
  });
  const conversation = createConversation(instance, {
    id: "transcript-conversation",
    title: "Durable transcript",
  });
  const data = new MemoryFoundryDataAdapter({
    agents: [instance],
    conversations: [conversation],
  });
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [{
      ...discovered,
      definition: Object.freeze({ ...discovered.definition, store: () => store }),
    }],
    application: defineApplication({ name: "Transcript test", data }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  const server = new FoundryServer(runtime, { port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const client = createFoundryClient({ baseUrl: listening.url });
    const transcript = await client.conversationTranscript(instance.id, conversation.id);
    assert.equal(transcript.persisted, true);
    assert.deepEqual(transcript.messages.map((message) => message.text), [
      "Persist this exact question.",
      "This exact answer is stored.",
    ]);
    assert.equal(transcript.turnCount, 1);
    assert.equal(transcript.tokenCount, 12);
    assert.deepEqual(transcript.tokenConsumption, { tokens_in: 7, tokens_out: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    const latest = await client.conversationTranscript(instance.id, conversation.id, { limit: 1 });
    assert.deepEqual(latest.messages.map((message) => message.text), [
      "This exact answer is stored.",
    ]);
    assert.deepEqual(latest.page, {
      offset: 1,
      limit: 1,
      total: 2,
      hasEarlier: true,
      hasLater: false,
    });
    const earlier = await client.conversationTranscript(instance.id, conversation.id, { offset: 0, limit: 1 });
    assert.deepEqual(earlier.messages.map((message) => message.text), [
      "Persist this exact question.",
    ]);
    assert.equal(earlier.page.hasLater, true);
    const renamed = await client.updateConversation(instance.id, conversation.id, {
      title: "Renamed durable transcript",
    });
    assert.equal(renamed.title, "Renamed durable transcript");
    assert.equal(
      (await client.conversationTranscript(instance.id, conversation.id)).conversation.title,
      "Renamed durable transcript",
    );

    const missingAgent = await fetch(
      `${listening.url}/api/conversations/${conversation.id}/messages`,
    );
    assert.equal(missingAgent.status, 400);
    const invalidLimit = await fetch(
      `${listening.url}/api/conversations/${conversation.id}/messages?agent=${instance.id}&limit=0`,
    );
    assert.equal(invalidLimit.status, 400);
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
  const sessionRequests: Array<{ accountId: string; operation: string }> = [];
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
      adapter: {
        deliver: (input, context) => {
          if (!context.withAccountSession) {
            return Effect.die(new Error("Expected an account session."));
          }
          return context.withAccountSession("transport:send", (session) => Effect.sync(() => ({
            id: `${(session as { prefix: string }).prefix}:${input.message}`,
          }))).pipe(Effect.orDie);
        },
      },
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
  const [discovered] = await discoverAgents({ agentsDir });
  const transportApp = defineAgentApplication({
    id: "transport-app",
    description: "Test transport application",
    transmissions: [transport],
    install: () => Effect.succeed({ tools: [] }),
  });
  const assistantInstance = createAgentInstance("assistant", {
    id: "assistant-control",
    installations: [{ kind: "application", id: transportApp.id }],
  });
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
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [{
      ...discovered!,
      definition: Object.freeze({
        ...discovered!.definition,
        components: composeAgent(transportApp),
        accountSessions: {
          identifier: "test-account-sessions",
          withSession(request, use) {
            sessionRequests.push({
              accountId: request.accountId,
              operation: request.operation,
            });
            return use({ prefix: "delivered" });
          },
        },
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
    const health = await client.health();
    assert.equal(health.agents, 1);
    assert.equal(health.capabilities, 1);
    assert.equal(health.surfaces, 0);

    const grant = await client.resolveGrant({
      runId: Schema.decodeUnknownSync(
        Schema.NonEmptyTrimmedString.pipe(Schema.brand("FoundryRunId")),
      )("run-control-plane"),
      agentId: binding.agentId,
    });
    assert.deepEqual(grant.capabilities, ["transport:send"]);

    const delivered = await runtime.dispatchOutbound({
      routeId: route.id,
      agentId: assistantInstance.id,
      runId: "run-control-plane",
      payload: { message: "hello" },
      applicationId: transportApp.id,
      transmissionId: transport.id,
    });
    assert.deepEqual(delivered, { id: "delivered:hello" });
    assert.deepEqual(sessionRequests, [{
      accountId: account.id,
      operation: "transport:send",
    }]);

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
