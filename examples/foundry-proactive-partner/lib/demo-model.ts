import type { Message, ModelAdapter, ModelPromptResult, PromptRequest } from "glove-core";

/** What a scripted step sees: the message it is answering and what it has done since. */
export interface DemoTurn {
  /** The latest real message: the person, a schedule, a transmission or another agent. */
  readonly text: string;
  /** Tools called since that message, in order. */
  readonly called: ReadonlyArray<string>;
  /** The last tool result, as JSON text. */
  readonly lastResult: string;
  /** Every tool result since that message, as JSON text, oldest first. */
  readonly results: ReadonlyArray<string>;
}

export type DemoStep =
  | { readonly say: string }
  | { readonly call: string; readonly input: Record<string, unknown> };

/**
 * A stand-in for a real model, used when no API key is set. Each bot gets a
 * small script, so `pnpm verify` can run offline. Real models
 * replace it as soon as a key is set.
 */
export class DemoModel implements ModelAdapter {
  readonly name: string;
  constructor(role: string, private readonly script: (turn: DemoTurn) => DemoStep) {
    this.name = `demo-${role}`;
  }
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const messages = request.messages.filter((message) => !message.framework_context);
    let start = messages.length - 1;
    while (start > 0 && (messages[start]!.sender !== "user" || messages[start]!.tool_results?.length)) start--;
    const after = messages.slice(start + 1);
    const called = after.flatMap((message) => message.tool_calls?.map((call) => call.tool_name) ?? []);
    const results = after.flatMap((message) => message.tool_results ?? []);
    const step = this.script({
      text: messages[start]?.text ?? "",
      called,
      lastResult: results.length > 0 ? JSON.stringify(results.at(-1)!.result) : "",
      results: results.map((item) => JSON.stringify(item.result)),
    });
    const message: Message = "say" in step
      ? { sender: "agent", text: step.say }
      : { sender: "agent", text: "", tool_calls: [{ tool_name: step.call, input_args: step.input, id: `${step.call}-${Date.now()}` }] };
    return { messages: [message], tokens_in: 1, tokens_out: 1 };
  }
}

/** An attribute of the first <mesh-message> in a text. */
export function meshAttribute(text: string, name: string): string {
  return new RegExp(`<mesh-message[^>]* ${name}="([^"]*)"`).exec(text)?.[1] ?? "";
}

/** The body of the first <mesh-message> in a text. */
export function meshBody(text: string): string {
  return /<mesh-message[^>]*>\n([\s\S]*?)\n<\/mesh-message>/.exec(text)?.[1] ?? "";
}
