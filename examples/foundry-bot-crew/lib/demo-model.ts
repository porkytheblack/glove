import type { Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, PromptRequest } from "glove-core";

/** What a scripted step sees: the message it is answering and what it has done since. */
export interface DemoTurn {
  /** The latest real message: the person, a transmission, a delegation or a task. */
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
 * small script, so `pnpm verify` can run the whole team offline. Real models
 * replace it as soon as a key is set.
 */
export class DemoModel implements ModelAdapter {
  readonly name: string;
  constructor(role: string, private readonly script: (turn: DemoTurn) => DemoStep) {
    this.name = `demo-${role}`;
  }
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest, notify?: NotifySubscribersFunction): Promise<ModelPromptResult> {
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
    await stream(message, notify);
    return { messages: [message], tokens_in: 1, tokens_out: 1 };
  }
}

/** Streams a scripted reply the way a real adapter does, a few words at a time, so a web app shows it arriving. */
async function stream(message: Message, notify?: NotifySubscribersFunction): Promise<void> {
  if (!notify) return;
  for (const chunk of message.text.match(/\S+\s*/g) ?? []) {
    await notify("text_delta", { text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  for (const call of message.tool_calls ?? []) await notify("tool_use", { id: call.id ?? call.tool_name, name: call.tool_name, input: call.input_args });
}
