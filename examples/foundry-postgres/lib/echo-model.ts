import type { Message, ModelAdapter, ModelPromptResult, NotifySubscribersFunction, PromptRequest } from "glove-core";

/** A model that repeats the last user message, so the example runs offline. */
export class EchoModel implements ModelAdapter {
  readonly name = "echo";
  setSystemPrompt(_prompt: string): void {}
  async prompt(request: PromptRequest, notify: NotifySubscribersFunction): Promise<ModelPromptResult> {
    const last = [...request.messages].reverse().find((message) => message.sender === "user");
    const text = `echo: ${last?.text ?? ""}`;
    await notify("model_response_complete", { text, stop_reason: "end_turn", tokens_in: 1, tokens_out: 1 });
    const message: Message = { sender: "agent", text };
    return { messages: [message], tokens_in: 1, tokens_out: 1 };
  }
}
