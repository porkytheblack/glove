import assert from "node:assert/strict";
import { test } from "node:test";
import { DASHBOARD_TRACE_SCRIPT } from "../src/dashboard-trace.js";
import { DASHBOARD_FOUNDRY_SCRIPT } from "../src/dashboard-foundry.js";
import { assemblyRecorder } from "../src/assembly-trace.js";

type Row = { key: string; dir: string; channel: string; title: string; preview: string; status: string; seenBy: string | null; childRunId?: string; nextRunAt?: string; injectedAt?: number };
const kit = new Function(`${DASHBOARD_TRACE_SCRIPT}\n${DASHBOARD_FOUNDRY_SCRIPT}; return { buildRunTrace, buildComposition, buildQueues, buildRunChain };`)() as {
  buildRunTrace(events: unknown[], run?: unknown): { items: Array<{ key: string; kind: string; sequence: number }> };
  buildComposition(events: unknown[]): {
    legacy: boolean; durationMs: number; steps: Array<{ step: string; label: string; tools: string[]; id?: string }>; origins: Record<string, { step: string; label: string }>;
    resolves: Array<{ field: string; durationMs: number; count?: number }>; apps: Array<{ id: string }>; schedules: Array<{ name: string }>; scheduled: Array<{ nextRunAt: string }>;
    memory: string[]; layers: string[]; delegates: Array<{ agent: string }>; workingEnvironment: unknown; repl: unknown;
  };
  buildQueues(events: unknown[], run: unknown, trace: unknown): Row[];
  buildRunChain(runId: string, runs: unknown[], events: unknown[]): {
    origin: { kind: string; id?: string } | null;
    ancestors: Array<{ id: string; edge: { label: string } }>;
    self: { id: string; children: Array<{ id: string; edge: { label: string }; children: Array<{ id: string; edge: { label: string } }> }> };
  };
};

function recorder(start = Date.parse("2026-10-26T10:00:00.000Z")) {
  const events: unknown[] = []; let sequence = 0; let clock = start;
  const push = (type: string, data: unknown, advance = 10, extra: Record<string, unknown> = {}) => {
    clock += advance;
    events.push({ id: `e${++sequence}`, sequence, timestamp: new Date(clock).toISOString(), type, category: "system", runId: "run_1", data, ...extra });
  };
  return { events, push };
}

test("the assembly recorder puts each tool under the step that folded it", () => {
  const tools: Array<{ name: string }> = [{ name: "glove_update_tasks" }];
  let now = 0;
  const assembly = assemblyRecorder({ tools }, () => now);
  assembly.mark("glove", "Glove built-ins");
  tools.push({ name: "spawn" }); now = 3;
  assembly.mark("foundry-core", "Foundry core tools");
  now = 3;
  assembly.mark("mesh", "Hosted mesh");
  now = 3;
  assembly.mark("installation", "release-clock", { keep: true, kind: "tool", id: "release-clock" });
  tools.push({ name: "notes_search" }); now = 8;
  assembly.mark("installation", "release-notes", { keep: true, kind: "application", id: "release-notes" });
  assert.deepEqual(assembly.steps.map((step) => `${step.label}:${step.tools.join(",")}:${step.ms}`), [
    "Glove built-ins:glove_update_tasks:0",
    "Foundry core tools:spawn:3",
    "release-clock::0",
    "release-notes:notes_search:5",
  ], "a step that added nothing and took no time is left out, an installation is kept");
});

test("composition lists each step's tools, the apps and what the definition loaded", () => {
  const { events, push } = recorder();
  push("agent.foundry.assembly.resolve.start", { field: "tools" }, 0);
  push("agent.foundry.assembly.resolve.complete", { field: "tools", count: 2 }, 12);
  push("agent.foundry.working-environment.mounted", { tools: ["read_file"], modules: ["fs"] });
  push("agent.foundry.definition.memory.mounted", { id: "release-context" });
  push("agent.foundry.layer.mounted", { id: "request-context" });
  push("scheduled-action.created", { commandId: "activation_1", recurring: true, nextRunAt: "2026-10-27T09:00:00.000Z" });
  push("agent.foundry.assembly.composed", {
    durationMs: 40,
    steps: [
      { step: "foundry-core", label: "Foundry core tools", tools: ["spawn", "sleep"], ms: 2 },
      { step: "workbench", label: "Working environment", tools: ["read_file"], ms: 20 },
      { step: "installation", label: "release-notes", kind: "application", id: "release-notes", tools: ["notes_search"], ms: 5 },
    ],
    tools: ["spawn", "sleep", "read_file", "notes_search"],
    installations: [{ kind: "application", id: "release-notes" }],
    apps: [{ id: "release-notes", description: "Notes", tools: [{ name: "notes_search", readOnly: true }] }],
    playbooks: [], schedules: [{ name: "release-readiness", timing: { kind: "cron", expression: "0 9 * * *", timezone: "UTC" }, enabled: true }],
    delegates: [{ agent: "coder", description: "Writes code" }], durableSubagents: [], openDelegations: 0,
    mesh: { hosted: false, transport: false, threads: 0 }, hooks: [], skills: [], subagents: [], calls: [], workingEnvironment: true, repl: false,
  });
  push("agent.turn_start", { turn_id: "t", trigger: "request" });
  const comp = kit.buildComposition(events);
  assert.equal(comp.legacy, false);
  assert.deepEqual(comp.origins.notes_search, { step: "installation", label: "release-notes" });
  assert.equal(comp.origins.read_file!.label, "Working environment");
  assert.deepEqual(comp.resolves.map((item) => `${item.field}:${item.durationMs}:${item.count}`), ["tools:12:2"]);
  assert.equal(comp.apps[0]!.id, "release-notes");
  assert.deepEqual(comp.memory, ["release-context"]);
  assert.deepEqual(comp.layers, ["request-context"]);
  assert.equal(comp.delegates[0]!.agent, "coder");
  assert.equal(comp.scheduled[0]!.nextRunAt, "2026-10-27T09:00:00.000Z");
  assert.ok(comp.workingEnvironment);
  assert.ok(comp.durationMs >= 40);
});

test("runs recorded before the composed event still list the tools mount events named", () => {
  const { events, push } = recorder();
  push("agent.foundry.application.transmission-tools.mounted", { tools: ["glove_app_notes__send"] });
  push("agent.foundry.application.mcp.mounted", { id: "mail", tools: ["mail_search"] });
  push("agent.foundry.installation.completed", { kind: "tool", id: "release-clock" });
  const comp = kit.buildComposition(events);
  assert.equal(comp.legacy, true);
  assert.deepEqual(comp.steps.map((step) => step.label), ["App transmissions", "mail", "release-clock"]);
  assert.equal(comp.origins.mail_search!.label, "mail");
});

test("queues list what started the run, what arrived, what went out, and which request saw each", () => {
  const { events, push } = recorder();
  const run = { id: "run_1", agent: "planner", status: "completed", createdAt: "2026-10-26T10:00:00.000Z", input: { message: "<transmission>A customer needs timing</transmission>", source: { kind: "transmission", id: "support-inbound", eventId: "ev-1", threadKey: "c-42" } } };
  push("agent.foundry.core.command", { id: "playbook_sync_1", type: "playbook.sync" });
  push("agent.event_received", { id: "d1", source: "foundry:route:support-inbound", kind: "transmission", disposition: "deferred", preview: "A customer needs timing" });
  push("agent.turn_start", { turn_id: "t1", trigger: "events" });
  push("agent.event_injected", { ids: ["d1"], phase: "wake" });
  push("agent.model_request", { request_id: "r1", model: "m", purpose: "turn", system_prompt: { hash: "h", chars: 1, text: "S" }, tools: { hash: "x", names: [] }, messages: { total: 1, kept: 0, added: [{ sender: "user", text: "hi" }] }, context: [] });
  push("agent.model_request_end", { request_id: "r1", model: "m", duration_ms: 10, status: "success", response: [{ sender: "agent", text: "", tool_calls: [{ id: "c1", tool_name: "delegate" }] }] });
  push("agent.foundry.core.command", { id: "cmd-d", type: "delegate", to: "coder", task: "Write the fix", delegationId: "delegation_1" });
  push("delegation.started", { delegationId: "delegation_1", to: "coder", workerAgentId: "w", workerRunId: "run_w" });
  push("agent.foundry.core.command", { id: "cmd-t", type: "transmit", routeId: "support-outbound", payload: { message: "On it" } });
  push("transmission.outbound.delivered", { commandId: "cmd-t", routeId: "support-outbound" });
  push("agent.foundry.core.command", { id: "cmd-s", type: "schedule", message: "Check in", timing: { kind: "every", intervalMs: 3_600_000 } });
  push("scheduled-action.created", { commandId: "cmd-s", recurring: true, nextRunAt: "2026-10-26T11:00:00.000Z" });
  push("agent.tool_use", { id: "p1", name: "glove_post_to_inbox", input: { tag: "refund", request: "Refund order 42", blocking: true } });
  push("agent.event_received", { id: "m1", source: "foundry:agent:coder", kind: "agent-message", disposition: "queued", preview: "Tests pass" });
  push("agent.inbox_injected", { ids: ["i1"], tags: ["refund"], phase: "loop" });
  push("agent.event_injected", { ids: ["m1"], phase: "loop" });
  push("agent.model_request", { request_id: "r2", model: "m", purpose: "turn", system_prompt: { hash: "h", chars: 1 }, tools: { hash: "x", names: [] }, messages: { total: 2, kept: 1, base: "r1", added: [{ sender: "user", text: "more" }] }, context: [] });
  push("agent.model_request_end", { request_id: "r2", model: "m", duration_ms: 10, status: "success", response: [{ sender: "agent", text: "Done" }] });
  push("agent.event_received", { id: "late", source: "foundry:agent:coder", kind: "agent-message", disposition: "dropped", preview: "Too late" });
  const trace = kit.buildRunTrace(events, run);
  const rows = kit.buildQueues(events, run, trace);
  const by = (title: string) => rows.find((row) => row.title.startsWith(title))!;
  assert.deepEqual(rows.map((row) => `${row.dir} ${row.channel}`), [
    "in transmission", "out delegation", "out transmission", "out schedule", "out inbox", "in agent message", "in inbox", "in agent message",
  ], "the run's own syncs aren't messages, and the delivery that started the run is its trigger");
  assert.equal(rows[0]!.status, "started the run");
  assert.equal(rows[0]!.seenBy, "m:r1");
  assert.equal(by("Delegate to coder").childRunId, "run_w");
  assert.equal(by("Delegate to coder").status, "started");
  assert.equal(by("Transmission support-outbound").status, "delivered");
  assert.equal(by("Schedule every 3600s").nextRunAt, "2026-10-26T11:00:00.000Z");
  assert.equal(by("Posted: refund").status, "posted, blocking");
  const message = rows.find((row) => row.preview === "Tests pass")!;
  assert.equal(message.status, "joined between tool steps");
  assert.equal(message.seenBy, "m:r2", "the request after it joined is the first to see it");
  assert.equal(by("Resolved: refund").seenBy, "m:r2");
  assert.equal(rows.at(-1)!.status, "dropped");
});

test("the call chain follows delegations, their reports, spawns and steering", () => {
  const runs = [
    { id: "R1", agent: "planner", status: "completed", createdAt: "2026-10-26T10:00:00.000Z", input: { source: { kind: "transmission", id: "support-inbound", eventId: "ev-1" } } },
    { id: "W1", agent: "coder", status: "completed", createdAt: "2026-10-26T10:00:01.000Z", input: { source: { kind: "delegation", id: "delegation_1" } } },
    { id: "Q1", agent: "planner", status: "completed", createdAt: "2026-10-26T10:00:03.000Z", input: { source: { kind: "delegation", id: "command_ask" } } },
    { id: "R2", agent: "planner", status: "cancelled", createdAt: "2026-10-26T10:00:05.000Z", input: { source: { kind: "delegation", id: "result:W1" } } },
    { id: "R3", agent: "planner", status: "completed", createdAt: "2026-10-26T10:00:06.000Z", input: { source: { kind: "direct" } } },
    { id: "S1", agent: "notifier", status: "completed", createdAt: "2026-10-26T10:00:02.000Z", input: { source: { kind: "spawn" } } },
  ];
  const events = [
    { id: "1", sequence: 1, timestamp: "2026-10-26T10:00:01.000Z", type: "delegation.started", runId: "R1", data: { delegationId: "delegation_1", to: "coder", workerRunId: "W1" } },
    { id: "2", sequence: 2, timestamp: "2026-10-26T10:00:02.000Z", type: "core.command.accepted", runId: "R1", data: { commandId: "c", childRunId: "S1", type: "spawn" } },
    { id: "3", sequence: 3, timestamp: "2026-10-26T10:00:03.000Z", type: "agent.foundry.core.command", runId: "W1", data: { id: "command_ask", type: "delegate.ask", delegationId: "delegation_1", question: "Which language?" } },
    { id: "4", sequence: 4, timestamp: "2026-10-26T10:00:04.000Z", type: "delegation.replied", runId: "Q1", data: { delegationId: "delegation_1", to: "coder" } },
    { id: "5", sequence: 5, timestamp: "2026-10-26T10:00:06.000Z", type: "run.steered", runId: "R3", data: { fromRunId: "R2", toRunId: "R3" } },
  ];
  const worker = kit.buildRunChain("W1", runs, events);
  assert.deepEqual(worker.ancestors.map((node) => `${node.id}`), ["R1"]);
  assert.deepEqual(worker.origin, { kind: "transmission", id: "support-inbound", provider: undefined, eventId: "ev-1", threadKey: undefined });
  assert.deepEqual(worker.self.children.map((child) => `${child.edge.label} ${child.id}`), ["asked Q1", "reported back R2"]);
  assert.deepEqual(worker.self.children[0]!.children.map((child) => `${child.edge.label} ${child.id}`), ["replied W1"], "the answer goes back to the worker, without walking it again");
  assert.deepEqual(worker.self.children[0]!.children[0]!.children, []);
  assert.deepEqual(worker.self.children[1]!.children.map((child) => `${child.edge.label} ${child.id}`), ["steered R3"]);
  const top = kit.buildRunChain("R1", runs, events);
  assert.deepEqual(top.self.children.map((child) => `${child.edge.label} ${child.id}`), ["delegated to coder W1", "spawned S1"]);
  assert.deepEqual(kit.buildRunChain("R3", runs, events).ancestors.map((node) => `${node.edge.label}:${node.id}`), ["delegated to coder:R1", "reported back:W1", "steered:R2"]);
});

test("a worker's question shows as delivered, then answered when the reply reaches it live", () => {
  const { events, push } = recorder();
  const run = { id: "W1", agent: "coder", status: "completed", createdAt: "2026-10-26T10:00:00.000Z", input: { message: "<delegated-task>Write slugify</delegated-task>", source: { kind: "delegation", id: "delegation_1" } } };
  push("agent.foundry.core.command", { id: "command_ask", type: "delegate.ask", delegationId: "delegation_1", question: "Which language?" });
  push("delegation.question", { delegationId: "delegation_1" });
  push("delegation.delivered", { conversationId: "delegation_1", mode: "live", count: 1 });
  const rows = kit.buildQueues(events, run, kit.buildRunTrace(events, run));
  assert.deepEqual(rows.map((row) => `${row.dir} ${row.title} ${row.status}`), [
    "in Delegated task started the run",
    "out Ask the delegator answered",
    "in Answer to: Which language? delivered",
  ]);
});
