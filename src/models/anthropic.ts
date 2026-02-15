import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import type {
  Message,
  ToolResult,
  ToolCall,
  Tool,
  PromptRequest,
  ModelPromptResult,
  ModelAdapter,
  NotifySubscribersFunction,
} from "../core";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AnthropicAdapterConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
}

// ─── Format conversion: Glove → Anthropic ─────────────────────────────────────

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;

function formatTools(tools: Array<Tool<unknown>>): Array<AnthropicTool> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.input_schema) as Anthropic.Tool.InputSchema,
  }));
}

function formatToolResultContent(tr: ToolResult): string {
  if (tr.result.status === "error") {
    const detail = tr.result.data ? JSON.stringify(tr.result.data) : "";
    return `Error: ${tr.result.message ?? "Unknown error"}\n${detail}`.trim();
  }
  return typeof tr.result.data === "string"
    ? tr.result.data
    : JSON.stringify(tr.result.data);
}

function formatMessage(msg: Message): AnthropicMessage {
  const role: "user" | "assistant" =
    msg.sender === "agent" ? "assistant" : "user";

  // tool results flowing back to the model
  if (role === "user" && msg.tool_results?.length) {
    return {
      role: "user",
      content: msg.tool_results.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.call_id ?? "_unknown",
        content: formatToolResultContent(tr),
        is_error: tr.result.status === "error",
      })),
    };
  }

  // assistant message that made tool calls
  if (role === "assistant" && msg.tool_calls?.length) {
    const content: Array<
      Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam
    > = [];

    if (msg.text?.length) {
      content.push({ type: "text" as const, text: msg.text });
    }

    for (const tc of msg.tool_calls) {
      content.push({
        type: "tool_use" as const,
        id: tc.id ?? `toolu_${crypto.randomUUID()}`,
        name: tc.tool_name,
        input: (tc.input_args ?? {}) as Record<string, unknown>,
      });
    }

    return { role: "assistant", content };
  }

  // plain text
  return { role, content: msg.text };
}

function formatMessages(messages: Array<Message>): Array<AnthropicMessage> {
  // convert & merge consecutive same-role messages
  const merged: Array<AnthropicMessage> = [];

  for (const msg of messages) {
    const formatted = formatMessage(msg);
    const prev = merged[merged.length - 1];

    if (prev && prev.role === formatted.role) {
      const prevContent = Array.isArray(prev.content)
        ? prev.content
        : [{ type: "text" as const, text: prev.content as string }];

      const newContent = Array.isArray(formatted.content)
        ? formatted.content
        : [{ type: "text" as const, text: formatted.content as string }];

      (prev as any).content = [...prevContent, ...newContent];
    } else {
      merged.push(formatted);
    }
  }

  // deduplicate tool_result blocks by tool_use_id
  for (const msg of merged) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;

    const seen = new Set<string>();
    (msg as any).content = (msg.content as any[]).filter((block: any) => {
      if (block.type !== "tool_result") return true;
      if (seen.has(block.tool_use_id)) return false;
      seen.add(block.tool_use_id);
      return true;
    });
  }

  // ensure every tool_use has a matching tool_result
  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const toolUseIds = (msg.content as any[])
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => b.id as string);

    if (toolUseIds.length === 0) continue;

    const next = merged[i + 1];
    if (!next || next.role !== "user") {
      merged.splice(i + 1, 0, {
        role: "user",
        content: toolUseIds.map((id) => ({
          type: "tool_result" as const,
          tool_use_id: id,
          content: "No result available",
        })),
      });
      continue;
    }

    const nextContent = Array.isArray(next.content)
      ? (next.content as any[])
      : [];

    const existingIds = new Set(
      nextContent
        .filter((b: any) => b.type === "tool_result")
        .map((b: any) => b.tool_use_id),
    );

    const missing = toolUseIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      const patches = missing.map((id) => ({
        type: "tool_result" as const,
        tool_use_id: id,
        content: "No result available",
      }));

      if (Array.isArray(next.content)) {
        (next as any).content = [...nextContent, ...patches];
      } else {
        (next as any).content = [
          { type: "text" as const, text: next.content as string },
          ...patches,
        ];
      }
    }
  }

  return merged;
}

// ─── Parse Anthropic response → Glove Message ────────────────────────────────

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

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class AnthropicAdapter implements ModelAdapter {
  name: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;

  constructor(config: AnthropicAdapterConfig) {
    this.name = `anthropic:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 8192;
    this.useStreaming = config.stream ?? false;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  setSystemPrompt(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const messages = formatMessages(request.messages);
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
      return this.promptStreaming(params, notify);
    }

    return this.promptSync(params, notify);
  }

  private async promptSync(
    params: Anthropic.MessageCreateParams,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const response = await this.client.messages.create({
      ...params,
      stream: false,
    });

    const message = parseResponse(response.content);

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: response.stop_reason,
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
  ): Promise<ModelPromptResult> {
    const stream = this.client.messages.stream(params);

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
      stop_reason: finalMessage.stop_reason,
    });

    return {
      messages: [message],
      tokens_in: finalMessage.usage.input_tokens,
      tokens_out: finalMessage.usage.output_tokens,
    };
  }
}
