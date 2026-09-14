import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
  ToolCall,
} from "glove-core";

/**
 * Deterministic two-turn model used by `pnpm verify` and by `pnpm dev` when
 * OPENROUTER_API_KEY is absent. It deliberately calls the example tool first,
 * so Foundry's model/tool/result observability is testable without network or
 * API spend.
 */
export class FoundryDemoModel implements ModelAdapter {
  readonly name = "foundry-demo-model";
  private systemPrompt = "";

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const toolCompleted = request.messages.some(
      (message) =>
        Array.isArray(message.tool_results) && message.tool_results.length > 0,
    );
    if (toolCompleted) {
      const userMessage = [...request.messages]
        .reverse()
        .find(
          (message) =>
            message.sender === "user" && !message.tool_results?.length,
        )?.text;
      let input: { objective?: string; constraints?: string[] } = {};
      try {
        input = JSON.parse(userMessage ?? "{}") as typeof input;
      } catch {
        input.objective = this.systemPrompt.match(/^Objective: (.+)$/m)?.[1] ?? userMessage;
      }
      const constraints = input.constraints?.length
        ? ` Constraints: ${input.constraints.join("; ")}.`
        : "";
      const text =
        `Plan for ${input.objective ?? "the objective"}: establish the typed route, ` +
        `run a deterministic verification, inspect the correlated event trace, ` +
        `then promote the same agent with OpenRouter.${constraints}`;
      await notify("text_delta", { text });
      await notify("model_response_complete", {
        text,
        stop_reason: "end_turn",
        tokens_in: 24,
        tokens_out: 35,
      });
      return {
        messages: [{ sender: "agent", text }],
        tokens_in: 24,
        tokens_out: 35,
      };
    }

    const callId = "call_foundry_context";
    const toolName = "inspect_foundry_capabilities";
    const call: ToolCall = {
      id: callId,
      tool_name: toolName,
      input_args: {},
    };
    await notify("tool_use", {
      id: callId,
      name: toolName,
      input: call.input_args,
    });
    await notify("model_response_complete", {
      text: "",
      tool_calls: [call],
      stop_reason: "tool_use",
      tokens_in: 12,
      tokens_out: 4,
    });
    const message: Message = {
      sender: "agent",
      text: "",
      tool_calls: [call],
    };
    return { messages: [message], tokens_in: 12, tokens_out: 4 };
  }
}
