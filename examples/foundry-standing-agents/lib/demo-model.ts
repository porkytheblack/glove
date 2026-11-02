import type { Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, PromptRequest } from "glove-core";

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

  async prompt(request: PromptRequest, notify?: NotifySubscribersFunction): Promise<ModelPromptResult> {
    const context = request.messages.filter((message) => message.framework_context === "runtime").map((message) => message.text).join("\n");
    const messages = request.messages.filter((message) => !message.framework_context || message.framework_context === "event");
    let start = messages.length - 1;
    while (start > 0 && (messages[start]!.sender !== "user" || messages[start]!.tool_results?.length)) start--;
    const after = messages.slice(start + 1);
    const called = after.flatMap((message) => message.tool_calls?.map((call) => call.tool_name) ?? []);
    const results = after.flatMap((message) => message.tool_results ?? []);
    const step = this.script({
      text: messages[start] ? eventText(messages[start]!) : "",
      called,
      lastResult: results.length > 0 ? JSON.stringify(results.at(-1)!.result) : "",
      results: results.map((item) => JSON.stringify(item.result)),
      context,
    });
    const message: Message = "say" in step
      ? { sender: "agent", text: step.say }
      : { sender: "agent", text: "", tool_calls: [{ tool_name: step.call, input_args: step.input, id: `${step.call}-${Date.now()}` }] };
    await stream(message, notify);
    return { messages: [message], tokens_in: 1, tokens_out: 1 };
  }
}

/** Streams a scripted reply the way a real adapter does, a few words at a time, so the web app shows it arriving. */
async function stream(message: Message, notify?: NotifySubscribersFunction): Promise<void> {
  if (!notify) return;
  for (const chunk of message.text.match(/\S+\s*/g) ?? []) {
    await notify("text_delta", { text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  for (const call of message.tool_calls ?? []) await notify("tool_use", { id: call.id ?? call.tool_name, name: call.tool_name, input: call.input_args });
}

/** The event inside an inbound <transmission> message. */
export function inboundEvent<T>(text: string): T | undefined {
  const json = /<payload format="json">([\s\S]*?)<\/payload>/.exec(text)?.[1];
  if (!json) return undefined;
  return JSON.parse(json
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")) as T;
}

/** An attribute of the first <delegation> in a text: a task's result, question or failure. */
export function delegationAttribute(text: string, name: string): string {
  return new RegExp(`<delegation [^>]*\\b${name}="([^"]*)"`).exec(text)?.[1] ?? "";
}

/** The result in the first completed <delegation> in a text. */
export function delegationResult(text: string): string {
  return /<delegation [^>]*>\n[\s\S]*?\nResult:\n([\s\S]*?)\n<\/delegation>/.exec(text)?.[1] ?? "";
}

/** The message of the last tool result, if it had one. */
export function resultMessage(lastResult: string): string {
  try {
    return String((JSON.parse(lastResult) as { message?: unknown }).message ?? "");
  } catch {
    return "";
  }
}

/**
 * The text of a message. Deliveries (a transmission, a delegation's result)
 * arrive as one Glove event message: the escaped body of each <event>, joined.
 */
export function eventText(message: Message): string {
  if (message.framework_context !== "event") return message.text;
  return [...message.text.matchAll(/<event [^>]*>\n([\s\S]*?)\n<\/event>/g)]
    .map((match) => match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&"))
    .join("\n\n");
}
