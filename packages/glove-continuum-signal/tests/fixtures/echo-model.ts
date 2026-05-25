import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
} from "glove-core";

/**
 * Test-only model adapter. Returns a single assistant message that echoes the
 * last user message's text, with no tool calls. Emits a `text_delta` event so
 * subscribers see something coming out of the model, then a
 * `model_response_complete` event.
 */
export class EchoModel implements ModelAdapter {
  name = "echo-model";
  private systemPrompt = "";

  setSystemPrompt(p: string): void {
    this.systemPrompt = p;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.sender === "user");
    const text = `[echo:${this.systemPrompt ? this.systemPrompt.slice(0, 8) : "agent"}] ${lastUser?.text ?? ""}`;
    await notify("text_delta", { text });
    const message: Message = { sender: "agent", text };
    await notify("model_response_complete", {
      text,
      stop_reason: "end_turn",
      tokens_in: 1,
      tokens_out: 1,
    });
    return {
      messages: [message],
      tokens_in: 1,
      tokens_out: 1,
    };
  }
}
