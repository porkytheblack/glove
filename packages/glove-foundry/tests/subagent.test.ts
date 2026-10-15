import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Displaymanager,
  Glove,
  getToolJsonSchema,
  type AgentControls,
  type ModelAdapter,
} from "glove-core";
import { Effect } from "effect";
import { z } from "zod";
import { defineSubagent } from "../src/definition.js";
import { configureLayer, defineLayer, defineSubscriber } from "../src/surfaces.js";

const model: ModelAdapter = {
  name: "subagent-test-model",
  setSystemPrompt: () => undefined,
  async prompt() {
    return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
  },
};

test("subagents resolve a least-privilege tool projection from the assembled parent at invocation time", async () => {
  const displayManager = new Displaymanager();
  const parent = new Glove({
    model,
    displayManager,
    systemPrompt: "Parent",
    compaction_config: { compaction_instructions: "Preserve test state." },
  }).build();
  parent.fold({
    name: "installed_read",
    description: "Read an installed resource",
    jsonSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    async do(input: { readonly path: string }) {
      return { status: "success", data: { path: input.path } };
    },
  });
  parent.fold({
    name: "installed_write",
    description: "A capability the delegate must not inherit",
    jsonSchema: { type: "object", additionalProperties: false },
    async do() {
      return { status: "success", data: null };
    },
  });

  let resolvedPrompt = "";
  const delegated = defineSubagent({
    name: "reader",
    description: "Read-only delegate",
    systemPrompt: "Read only.",
    model,
    tools: ({ parent: assembled, prompt }) => {
      resolvedPrompt = prompt;
      const source = assembled.tools.find((tool) => tool.name === "installed_read");
      assert.ok(source);
      return [{
        name: source.name,
        description: source.description,
        jsonSchema: getToolJsonSchema(source),
        async do(input, _display, _agent, signal) {
          return source.run(input, undefined, signal);
        },
      }];
    },
  });

  const parentControls = {
    glove: parent,
    store: parent.store,
    displayManager,
    forceCompaction: async () => undefined,
  } as unknown as AgentControls;
  const child = await delegated.factory({
    name: "reader",
    prompt: "Inspect /out/report.md",
    parentStore: parent.store,
    parentControls,
  });

  assert.equal(resolvedPrompt, "Inspect /out/report.md");
  assert.ok(child.tools.some((tool) => tool.name === "installed_read"));
  assert.ok(!child.tools.some((tool) => tool.name === "installed_write"));
  const read = child.tools.find((tool) => tool.name === "installed_read");
  assert.deepEqual(await read!.run({ path: "/out/report.md" }), {
    status: "success",
    data: { path: "/out/report.md" },
  });
});

test("subagents mount their own layers and subscribers for one invocation", async () => {
  const displayManager = new Displaymanager();
  const parent = new Glove({
    model,
    displayManager,
    systemPrompt: "Parent",
    compaction_config: { compaction_instructions: "Preserve test state." },
  }).build();
  const lifecycle: string[] = [];
  const events: string[] = [];
  const layer = defineLayer({
    id: "subagent-notes",
    description: "Mount a tool and record the context the layer saw",
    config: z.object({ label: z.string() }),
    setup: ({ glove, agentId, messageText, config }) => Effect.sync(() => {
      lifecycle.push(`layer:${agentId}:${config.label}:${messageText}`);
      glove.fold({
        name: "layer_tool",
        description: "Mounted by a subagent layer",
        inputSchema: z.object({}),
        async do() { return { status: "success" as const, data: null }; },
      });
      return () => { lifecycle.push("layer:disposed"); };
    }),
  });
  const subscriber = defineSubscriber({
    id: "subagent-audit",
    description: "Record the subagent's events",
    create: () => ({ async record(type: string) { events.push(type); } }),
  });

  const delegated = defineSubagent({
    name: "noted",
    description: "Delegate with its own surfaces",
    systemPrompt: "Take notes.",
    model,
    layers: [configureLayer(layer, { label: "research" })],
    subscribers: [subscriber],
  });
  const parentControls = {
    glove: parent,
    store: parent.store,
    displayManager,
    forceCompaction: async () => undefined,
  } as unknown as AgentControls;
  const child = await delegated.factory({
    name: "noted",
    prompt: "Summarise the brief",
    parentStore: parent.store,
    parentControls,
  });

  assert.deepEqual(lifecycle, ["layer:noted:research:Summarise the brief"]);
  assert.ok(child.tools.some((tool) => tool.name === "layer_tool"), "the layer mounted onto the child");
  await child.processRequest("Summarise the brief");
  assert.ok(events.length > 0, "the subscriber saw the child's events");
  assert.deepEqual(lifecycle, ["layer:noted:research:Summarise the brief", "layer:disposed"], "surfaces are disposed when the request ends");

  const seen = events.length;
  await child.processRequest("again");
  assert.equal(events.length, seen, "the subscriber is detached after the invocation");
  assert.equal(lifecycle.filter((entry) => entry === "layer:disposed").length, 1, "disposal runs once");
});
