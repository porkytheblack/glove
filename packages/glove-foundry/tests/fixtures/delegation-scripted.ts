import { appendFileSync } from "node:fs";
import type { Message, ModelAdapter, ModelPromptResult, PromptRequest } from "glove-core";

/** Each process appends what it did, so a test can read the order back. */
export function log(event: string, detail: Record<string, unknown> = {}): void {
  const file = process.env.FOUNDRY_TEST_DELEGATION_LOG;
  if (file) appendFileSync(file, `${JSON.stringify({ t: Date.now(), pid: process.pid, event, ...detail })}\n`);
}

type Step =
  | { readonly say: string }
  | { readonly call: string; readonly input: Record<string, unknown> };

/** A model that answers from the last user message, or finishes after a tool result. */
export class ScriptedModel implements ModelAdapter {
  readonly name = "delegation-fixture";
  constructor(
    private readonly script: (last: string) => Step,
    private readonly afterTool: (result: string) => string = () => "done",
  ) {}
  setSystemPrompt(): void {}
  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    // Runtime context (the open-delegations list) rides at the tail; read past it.
    const last = [...request.messages].reverse().find((message) => !message.framework_context)!;
    if (last.tool_results?.length) {
      const result = JSON.stringify(last.tool_results[0]!.result);
      return reply({ sender: "agent", text: this.afterTool(result) });
    }
    const step = this.script(last.text);
    if ("say" in step) return reply({ sender: "agent", text: step.say });
    return reply({
      sender: "agent",
      text: "",
      tool_calls: [{ tool_name: step.call, input_args: step.input, id: `call-${Date.now()}` }],
    });
  }
}

function reply(message: Message): ModelPromptResult {
  return { messages: [message], tokens_in: 1, tokens_out: 1 };
}

export function delegationIdIn(text: string): string {
  return /id="(delegation_[^"]+)"/.exec(text)?.[1] ?? "";
}
