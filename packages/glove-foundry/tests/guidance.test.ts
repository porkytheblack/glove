import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { MemoryStore, type IGloveRunnable, type ModelAdapter } from "glove-core";
import { InMemoryFactAdapter } from "glove-facts";
import { InMemoryGoalAdapter, InMemoryFormAdapter } from "glove-memory/in-memory";
import { MemorySchema } from "glove-memory/core";
import { defineForm, FormRegistry } from "glove-memory/forms";
import { z } from "zod";
import { defineAgentFromModule, FOUNDRY_EXECUTION_MARKER } from "../src/definition.js";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import { defineFacts, defineGoals, defineForms, foundryGuidanceSubject } from "../src/guidance.js";
import { preparationAgent } from "../../glove-facts/tests/agent.js";

const program = { key: "intake", goals: [{ key: "identity", title: "Identity", objective: "Learn the name", items: [{ key: "name", label: "Name" }] }] };
function envelope(conversationId = "conversation", message = "My name is Mira") {
  const now = new Date().toISOString();
  return { [FOUNDRY_EXECUTION_MARKER]: true,
    request: { agentId: "customer", conversationId, workspaceId: "workspace", message, source: { kind: "direct" } },
    agent: { id: "customer", definitionId: "intake", workspaceId: "workspace", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
    conversation: { id: conversationId, agentId: "customer", workspaceId: "workspace", context: {}, createdAt: now, updatedAt: now },
  };
}

test("named lazy fields mount native goals, facts, forms and live context without resetting progress", async () => {
  const goalAdapter = new InMemoryGoalAdapter();
  const factAdapter = new InMemoryFactAdapter();
  const formAdapter = new InMemoryFormAdapter({ schema: new MemorySchema() });
  const form = defineForm({ id: "intake", version: 1, name: "Intake", description: "Collect a name" })
    .step("identity", { title: "Identity" }, step => step.field("name", { schema: z.string(), label: "Name" })).build();
  const registry = new FormRegistry().register(form.id, { name: form.name, description: form.description, load: () => form });
  const store = new MemoryStore("guidance-test");
  let phase = 0;
  let rounds = 0;
  let runnable!: IGloveRunnable;
  const model: ModelAdapter = { name: "deterministic", setSystemPrompt() {}, async prompt(input) {
    const runtime = input.messages.filter(m => m.framework_context === "runtime").map(m => m.text).join("\n");
    assert.match(runtime, new RegExp(`phase=${phase}`));
    assert.match(runtime, /GOALS/);
    if (rounds++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [
      { id: "capture", tool_name: "record_fact", input_args: { fact: "Name is Mira" } },
      { id: "goal", tool_name: "glove_goal_update", input_args: { goalKey: "identity", completed: ["name"], reason: "User provided name", ifVersion: 1 } },
      { id: "form", tool_name: "glove_form_start", input_args: { form: form.id, values: { name: "Mira" } } },
    ] }], tokens_in: 1, tokens_out: 1 };
    return { messages: [{ sender: "agent", text: "Ready" }], tokens_in: 1, tokens_out: 1 };
  } };
  const definition = defineAgentFromModule("intake", {
    description: "Guided conversation", systemPrompt: "Help collect information", model, store: () => store,
    facts: (_agent, ctx) => { assert.ok(ctx.messageText); return defineFacts({ adapter: factAdapter }); },
    goals: () => Effect.succeed(defineGoals({ adapter: goalAdapter, program })),
    forms: () => defineForms({ adapter: formAdapter, registry }),
    contextProviders: (_agent, ctx) => [async signal => {
      assert.ok(signal); assert.equal(ctx.conversationId, "conversation"); return `phase=${phase}`;
    }],
    configure: (agent, ctx) => {
      runnable = agent;
      assert.ok(ctx.goals); assert.ok(ctx.facts); assert.ok(ctx.forms);
    },
  });
  await compileAgentDefinition(definition, "intake").handler!(envelope());
  phase = 1;
  await compileAgentDefinition(definition, "intake").handler!(envelope());
  const scope = { subject: foundryGuidanceSubject({ workspaceId: "workspace", agentId: "customer", conversationId: "conversation" }), key: program.key };
  assert.equal((await goalAdapter.get(scope))?.version, 2);
  assert.equal((await goalAdapter.get(scope))?.progress.identity.name.done, true);
  const savedForms = await formAdapter.findInstances({ subject: scope.subject });
  assert.equal(savedForms.length, 1);
  assert.equal(savedForms[0].status, "complete");
  assert.equal(savedForms[0].entries.name.revisions[0].value, "Mira");
  assert.ok(!(await runnable.getRuntimeContext()).some(m => m.text.includes("phase=")), "Foundry removes custom providers on cleanup");
  assert.ok(!(await store.getMessages()).some(m => m.framework_context === "runtime"));
});

test("scope keys isolate workspaces, instances and conversations and allow deliberate instance sharing", () => {
  const a = { workspaceId: "one", agentId: "customer", conversationId: "a" };
  assert.notEqual(foundryGuidanceSubject(a), foundryGuidanceSubject({ ...a, conversationId: "b" }));
  assert.notEqual(foundryGuidanceSubject(a), foundryGuidanceSubject({ ...a, workspaceId: "two" }));
  assert.equal(foundryGuidanceSubject(a, "instance"), foundryGuidanceSubject({ ...a, conversationId: "b" }, "instance"));
});

test("one scoped native preparer supports both goals and forms from host-verified facts", async () => {
  const goals = new InMemoryGoalAdapter();
  const facts = new InMemoryFactAdapter();
  const forms = new InMemoryFormAdapter({ schema: new MemorySchema() });
  const form = defineForm({ id: "profile", version: 1, name: "Profile", description: "Capture a name" })
    .step("identity", { title: "Identity" }, step => step.field("name", { schema: z.string(), label: "Name" })).build();
  const registry = new FormRegistry().register(form.id, { name: form.name, description: form.description, load: () => form });
  let preparationCalls = 0;
  const preparer = preparationAgent(async data => {
    preparationCalls++;
    return { proposals: data.requirements.map((requirement: { id: string }) => ({
      requirement: requirement.id, value: requirement.id.includes("/") ? true : "Mira",
      refs: data.facts.map((fact: { id: string; revision: number }) => ({ id: fact.id, revision: fact.revision })),
      strength: "sufficient", derivation: "explicit", explanation: "The verified profile contains the preferred name",
    })) };
  });
  const model: ModelAdapter = { name: "prepared-workflow", setSystemPrompt() {}, async prompt() {
    return { messages: [{ sender: "agent", text: "Prepared" }], tokens_in: 0, tokens_out: 0 };
  } };
  const definition = defineAgentFromModule("prepared", {
    description: "Prepared guided conversation", systemPrompt: "Read the prepared state", model,
    facts: defineFacts({ adapter: facts, preparationAgent: preparer }),
    goals: defineGoals({ adapter: goals, program, preparation: { rule: () => ({ kind: "information", criteria: "Preferred name is known" }) } }),
    forms: defineForms({ adapter: forms, registry, preparation: { rule: () => ({ kind: "information", criteria: "Preferred name" }) } }),
    configure: async (_agent, ctx) => {
      await ctx.facts!.record({ text: "Preferred name: Mira", verification: "verified", source: { kind: "person", id: "verified-profile", actor: "host" } }, { operationId: "profile-import" });
      await ctx.forms!.start(form.id);
    },
  });
  await compileAgentDefinition(definition, "prepared").handler!(envelope());
  const subject = foundryGuidanceSubject({ workspaceId: "workspace", agentId: "customer", conversationId: "conversation" });
  assert.equal((await goals.get({ subject, key: program.key }))?.progress.identity.name.done, true);
  assert.equal((await forms.findInstances({ subject }))[0].entries.name.revisions[0].value, "Mira");
  const state = await facts.withScope({ subject, context: "conversation-evidence" }, tx => tx.read());
  assert.ok(state.claims.filter(c => c.state === "accepted").length >= 2);
  assert.ok(preparationCalls >= 2);
});

test("preparation configuration fails closed without a dedicated agent", async () => {
  const definition = defineAgentFromModule("invalid-preparation", {
    description: "Invalid preparation fixture", systemPrompt: "Unused", run: () => "must not execute",
    goals: defineGoals({ adapter: new InMemoryGoalAdapter(), program,
      preparation: { rule: () => ({ kind: "information", criteria: "Name" }) } }),
  });
  await assert.rejects(compileAgentDefinition(definition, "invalid-preparation").handler!(envelope()), /dedicated preparationAgent/);
});
