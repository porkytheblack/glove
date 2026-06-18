import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  ContentPart,
  ToolResult,
  ToolCall,
  Tool,
  PromptRequest,
  ModelPromptResult,
  ModelAdapter,
  NotifySubscribersFunction,
  PromptCacheConfig,
  ResolvedPromptCache,
} from "../core";
import { getToolJsonSchema, resolvePromptCache } from "../core";
import { isString } from "effect/String";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AnthropicAdapterConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
  /** Request timeout in milliseconds. Defaults to 10 minutes (600000). */
  timeout?: number;
  /** Override the default Anthropic API base URL. Useful for proxies or Anthropic-compatible APIs. */
  baseURL?: string;
  /**
   * Prompt caching. Pass `true` to enable with defaults (cache breakpoints on
   * tools + system prompt and the latest conversation turn, 5-minute TTL), or
   * an object to tune the TTL (`{ ttl: "1h" }`). Defaults to off.
   *
   * Caching is a prefix match: the stable prefix (tools render before system)
   * is cached together, and the trailing turn is cached so each subsequent
   * request reuses the prior conversation. Below the model's minimum cacheable
   * prefix the API silently skips caching — no error. Inspect
   * `ModelPromptResult.cache_read_input_tokens` to confirm hits.
   */
  cache?: PromptCacheConfig;
}

// ─── Prompt cache helpers ──────────────────────────────────────────────────────

/**
 * Place `cache_control` breakpoints on an Anthropic request. Anthropic allows
 * at most 4 breakpoints; we use 2:
 *
 * 1. The stable prefix — a breakpoint on the last system block (tools render
 *    before system, so this caches tools + system together). When there's no
 *    system prompt but there are tools, the breakpoint moves to the last tool.
 * 2. The latest turn — a breakpoint on the last content block of the last
 *    message, so each follow-up request reads the whole prior conversation.
 */
export function applyAnthropicPromptCache(
  params: Anthropic.MessageCreateParams,
  cache: ResolvedPromptCache,
): Anthropic.MessageCreateParams {
  if (!cache.enabled) return params;

  const cache_control = { type: "ephemeral" as const, ttl: cache.ttl };
  const out: Anthropic.MessageCreateParams = { ...params };

  // 1. Stable prefix: prefer caching on the system prompt (covers tools too).
  let cachedPrefix = false;
  if (typeof out.system === "string" && out.system.length > 0) {
    out.system = [{ type: "text", text: out.system, cache_control }];
    cachedPrefix = true;
  } else if (Array.isArray(out.system) && out.system.length > 0) {
    const blocks = [...out.system];
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control };
    out.system = blocks;
    cachedPrefix = true;
  }
  // No system prompt — fall back to caching the tool list directly.
  if (!cachedPrefix && out.tools && out.tools.length > 0) {
    const tools = [...out.tools];
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control,
    } as Anthropic.ToolUnion;
    out.tools = tools;
  }

  // 2. Latest turn: breakpoint on the last block of the last message.
  if (out.messages.length > 0) {
    const messages = [...out.messages];
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];
    const content = Array.isArray(lastMsg.content)
      ? [...lastMsg.content]
      : lastMsg.content
        ? [{ type: "text" as const, text: lastMsg.content }]
        : [];
    if (content.length > 0) {
      content[content.length - 1] = {
        ...(content[content.length - 1] as Anthropic.ContentBlockParam),
        cache_control,
      } as Anthropic.ContentBlockParam;
      messages[lastIdx] = { ...lastMsg, content };
      out.messages = messages;
    }
  }

  return out;
}

// ─── Format conversion: Glove → Anthropic ─────────────────────────────────────

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;

function formatTools(tools: Array<Tool<unknown>>): Array<AnthropicTool> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: getToolJsonSchema(tool) as Anthropic.Tool.InputSchema,
  }));
}

function formatToolResultContent(tr: ToolResult): string {
  // Only send data/status/message to the model — renderData is client-only
  const { data, status, message } = tr.result;
  if (status === "error") {
    const detail = data ? isString(data) ? data : JSON.stringify(data) : "";
    return `Error: ${message ?? "Unknown error"}\n${detail}`.trim();
  }
  return typeof data === "string" ? data : JSON.stringify(data);
}

function formatContentParts(parts: ContentPart[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text) blocks.push({ type: "text", text: part.text });
        break;
      case "image":
        if (part.source) {
          blocks.push({
            type: "image",
            source: part.source.type === "url"
              ? { type: "url" as const, url: part.source.url! }
              : {
                  type: "base64" as const,
                  media_type: part.source.media_type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: part.source.data!,
                },
          });
        }
        break;
      case "document":
        if (part.source) {
          blocks.push({
            type: "document",
            source: part.source.type === "url"
              ? { type: "url" as const, url: part.source.url! }
              : {
                  type: "base64" as const,
                  media_type: part.source.media_type as "application/pdf",
                  data: part.source.data!,
                },
          });
        }
        break;
      case "video":
        // Anthropic doesn't natively support video — include as text note
        blocks.push({
          type: "text",
          text: `[Video attachment: ${part.source?.media_type ?? "video"}]`,
        });
        break;
    }
  }
  return blocks;
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

  // multimodal content
  if (msg.content?.length) {
    return { role, content: formatContentParts(msg.content) };
  }

  // plain text
  return { role, content: msg.text };
}

export function formatAnthropicMessages(messages: Array<Message>): Array<AnthropicMessage> {
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
  private cache: ResolvedPromptCache;

  constructor(config: AnthropicAdapterConfig) {
    this.name = `anthropic:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 8192;
    this.useStreaming = config.stream ?? false;
    this.cache = resolvePromptCache(config.cache);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.timeout != null && { timeout: config.timeout }),
      ...(config.baseURL != null && { baseURL: config.baseURL }),
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

    const params: Anthropic.MessageCreateParams = applyAnthropicPromptCache(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        messages,
        ...(this.systemPrompt && { system: this.systemPrompt }),
        ...(tools && { tools }),
      },
      this.cache,
    );

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

    const cacheRead = response.usage.cache_read_input_tokens ?? undefined;
    const cacheCreate = response.usage.cache_creation_input_tokens ?? undefined;

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: response.stop_reason ?? undefined,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    });

    return {
      messages: [message],
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
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

    const cacheRead = finalMessage.usage.cache_read_input_tokens ?? undefined;
    const cacheCreate =
      finalMessage.usage.cache_creation_input_tokens ?? undefined;

    await notify("model_response_complete", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: finalMessage.stop_reason ?? undefined,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    });

    return {
      messages: [message],
      tokens_in: finalMessage.usage.input_tokens,
      tokens_out: finalMessage.usage.output_tokens,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    };
  }
}
