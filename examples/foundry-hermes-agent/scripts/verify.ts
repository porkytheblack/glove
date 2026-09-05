import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoundryClient } from "glove-foundry/client";
import { FoundryRuntime, FoundryServer } from "glove-foundry";
import config from "../foundry.config.js";
import { listDeliveries } from "../lib/deliveries.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const live = process.argv.includes("--live");

async function waitForSettledRun(
  foundry: ReturnType<typeof createFoundryClient>,
  runId: string,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await foundry.getRun(runId);
    if (["completed", "failed", "cancelled", "suspended"].includes(run.status)) return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for Foundry run ${runId}.`);
}

async function waitForActivationRun(
  foundry: ReturnType<typeof createFoundryClient>,
  activationId: string,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = (await foundry.runs()).find((candidate) => {
      const input = candidate.input as { source?: { id?: string } } | undefined;
      return input?.source?.id === activationId;
    });
    if (run) return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for activation ${activationId}.`);
}

if (live && !process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
  throw new Error("verify:live requires GEMINI_API_KEY or OPENROUTER_API_KEY.");
}
const dataDirectory = await mkdtemp(resolve(tmpdir(), "foundry-hermes-verify-"));
if (!live) process.env.HERMES_FORCE_DEMO = "1";
process.env.HERMES_DATA_DIR = dataDirectory;
process.env.HERMES_MESSENGER_PROVIDER = "local";

const [
  { default: application },
  { default: mediaStudio },
  { default: externalTools },
  { hermesInstance },
  { chatInbound, chatOutbound, fileInbound, notificationOutbound },
  { hermesConversationStore },
] = await Promise.all([
  import("../foundry.application.js"),
  import("../agents/hermes/apps/media-studio.app.js"),
  import("../agents/hermes/mcp/external-tools.mcp.js"),
  import("../agents/hermes/instances.js"),
  import("../agents/hermes/topology.js"),
  import("../lib/stores.js"),
]);

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });

await runtime.start();
try {
  assert.deepEqual(runtime.manifest.agents.map((agent) => agent.id), ["hermes"]);
  assert.equal((await runtime.listRoutes()).length, 4);
  assert.equal((await runtime.listBindings()).length, 2);

  const capabilities = runtime.capabilityManifest("hermes");
  assert.deepEqual(capabilities.tools.map((item) => item.id).sort(), ["knowledge", "status"]);
  assert.deepEqual(capabilities.applications.map((item) => item.id).sort(), ["media-studio", "messaging"]);
  assert.deepEqual(capabilities.mcp.map((item) => item.id), [externalTools.id]);
  assert.deepEqual(capabilities.memory.map((item) => item.id), ["personal"]);
  assert.equal(capabilities.memory[0]?.ownership, "definition");
  assert.equal(capabilities.applications[0]?.ownership, "instance");

  const initial = (await runtime.listAgentInstances("hermes"))
    .find((agent) => agent.id === hermesInstance.id)!;
  assert.equal(initial.installations.length, 4);
  assert.equal(initial.installations.some((item) => item.id === externalTools.id), false);

  await runtime.uninstallCapability(initial.id, { kind: "application", id: mediaStudio.id });
  assert.equal((await runtime.listInstallations(initial.id)).some((item) => item.id === mediaStudio.id), false);
  await runtime.installCapability(initial.id, {
    kind: "application",
    id: mediaStudio.id,
    config: { provider: "fixture", candidates: 1 },
  });

  const listening = await server.listen();
  const foundry = createFoundryClient({ baseUrl: listening.url });

  const firstHandle = await foundry.send(
    initial.id,
    "hermes-main",
    "Inspect your current capabilities and report readiness.",
  );
  const first = await firstHandle.wait({ timeoutMs: 120_000 });
  assert.equal(first.status, "completed", first.error);
  assert.match(String(first.output?.value ?? ""), /Hermes completed/i);
  const reopenedStore = hermesConversationStore({
    agentId: initial.id,
    conversationId: "hermes-main",
  });
  let persistedMessages = await reopenedStore.getMessages();
  for (let attempt = 0; attempt < 50 && persistedMessages.length < 2; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    persistedMessages = await reopenedStore.getMessages();
  }
  assert.ok(
    persistedMessages.length >= 2,
    `Expected durable conversation messages, found ${persistedMessages.length}.`,
  );

  let loaded = (await runtime.listAgentInstances("hermes")).find((agent) => agent.id === initial.id)!;
  for (let attempt = 0; attempt < 50 && loaded.playbooks.length < 2; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    loaded = (await runtime.listAgentInstances("hermes")).find((agent) => agent.id === initial.id)!;
  }
  assert.equal(loaded.playbooks.length, 2);
  assert.ok(loaded.playbooks.every((playbook) => playbook.origin === "agent-definition"));
  const predefined = (await runtime.listActivations("hermes-home"))
    .find((activation) => activation.scheduleName === "daily-review");
  assert.equal(predefined?.timing.kind, "cron");

  const delegatedHandle = await foundry.send(
    initial.id,
    "hermes-main",
    "Delegate this research question to @researcher: why use a persistent workspace?",
  );
  const delegated = await delegatedHandle.wait({ timeoutMs: 120_000 });
  assert.equal(delegated.status, "completed", delegated.error);
  const delegatedEvents = await delegatedHandle.events();
  assert.ok(delegatedEvents.some((event) => event.type === "agent.subagent_invoked"));
  assert.ok(delegatedEvents.some((event) => event.type === "agent.subagent_completed"));

  const mediaHandle = await foundry.send(
    initial.id,
    "hermes-main",
    "Generate an image to verify the mounted media workflow.",
  );
  const media = await mediaHandle.wait({ timeoutMs: 120_000 });
  assert.equal(media.status, "completed", media.error);
  const mediaEvents = await mediaHandle.events();
  assert.ok(mediaEvents.some((event) => event.type === "agent.hermes.media.mounted"));
  assert.ok(mediaEvents.some((event) => event.type === "agent.tool_use_result"));

  const workspaceCheck = await (
    await foundry.send(initial.id, "hermes-main", "Run the deterministic workspace check.", {
      payload: { mode: "verify-workspace" },
    })
  ).wait({ timeoutMs: 120_000 });
  assert.equal(workspaceCheck.status, "completed", workspaceCheck.error);
  const workspaceValue = workspaceCheck.output?.value as {
    check?: string;
    workspace?: { path?: string; content?: string };
    schedule?: { data?: { commandId?: string } };
    mountedTools?: string[];
  };
  assert.equal(workspaceValue.check, "passed");
  assert.equal(workspaceValue.workspace?.path, "/out/foundry-hermes-verification.md");
  assert.match(workspaceValue.workspace?.content ?? "", /sandboxed workspace is writable/i);
  assert.ok(workspaceValue.mountedTools?.includes("workspace_write_file"));
  assert.ok(workspaceValue.mountedTools?.includes("execute_js_workflow"));
  assert.ok(workspaceValue.mountedTools?.includes("glove_image_generate"));

  const activationId = workspaceValue.schedule?.data?.commandId;
  assert.ok(activationId);
  assert.equal((await runtime.listActivations("hermes-home")).some((activation) => activation.id === activationId), true);
  const cancelled = await (
    await foundry.send(initial.id, "hermes-main", "Cancel the verification schedule.", {
      payload: { mode: "cancel-schedule", activationId },
    })
  ).wait({ timeoutMs: 120_000 });
  assert.equal(cancelled.status, "completed", cancelled.error);
  assert.equal(
    (await runtime.listActivations("hermes-home")).find((activation) => activation.id === activationId)?.status,
    "cancelled",
  );

  const sleepHandle = await foundry.send(
    initial.id,
    "hermes-main",
    "Suspend this check and wake later.",
    { payload: { mode: "sleep" } },
  );
  const slept = await waitForSettledRun(foundry, sleepHandle.id);
  assert.equal(slept.status, "completed", slept.error);
  assert.equal((slept.output as { status?: string } | undefined)?.status, "suspended");
  const sleepActivation = (await runtime.listActivations("hermes-home"))
    .find((activation) => activation.kind === "sleep");
  assert.ok(sleepActivation);
  const wakeRun = await waitForActivationRun(foundry, sleepActivation.id);
  assert.equal((await runtime.waitForRun(wakeRun.id, { timeoutMs: 120_000 }))?.status, "completed");
  let restoredSleep = (await runtime.listActivations("hermes-home"))
    .find((activation) => activation.id === sleepActivation.id);
  for (let attempt = 0; attempt < 50 && restoredSleep?.status !== "completed"; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    restoredSleep = (await runtime.listActivations("hermes-home"))
      .find((activation) => activation.id === sleepActivation.id);
  }
  assert.equal(restoredSleep?.status, "completed");

  const inbound = await runtime.dispatchInbound({
    routeId: chatInbound.id,
    eventId: "hermes-message-1",
    threadKey: "operator-thread",
    raw: { sender: "operator", thread: "operator-thread", text: "Hermes, summarize the current project." },
  });
  assert.equal(inbound.length, 1);
  const inboundResult = await runtime.waitForRun(inbound[0]!.id, { timeoutMs: 120_000 });
  assert.equal(inboundResult?.status, "completed", inboundResult?.error);
  assert.deepEqual(await runtime.dispatchInbound({
    routeId: chatInbound.id,
    eventId: "hermes-message-ignored",
    threadKey: "other-thread",
    raw: { sender: "operator", thread: "other-thread", text: "A message for someone else." },
  }), []);

  const fileRuns = await runtime.dispatchInbound({
    routeId: fileInbound.id,
    eventId: "hermes-file-1",
    threadKey: "file-thread",
    raw: { name: "brief.md", mediaType: "text/markdown", content: "# Brief\nBuild the launch plan." },
  });
  assert.equal(fileRuns.length, 1);
  assert.equal((await runtime.waitForRun(fileRuns[0]!.id, { timeoutMs: 120_000 }))?.status, "completed");

  const outbound = await runtime.dispatchOutbound({
    routeId: chatOutbound.id,
    agentId: initial.id,
    runId: first.id,
    payload: { thread: "operator-thread", text: "Hermes is ready." },
  });
  assert.match(String((outbound as { externalMessageId?: string }).externalMessageId), /^delivery-/);
  await runtime.dispatchOutbound({
    routeId: notificationOutbound.id,
    agentId: initial.id,
    runId: first.id,
    payload: { subject: "Verification", text: "Foundry Hermes passed." },
  });
  assert.equal(listDeliveries().length, 3);
  assert.ok(listDeliveries().some((delivery) => /Hermes completed/i.test(delivery.text)));

  const secondConversation = await foundry.createConversation(initial.id, {
    title: "A separate project",
    context: { channel: "test" },
  });
  const second = await (
    await foundry.send(initial.id, secondConversation.id, "Inspect your capabilities in this separate conversation.")
  ).wait({ timeoutMs: 120_000 });
  assert.equal(second.status, "completed", second.error);
  assert.equal((await foundry.conversations(initial.id)).length >= 4, true);

  const firstEvents = await firstHandle.events();
  const types = firstEvents.map((event) => event.type);
  assert.ok(types.includes("run.completed"));
  assert.ok(types.includes("agent.foundry.working-environment.mounted"));
  assert.ok(types.includes("agent.foundry.repl.mounted"));
  assert.ok(types.includes("agent.foundry.definition.memory.mounted"));
  assert.ok(types.includes("agent.foundry.definition.inboxes.loaded"));
  assert.ok(types.includes("agent.foundry.definition.playbooks.composed"));
  assert.ok(types.includes("agent.foundry.definition.schedules.loaded"));
  const scheduleSync = firstEvents.find((event) => event.type === "agent.foundry.core.command");
  assert.notEqual(
    (scheduleSync?.data as { id?: string } | undefined)?.id,
    "schedule_sync_unknown",
    "Execution child must receive its run identity.",
  );

  const recordedRuns = await foundry.runs();
  assert.equal(
    recordedRuns.some((run) => run.status === "pending" || run.status === "running"),
    false,
    "Verification must not leave unfinished execution work behind.",
  );
  process.stdout.write(JSON.stringify({
    status: "ok",
    mode: live ? "live" : "deterministic",
    url: listening.url,
    runs: recordedRuns.length,
    runStatuses: recordedRuns.reduce<Record<string, number>>((counts, run) => {
      counts[run.status] = (counts[run.status] ?? 0) + 1;
      return counts;
    }, {}),
    playbooks: loaded.playbooks.length,
    installations: (await runtime.listInstallations(initial.id)).length,
    activations: (await runtime.listActivations("hermes-home")).length,
    deliveries: listDeliveries().length,
    durableState: true,
  }, null, 2) + "\n");
} finally {
  await server.close();
  await runtime.stop();
  await rm(dataDirectory, { recursive: true, force: true });
}
