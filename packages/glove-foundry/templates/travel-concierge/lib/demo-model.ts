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
 * Delete this file and the `model()` fallback in agent.ts once you have a key.
 */
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
    const toolCompleted = request.messages.some(
      (message) => Array.isArray(message.tool_results) && message.tool_results.length > 0,
    );

    if (!toolCompleted) {
      // First turn: call a real tool so the trace shows tool_use -> result.
      // ToolCall's fields are optional, so notify() reads the local literals.
      const callId = "call_demo_flights";
      const toolName = "find_flights";
      const input = { from: "LIS", to: "NBO", maxPrice: 5_000 };
      const call: ToolCall = { id: callId, tool_name: toolName, input_args: input };
      await notify("tool_use", { id: callId, name: toolName, input });
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

    const asked = [...request.messages]
      .reverse()
      .find((message) => message.sender === "user" && !message.tool_results?.length)?.text;
    const text = [
      `Here is what I found for "${asked ?? "your trip"}".`,
      "Three flights match. Meridian at 13:15 is the cheapest at $494; Northwind at 22:05 is the fastest at 9h.",
      "Tell me your dates and I will check the calendar and hold them.",
      "",
      "(This is the built-in demo model. Set OPENROUTER_API_KEY in .env.local for real answers.)",
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
}
