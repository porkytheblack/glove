import { MemoryStore, type Message, type ModelAdapter, type ModelPromptResult, type PromptRequest } from "glove-core";
import { z } from "zod";
import { defineAgent } from "../../../../src/index.js";
import { log } from "../../delegation-scripted.js";

function reply(message: Message): ModelPromptResult {
  return { messages: [message], tokens_in: 1, tokens_out: 1 };
}

// Delegates, then keeps working until the result joins its own turn.
class PlannerModel implements ModelAdapter {
  readonly name = "delegation-planner";
  setSystemPrompt(): void {}
  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const delivered = request.messages.find((message) =>
      message.framework_context === "event" && message.text.includes('status="completed"'));
    if (delivered) {
      const open = request.messages.filter((message) => message.framework_context === "runtime").at(-1)?.text ?? "";
      log("planner-heard", { stillListed: open.includes("delegation_") });
      const result = /Result:\n([\s\S]*?)\n<\/delegation>/.exec(delivered.text)?.[1] ?? "";
      return reply({ sender: "agent", text: `inline: ${result}` });
    }
    // Runtime context (the open-delegations list) rides at the tail; read past it.
    const last = [...request.messages].reverse().find((message) => message.framework_context !== "runtime")!;
    const call = last.tool_results?.length
      ? { tool_name: "pause", input_args: {} }
      : { tool_name: "glove_foundry_delegate", input_args: { to: "coder", task: "write hello" } };
    return reply({ sender: "agent", text: "", tool_calls: [{ ...call, id: `call-${Date.now()}` }] });
  }
}

export default defineAgent({
  description: "Hands work off and keeps going",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  delegates: [{ agent: "coder", description: "Writes code." }],
  tools: [{
    name: "pause",
    description: "Wait a moment.",
    inputSchema: z.object({}),
    async do() {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      return { status: "success" as const, data: "waited" };
    },
  }],
  model: () => new PlannerModel(),
  systemPrompt: "Fixture planner",
});
