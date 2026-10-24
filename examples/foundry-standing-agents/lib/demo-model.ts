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
  /** Runtime context for this turn, such as pinned memory. */
  readonly context: string;
}

export type DemoStep =
  | { readonly say: string }
  | { readonly call: string; readonly input: Record<string, unknown> };

/**
 * A stand-in for a real model, used when no API key is set. The dot and the
 * builder each get a small script, so `pnpm verify` runs offline. Real models
 * replace it as soon as a key is set.
 */
export class DemoModel implements ModelAdapter {
  readonly name: string;
  constructor(role: string, private readonly script: (turn: DemoTurn) => DemoStep) {
    this.name = `demo-${role}`;
  }
  setSystemPrompt(): void {}

  async prompt(request: PromptRequest): Promise<ModelPromptResult> {
    const context = request.messages.filter((message) => message.framework_context === "runtime").map((message) => message.text).join("\n");
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
      context,
    });
    const message: Message = "say" in step
      ? { sender: "agent", text: step.say }
      : { sender: "agent", text: "", tool_calls: [{ tool_name: step.call, input_args: step.input, id: `${step.call}-${Date.now()}` }] };
    return { messages: [message], tokens_in: 1, tokens_out: 1 };
  }
}

/** The event inside an inbound <transmission> message. */
export function inboundEvent<T>(text: string): T | undefined {
  const json = /<payload format="json">([\s\S]*?)<\/payload>/.exec(text)?.[1];
  if (!json) return undefined;
  return JSON.parse(json
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")) as T;
}

/** An attribute of the first <mesh-message> in a text. */
export function meshAttribute(text: string, name: string): string {
  return new RegExp(`<mesh-message[^>]* ${name}="([^"]*)"`).exec(text)?.[1] ?? "";
}

/** The body of the first <mesh-message> in a text. */
export function meshBody(text: string): string {
  return /<mesh-message[^>]*>\n([\s\S]*?)\n<\/mesh-message>/.exec(text)?.[1] ?? "";
}

/** The message of the last tool result, if it had one. */
export function resultMessage(lastResult: string): string {
  try {
    return String((JSON.parse(lastResult) as { message?: unknown }).message ?? "");
  } catch {
    return "";
  }
}
