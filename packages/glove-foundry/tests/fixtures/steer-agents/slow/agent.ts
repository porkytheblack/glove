import { appendFileSync } from "node:fs";
import { MemoryStore, type ModelAdapter, type ModelPromptResult, type PromptRequest } from "glove-core";
import { z } from "zod";
import { defineAgent } from "../../../../src/index.js";

// Each process appends what it did, so the test can order the two runs.
function log(event: string): void {
  const file = process.env.FOUNDRY_TEST_STEER_LOG;
  if (file) appendFileSync(file, `${JSON.stringify({ t: Date.now(), pid: process.pid, event })}\n`);
}

class ScriptedModel implements ModelAdapter {
  readonly name = "steer-fixture";
  setSystemPrompt(): void {}
  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const last = request.messages[request.messages.length - 1]!;
    if (last.tool_results?.length) {
      return { messages: [{ sender: "agent", text: "slow work done" }], tokens_in: 1, tokens_out: 1 };
    }
    if (last.text.includes("start-slow")) {
      return {
        messages: [{ sender: "agent", text: "", tool_calls: [{ tool_name: "slow_side_effect", input_args: {}, id: "call-1" }] }],
        tokens_in: 1,
        tokens_out: 1,
      };
    }
    log("replacement-model-call");
    return { messages: [{ sender: "agent", text: "changed course" }], tokens_in: 1, tokens_out: 1 };
  }
}

export default defineAgent({
  description: "Steering fixture with an uninterruptible side effect",
  store: ({ conversationId }) => new MemoryStore(conversationId),
  model: () => new ScriptedModel(),
  systemPrompt: "Steering fixture",
  tools: [{
    name: "slow_side_effect",
    description: "A side effect that must finish once started",
    inputSchema: z.object({}),
    unAbortable: true,
    async do() {
      log("tool-start");
      await new Promise((resolveWait) => setTimeout(resolveWait, 4_000));
      log("tool-side-effect-committed");
      return { status: "success" as const, data: "ok" };
    },
  }],
});
