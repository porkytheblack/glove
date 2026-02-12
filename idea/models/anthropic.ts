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
} from "../core"; // adjust path to wherever your core module lives

// ─── Adapter config ───────────────────────────────────────────────────────────

export interface AnthropicAdapterConfig {
  /** Model ID, e.g. "claude-sonnet-4-5-20250929", "claude-opus-4-6" */
  model: string;
  /** Max tokens per response (default: 8192) */
  maxTokens?: number;
  /** System prompt prepended to every request */
  systemPrompt?: string;
  /** API key. Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Stream tokens to notify function (default: false) */
  stream?: boolean;
}

// ─── Format conversion: Ozone → Anthropic ─────────────────────────────────────

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;

/**
 * Convert Ozone Tool[] to Anthropic tool definitions.
 */
function formatTools(tools: Array<Tool<unknown>>): Array<AnthropicTool> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.input_schema) as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Format a ToolResult's content into a string for Anthropic.
 */
function formatToolResultContent(tr: ToolResult): string {
  if (tr.result.status === "error") {
    const detail = tr.result.data ? JSON.stringify(tr.result.data) : "";
    return `Error: ${tr.result.message ?? "Unknown error"}\n${detail}`.trim();
  }
  return typeof tr.result.data === "string"
    ? tr.result.data
    : JSON.stringify(tr.result.data);
}

/**
 * Convert an Ozone Message → Anthropic MessageParam.
 *
 * Three cases:
 * 1. User message with tool_results → tool_result content blocks
 * 2. Agent message with tool_calls → text + tool_use content blocks
 * 3. Plain text → string content
 */
function formatMessage(msg: Message): AnthropicMessage {
  const role: "user" | "assistant" =
    msg.sender === "agent" ? "assistant" : "user";

  // Case 1: tool results flowing back to the model
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

  // Case 2: assistant message that made tool calls
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

  // Case 3: plain text
  return { role, content: msg.text };
}

/**
 * Convert full message history, merging consecutive same-role messages
 * and sanitizing tool_use / tool_result pairing.
 */
function formatMessages(messages: Array<Message>): Array<AnthropicMessage> {
  // ── Step 1: Convert & merge consecutive same-role messages ──────
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

  // ── Step 2: Deduplicate tool_result blocks by tool_use_id ───────
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

  // ── Step 3: Ensure every tool_use has a matching tool_result ────
  // Collect all tool_use IDs from assistant messages
  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const toolUseIds = (msg.content as any[])
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => b.id as string);

    if (toolUseIds.length === 0) continue;

    // The next message must be a user message with matching tool_results
    const next = merged[i + 1];
    if (!next || next.role !== "user") {
      // Insert a synthetic tool_result message
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

    // Check which IDs are missing from the next user message
    const nextContent = Array.isArray(next.content)
      ? (next.content as any[])
      : [];

    const existingIds = new Set(
      nextContent
        .filter((b: any) => b.type === "tool_result")
        .map((b: any) => b.tool_use_id)
    );

    const missing = toolUseIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      // Append missing tool_result blocks
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

// ─── Parse Anthropic response → Ozone Message ────────────────────────────────

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
      // thinking, redacted_thinking, etc. — skip
    }
  }

  return {
    sender: "agent",
    text: textParts.join(""),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

// ─── The Adapter ──────────────────────────────────────────────────────────────

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
    this.systemPrompt = config.systemPrompt;
    this.useStreaming = config.stream ?? false;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction
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
    notify: NotifySubscribersFunction
  ): Promise<ModelPromptResult> {
    const response = await this.client.messages.create({...params, stream: false});
    
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
    notify: NotifySubscribersFunction
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