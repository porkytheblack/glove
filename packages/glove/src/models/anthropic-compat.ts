import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  ToolCall,
  PromptRequest,
  ModelPromptResult,
  ModelAdapter,
  NotifySubscribersFunction,
} from "../core";
import { formatAnthropicMessages } from "./anthropic";

// Re-use the Anthropic adapter's formatting utilities
// but allow custom baseURL/apiKey for compatible APIs

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AnthropicCompatAdapterConfig {
  /** Base URL for the Anthropic-compatible API. Required. */
  baseURL: string;
  /** API key. Pass an empty string if the endpoint doesn't require auth. */
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
  /** Display name prefix, e.g. "my-proxy". Defaults to "anthropic-compat" */
  provider?: string;
  /** Request timeout in milliseconds. Defaults to 10 minutes (600000). */
  timeout?: number;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class AnthropicCompatAdapter implements ModelAdapter {
  name: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;

  constructor(config: AnthropicCompatAdapterConfig) {
    const provider = config.provider ?? "anthropic-compat";
    this.name = `${provider}:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 8192;
    this.useStreaming = config.stream ?? false;
    this.client = new Anthropic({
      apiKey: config.apiKey ?? "not-needed",
      baseURL: config.baseURL,
      ...(config.timeout != null && { timeout: config.timeout }),
    });
  }

  setSystemPrompt(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    const messages = formatAnthropicMessages(request.messages);
    const tools =
      request.tools?.length ? formatTools(request.tools) : undefined;

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
      ...(this.systemPrompt && { system: this.systemPrompt }),
      ...(tools && { tools }),
    };

    if (this.useStreaming) {
      return this.promptStreaming(params, notify, signal);
    }

    return this.promptSync(params, notify, signal);
  }

  private async promptSync(
    params: Anthropic.MessageCreateParams,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    const response = await this.client.messages.create({
      ...params,
      stream: false,
    }, signal ? { signal } : undefined);

    const message = parseResponse(response.content);

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: response.stop_reason ?? undefined,
    });

    return {
      messages: [message],
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    };
  }

  private async promptStreaming(
    params: Anthropic.MessageCreateParams,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    const stream = this.client.messages.stream(params, signal ? { signal } : undefined);

    if (signal) {
      signal.addEventListener("abort", () => stream.abort(), { once: true });
    }

    stream.on("text", (text) => {
      notify("text_delta", { text });
    });

    stream.on("contentBlock", (block) => {
      if (block.type === "tool_use") {
        notify("tool_use", {
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    });

    const finalMessage = await stream.finalMessage();
    const message = parseResponse(finalMessage.content);

    await notify("model_response_complete", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: finalMessage.stop_reason ?? undefined,
    });

    return {
      messages: [message],
      tokens_in: finalMessage.usage.input_tokens,
      tokens_out: finalMessage.usage.output_tokens,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

import type { Tool } from "../core";
import { getToolJsonSchema } from "../core";

function formatTools(tools: Array<Tool<unknown>>): Array<Anthropic.Tool> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: getToolJsonSchema(tool) as Anthropic.Tool.InputSchema,
  }));
}

function parseResponse(content: Anthropic.ContentBlock[]): Message {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        textParts.push(block.text);
        break;
      case "tool_use":
        toolCalls.push({
          tool_name: block.name,
          input_args: block.input,
          id: block.id,
        });
        break;
    }
  }

  return {
    sender: "agent",
    text: textParts.join(""),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}
