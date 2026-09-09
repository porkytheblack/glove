import type {
  Message,
  ModelAdapter,
  ModelPromptResult,
  NotifySubscribersFunction,
  PromptRequest,
  ToolCall,
} from "glove-core";
import { createAdapter } from "glove-core/models/providers";

function latestTurn(messages: ReadonlyArray<Message>) {
  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.sender !== "user") index--;
  const message = messages[index];
  const after = index >= 0 ? messages.slice(index + 1) : [];
  return { text: message?.text ?? "", toolCompleted: after.some((item) => item.tool_results?.length) };
}

export class HermesDemoModel implements ModelAdapter {
  readonly name = "foundry-hermes-demo";
  private prompted = false;
  setSystemPrompt(): void {}

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const turn = latestTurn(request.messages);
    if (this.prompted || turn.toolCompleted) {
      const text = `Hermes completed the requested operation through a typed Foundry surface: ${turn.text.slice(0, 120)}`;
      await notify("text_delta", { text });
      await notify("model_response_complete", {
        text,
        stop_reason: "end_turn",
        tokens_in: 32,
        tokens_out: 24,
      });
      return { messages: [{ sender: "agent", text }], tokens_in: 32, tokens_out: 24 };
    }
    this.prompted = true;

    const lower = turn.text.toLowerCase();
    const available = new Set(request.tools?.map((tool) => tool.name) ?? []);
    const selected = lower.includes("image") && available.has("glove_image_generate")
      ? {
          name: "glove_image_generate",
          input: {
            intent: "A calm bronze caduceus-inspired navigation mark on a midnight field, original and unbranded",
            size: "1024x1024",
            name: "hermes-foundry-check",
            tags: ["verification"],
          },
        }
      : (lower.includes("delegate") || lower.includes("@researcher")) && available.has("glove_invoke_subagent")
        ? {
            name: "glove_invoke_subagent",
            input: {
              name: "researcher",
              prompt: "Give a concise assessment of why persistent workspaces help autonomous agents.",
            },
          }
        : {
            name: "hermes_capabilities",
            input: {},
          };
    const callId = `demo-${selected.name}`;
    const call: ToolCall = {
      id: callId,
      tool_name: selected.name,
      input_args: selected.input,
    };
    await notify("tool_use", { id: callId, name: call.tool_name, input: call.input_args });
    await notify("model_response_complete", {
      text: "",
      tool_calls: [call],
      stop_reason: "tool_use",
      tokens_in: 20,
      tokens_out: 8,
    });
    return {
      messages: [{ sender: "agent", text: "", tool_calls: [call] }],
      tokens_in: 20,
      tokens_out: 8,
    };
  }
}

export class HermesWorkerModel implements ModelAdapter {
  readonly name: string;
  constructor(private readonly role: string) {
    this.name = `foundry-hermes-${role}`;
  }
  setSystemPrompt(): void {}
  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const ask = [...request.messages].reverse().find((message) => message.sender === "user")?.text ?? "the task";
    const text = `${this.role} completed an isolated assessment of: ${ask}`;
    await notify("text_delta", { text });
    await notify("model_response_complete", { text, stop_reason: "end_turn", tokens_in: 16, tokens_out: 18 });
    return { messages: [{ sender: "agent", text }], tokens_in: 16, tokens_out: 18 };
  }
}

export function hermesTextModel(): ModelAdapter {
  if (process.env.HERMES_FORCE_DEMO === "1") return new HermesDemoModel();
  const requested = process.env.HERMES_TEXT_PROVIDER ?? "auto";
  if ((requested === "gemini" || requested === "auto") && process.env.GEMINI_API_KEY) {
    return createAdapter({
      provider: "gemini",
      model: process.env.HERMES_TEXT_MODEL ?? "gemini-3.5-flash-lite",
      apiKey: process.env.GEMINI_API_KEY,
      stream: true,
      maxTokens: 12_000,
    });
  }
  if ((requested === "openrouter" || requested === "auto") && process.env.OPENROUTER_API_KEY) {
    return createAdapter({
      provider: "openrouter",
      model: process.env.HERMES_OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
      apiKey: process.env.OPENROUTER_API_KEY,
      stream: true,
      maxTokens: 12_000,
    });
  }
  return new HermesDemoModel();
}
