import { resolve } from "node:path";
import { MemoryStore, type ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { defineAgent, defineFacts, defineGoals, defineForms, foundryGuidanceSubject, type AgentAssemblyContext } from "glove-foundry";
import { identityGoal, intakeGoals, intakeForm, intakeForms, nameRequirement } from "./workflow.js";

const memory = (ctx: AgentAssemblyContext) => createSqliteMemoryAdapters({
  file: resolve(process.env.FOUNDRY_GUIDANCE_DB ?? ".foundry/guidance.sqlite"),
  namespace: foundryGuidanceSubject(ctx, "instance"), schema: new MemorySchema(),
});

/** No-key smoke test. Live mode uses the same tools and saved state. */
function demoModel(): ModelAdapter {
  let pass = 0;
  return { name: "guided-intake-demo", setSystemPrompt() {}, async prompt(input) {
    const text = input.messages.filter(m => m.sender === "user" && !m.framework_context && !m.tool_results?.length).at(-1)?.text ?? "";
    const name = /(?:my name is|call me)\s+([\p{L} '-]+)/iu.exec(text)?.[1]?.trim();
    if (!name) return { messages: [{ sender: "agent", text: "What name would you like me to use? Try: My name is Mira." }], tokens_in: 0, tokens_out: 0 };
    const runtime = input.messages.filter(m => m.framework_context === "runtime").map(m => m.text).join("\n");
    const version = Number(/version (\d+)/.exec(runtime)?.[1] ?? 1);
    if (pass++ === 0 && !runtime.includes("intake (version " + version + "; completed)")) return {
      messages: [{ sender: "agent", text: "", tool_calls: [
        { id: "record-name", tool_name: "record_fact", input_args: { fact: `Preferred name: ${name}` } },
        { id: "complete-goal", tool_name: "glove_goal_update", input_args: { goalKey: identityGoal.key, completed: [nameRequirement.key], reason: "The user supplied a name", ifVersion: version } },
        { id: "fill-intake", tool_name: "glove_form_start", input_args: { form: intakeForm.id, values: { name } } },
      ] }], tokens_in: 0, tokens_out: 0,
    };
    const failed = input.messages.some(m => m.tool_results?.some(result => result.result.status === "error"));
    return { messages: [{ sender: "agent", text: failed ? "A workflow tool failed; please inspect the run before continuing." : `Thanks, ${name}. Your intake progress is saved.` }], tokens_in: 0, tokens_out: 0 };
  } };
}

export default defineAgent({
  description: "A restart-safe goals, facts, forms and custom-context example",
  systemPrompt: "Collect a preferred name conversationally. Capture facts, complete the identity goal, and fill the intake form. Do not claim a write succeeded unless its tool succeeded. Do not restart completed forms.",
  model: () => process.env.OPENROUTER_API_KEY && process.env.FOUNDRY_FORCE_DEMO !== "1"
    ? createAdapter({ provider: "openrouter", model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini" }) : demoModel(),
  // Only the transcript is transient in this example. The three workflow adapters below are durable.
  store: ({ conversationId }) => new MemoryStore(conversationId),
  facts: (_agent, ctx) => defineFacts({ adapter: memory(ctx).facts }),
  goals: (_agent, ctx) => defineGoals({ adapter: memory(ctx).goals, program: intakeGoals }),
  forms: (_agent, ctx) => defineForms({ adapter: memory(ctx).forms, registry: intakeForms }),
  contextProviders: (_agent, ctx) => [async signal => {
    signal?.throwIfAborted();
    return `Conversation preference: ${ctx.agentInstance.context.concise === false ? "Offer detail" : "Keep replies concise"}.`;
  }],
});
