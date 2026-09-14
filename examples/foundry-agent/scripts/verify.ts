import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoundryClient } from "glove-foundry/client";
import { AgentId, FoundryRuntime, FoundryServer, RunId } from "glove-foundry";
import { Effect, Schema } from "effect";
import type { FoundryRoutes } from "../.foundry/routes.js";
import application from "../foundry.application.js";
import config from "../foundry.config.js";
import {
  supportInbound,
  supportOutbound,
} from "../agents/release-planner/topology.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const live = process.argv.includes("--live");

if (live && !process.env.OPENROUTER_API_KEY) {
  throw new Error(
    "verify:live requires OPENROUTER_API_KEY in the process environment.",
  );
}
if (!live) process.env.FOUNDRY_FORCE_DEMO = "1";

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  config,
});
const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });

await runtime.start();
try {
  assert.equal((await runtime.listRoutes()).length, 2);
  assert.equal((await runtime.listPlaybookSubscriptions()).length, 0);
  assert.equal((await runtime.listBindings()).length, 1);
  const capabilities = runtime.capabilityManifest("release-planner");
  assert.equal(capabilities.tools.length, 1);
  assert.equal(capabilities.applications.length, 1);
  assert.equal(capabilities.mcp.length, 1);
  assert.equal(capabilities.memory.length, 1);
  assert.equal(capabilities.applications[0]?.ownership, "instance");
  assert.equal(capabilities.memory[0]?.ownership, "definition");
  const surfaces = runtime.nativeManifest("release-planner");
  assert.equal(surfaces.layers.length, 1);
  assert.equal(surfaces.subscribers.length, 1);
  const releaseDefinition = runtime.manifest.agents.find(
    (agent) => agent.id === "release-planner",
  );
  assert.equal(releaseDefinition?.assembly, "foundry");
  assert.equal(releaseDefinition?.inboxLoader, true);
  assert.deepEqual(releaseDefinition?.layers, ["request-context"]);
  assert.equal(releaseDefinition?.workingEnvironment, true);
  assert.equal(releaseDefinition?.repl, "dynamic");
  const releaseAgent = (await runtime.listAgentInstances("release-planner"))
    .find((item) => item.id === "release-planner-example")!;
  const releaseConversation = (await runtime.listConversations(releaseAgent.id))
    .find((item) => item.id === "release-planner-main")!;
  const typedAgent = await runtime.createAgent("typed-handler", {
    id: "typed-handler-example",
    workspaceId: "example",
  });
  const typedConversation = await runtime.createConversation(typedAgent.id, {
    id: "typed-handler-main",
  });
  assert.equal((await runtime.listInstallations(releaseAgent.id)).length, 2);
  await runtime.uninstallCapability(releaseAgent.id, {
    kind: "tool",
    id: "release-clock",
  });
  assert.equal((await runtime.listInstallations(releaseAgent.id)).length, 1);
  await runtime.installCapability(releaseAgent.id, {
    kind: "tool",
    id: "release-clock",
  });
  assert.equal((await runtime.listInstallations(releaseAgent.id)).length, 2);
  const listening = await server.listen();
  const foundry = createFoundryClient<FoundryRoutes>({
    baseUrl: listening.url,
  });
  const handle = await foundry.send(releaseAgent.id, releaseConversation.id, [
    { type: "text", text: "Create the release plan" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    },
  ], { payload: {
    objective: "Ship the first Glove Foundry example",
    constraints: [
      "requests must be type-safe",
      "the full execution must be observable",
    ],
  } });
  const completed = await handle.wait({ timeoutMs: 120_000 });
  assert.equal(completed.status, "completed", completed.error);
  assert.match(String(completed.output?.value ?? ""), /Foundry|typed route/i);

  let composedAgent = (await runtime.listAgentInstances("release-planner"))
    .find((item) => item.id === releaseAgent.id)!;
  for (let attempt = 0; attempt < 50 && composedAgent.playbooks.length === 0; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    composedAgent = (await runtime.listAgentInstances("release-planner"))
      .find((item) => item.id === releaseAgent.id)!;
  }
  assert.equal(composedAgent.playbooks.length, 1);
  assert.equal(composedAgent.playbooks[0]?.origin, "agent-definition");
  let loadedSchedules = (await Effect.runPromise(runtime.data.listActivations("example")))
    .filter((activation) => activation.scheduleName === "release-readiness");
  for (let attempt = 0; attempt < 50 && loadedSchedules.length === 0; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    loadedSchedules = (await Effect.runPromise(runtime.data.listActivations("example")))
      .filter((activation) => activation.scheduleName === "release-readiness");
  }
  assert.equal(loadedSchedules.length, 1);
  assert.equal(loadedSchedules[0]?.origin, "agent-definition");
  assert.equal(loadedSchedules[0]?.timing.kind, "cron");
  const now = new Date().toISOString();
  await runtime.putPlaybookSubscription({
    id: "support-workforce-runtime",
    workspaceId: "example",
    enabled: true,
    playbook: composedAgent.playbooks[0]!,
    targets: [{
      definitionId: "release-planner",
      provisioning: { mode: "per-thread" },
      context: { role: "release-coordinator", source: "support" },
      installations: composedAgent.installations,
    }],
    createdAt: now,
    updatedAt: now,
  });
  assert.equal((await runtime.listPlaybookSubscriptions()).length, 1);

  const pausedInstance = await foundry.configureAgent(releaseAgent.id, {
    installations: composedAgent.installations.filter(
      (installation) => installation.kind !== "application",
    ),
    playbooks: [],
  });
  assert.equal(
    pausedInstance.installations.some(
      (installation) => installation.kind === "application",
    ),
    false,
  );
  assert.deepEqual(await runtime.dispatchInbound({
    routeId: supportInbound.id,
    eventId: "support-event-app-uninstalled",
    threadKey: "conversation-paused",
    raw: { conversationId: "conversation-paused", message: "A billing request that does not match." },
  }), []);
  const configuredInstance = await foundry.configureAgent(releaseAgent.id, {
    context: composedAgent.context,
    installations: composedAgent.installations,
    playbooks: composedAgent.playbooks,
  });
  assert.equal(configuredInstance.installations.length, 2);
  assert.equal(configuredInstance.playbooks.length, 1);
  const handled = await (
    await foundry.send(typedAgent.id, typedConversation.id, "Normalize this value", { payload: { value: "  NEXT FOR AGENTS  " } })
  ).wait();
  assert.equal(handled.status, "completed", handled.error);
  assert.deepEqual(handled.output?.value, {
    normalized: "next for agents",
    handledBy: "named-export-run",
  });

  const grant = await runtime.resolveGrant({
    runId: Schema.decodeUnknownSync(RunId)(completed.id),
    agentId: Schema.decodeUnknownSync(AgentId)(releaseAgent.id),
  });
  assert.deepEqual(grant.capabilities, ["support:reply"]);
  const outbound = await runtime.dispatchOutbound({
    routeId: supportOutbound.id,
    agentId: releaseAgent.id,
    runId: completed.id,
    payload: { conversationId: "conversation-42", message: "Release timing confirmed." },
  });
  assert.deepEqual(outbound, { externalMessageId: "example:conversation-42" });

  const inboundRuns = await runtime.dispatchInbound({
    routeId: supportInbound.id,
    eventId: "support-event-1",
    threadKey: "conversation-42",
    raw: { conversationId: "conversation-42", message: "A customer needs release timing." },
  });
  assert.equal(inboundRuns.length, 2);
  const inboundCompleted = await runtime.waitForRun(inboundRuns[0]!.id, { timeoutMs: 120_000 });
  assert.equal(inboundCompleted?.status, "completed", inboundCompleted?.error);
  const inboundRequest = inboundCompleted?.input as { message?: string; context?: { playbookIds?: string[] } };
  assert.match(inboundRequest.message ?? "", /<transmission direction="inbound"/);
  assert.match(inboundRequest.message ?? "", /<directive action="respond">/);
  assert.deepEqual(inboundRequest.context?.playbookIds, [composedAgent.playbooks[0]!.id]);

  const ignoredInbound = await runtime.dispatchInbound({
    routeId: supportInbound.id,
    eventId: "support-event-ignored",
    threadKey: "conversation-ignored",
    raw: { conversationId: "conversation-ignored", message: "A billing question without the matching topic." },
  });
  assert.deepEqual(ignoredInbound, []);

  const events = await handle.events();
  const eventTypes = events.map((event) => event.type);
  const eventDiagnostics = JSON.stringify(
    events.map((event) => ({ type: event.type, data: event.data })),
  );
  assert.ok(eventTypes.includes("run.completed"), eventDiagnostics);
  assert.ok(eventTypes.includes("agent.text_delta"), eventDiagnostics);
  assert.ok(
    eventTypes.includes("agent.foundry.layer.mounted"),
    eventDiagnostics,
  );
  assert.equal(
    eventTypes.filter(
      (type) => type === "agent.foundry.installation.completed",
    ).length,
    2,
    eventDiagnostics,
  );
  assert.ok(
    eventTypes.includes("agent.foundry.definition.memory.mounted"),
    eventDiagnostics,
  );
  assert.ok(
    eventTypes.includes("agent.foundry.definition.inboxes.loaded"),
    eventDiagnostics,
  );
  assert.ok(
    eventTypes.includes("agent.foundry.working-environment.mounted"),
    eventDiagnostics,
  );
  assert.ok(
    eventTypes.includes("agent.foundry.repl.mounted"),
    eventDiagnostics,
  );
  assert.ok(
    eventTypes.includes(
      "agent.foundry.application.transmission-tools.mounted",
    ),
    eventDiagnostics,
  );
  assert.ok(
    events.some((event) =>
      event.type === "agent.foundry.assembly.resolve.complete" &&
      (event.data as { field?: string; count?: number }).field === "tools" &&
      (event.data as { count?: number }).count === 3,
    ),
    eventDiagnostics,
  );
  if (!live) {
    assert.ok(eventTypes.includes("agent.tool_use"), eventDiagnostics);
    assert.ok(
      eventTypes.includes("agent.tool_use_result"),
      eventDiagnostics,
    );
  }

  process.stdout.write(`Foundry verification passed (${live ? "OpenRouter" : "demo"}).\n`);
  process.stdout.write(`Run: ${completed.id}\n`);
  process.stdout.write(`Events: ${events.length}\n`);
  process.stdout.write(`Output: ${JSON.stringify(completed.output)}\n`);
} finally {
  await server.close();
  await runtime.stop();
}
