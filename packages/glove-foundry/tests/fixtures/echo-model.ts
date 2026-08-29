import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
} from "glove-core";

export class FoundryEchoModel implements ModelAdapter {
  readonly name = "foundry-echo";

  setSystemPrompt(_prompt: string): void {}

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const last = [...request.messages]
      .reverse()
      .find((message) => message.sender === "user");
    const text = `[foundry-echo] ${last?.text ?? ""}`;
    await notify("text_delta", { text });
    await notify("model_response_complete", {
      text,
      stop_reason: "end_turn",
      tokens_in: 2,
      tokens_out: 3,
    });
    const message: Message = { sender: "agent", text };
    return { messages: [message], tokens_in: 2, tokens_out: 3 };
  }
}
