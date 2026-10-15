import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
  ToolCall,
} from "glove-core";

/**
 * A deterministic stand-in used when OPENROUTER_API_KEY is absent, so a fresh
 * project runs end to end — real runs, real tool calls, a real event trace in
 * the inspector — before you have configured a provider.
 *
 * Each turn it searches flights, then answers. When the message arrived over
 * the chat transport (see README, "Send it a chat message"), it also replies
 * through the installed calendar app's messaging tool, which is what a real
 * model does when the playbook asks it to.
 *
 * Delete this file and the `model()` fallback in agent.ts once you have a key.
 */
const SEND_TOOL = "glove_app_calendar__messaging_send";

interface Inbound {
  readonly threadId: string;
  readonly text: string;
  readonly routeId: string;
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Read the event Foundry serialized into the turn for an inbound transmission. */
function inboundFrom(text: string): Inbound | undefined {
  if (!text.includes('<transmission direction="inbound"')) return undefined;
  const payload = /<payload format="json">([\s\S]*?)<\/payload>/.exec(text)?.[1];
  const routeId = /<outbound route="([^"]+)"/.exec(text)?.[1];
  if (!payload || !routeId) return undefined;
  const event = JSON.parse(unescapeXml(payload)) as { threadId?: string; text?: string };
  if (!event.threadId) return undefined;
  return { threadId: event.threadId, text: event.text ?? "", routeId: unescapeXml(routeId) };
}

export class DemoModel implements ModelAdapter {
  readonly name = "demo-model";
  private systemPrompt = "";

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    // Only this turn matters: everything from the latest user message onward.
    let userIndex = request.messages.length - 1;
    while (userIndex >= 0) {
      const message = request.messages[userIndex]!;
      if (message.sender === "user" && !message.tool_results?.length && !message.framework_context) break;
      userIndex--;
    }
    const turn = request.messages.slice(Math.max(userIndex, 0));
    const asked = request.messages[userIndex]?.text ?? "";
    const called = new Set(
      turn.flatMap((message) => message.tool_calls?.map((call) => call.tool_name) ?? []),
    );
    const inbound = inboundFrom(asked);
    const answer = [
      `Here is what I found for "${inbound?.text ?? asked}".`,
      "Three flights match. Meridian at 13:15 is the cheapest at $494; Northwind at 22:05 is the fastest at 9h.",
      "Tell me your dates and I will check the calendar and hold them.",
    ].join(" ");

    if (!called.has("find_flights")) {
      return this.callTool(notify, "call_demo_flights", "find_flights", {
        from: "LIS",
        to: "NBO",
        maxPrice: 5_000,
      });
    }

    const canReply = request.tools?.some((tool) => tool.name === SEND_TOOL) ?? false;
    if (inbound && canReply && !called.has(SEND_TOOL)) {
      return this.callTool(notify, "call_demo_reply", SEND_TOOL, {
        routeId: inbound.routeId,
        payload: { threadId: inbound.threadId, text: answer },
      });
    }

    const text = [
      answer,
      "",
      inbound
        ? canReply
          ? "(Replied to the traveller's chat thread — see the [telegram] line in the terminal.)"
          : "(This instance cannot reply over chat: install the calendar app and add a binding, as concierge-demo has.)"
        : "(This is the built-in demo model. Set OPENROUTER_API_KEY in .env.local for real answers.)",
    ].join("\n");
    await notify("text_delta", { text });
    await notify("model_response_complete", {
      text,
      stop_reason: "end_turn",
      tokens_in: 32,
      tokens_out: 48,
    });
    void this.systemPrompt;
    return { messages: [{ sender: "agent", text }], tokens_in: 32, tokens_out: 48 };
  }

  private async callTool(
    notify: NotifySubscribersFunction,
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ModelPromptResult> {
    // ToolCall's fields are optional, so notify() reads the local values.
    const call: ToolCall = { id, tool_name: name, input_args: input };
    await notify("tool_use", { id, name, input });
    await notify("model_response_complete", {
      text: "",
      tool_calls: [call],
      stop_reason: "tool_use",
      tokens_in: 14,
      tokens_out: 6,
    });
    const message: Message = { sender: "agent", text: "", tool_calls: [call] };
    return { messages: [message], tokens_in: 14, tokens_out: 6 };
  }
}
