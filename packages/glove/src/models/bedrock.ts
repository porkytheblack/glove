import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock,
  type ToolResultContentBlock,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
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

// ─── Config ───────────────────────────────────────────────────────────────────

export interface BedrockAdapterConfig {
  /** AWS region (defaults to AWS_REGION env var or "us-east-1") */
  region?: string;
  /** AWS access key ID (defaults to AWS_ACCESS_KEY_ID env var) */
  accessKeyId?: string;
  /** AWS secret access key (defaults to AWS_SECRET_ACCESS_KEY env var) */
  secretAccessKey?: string;
  /** AWS session token for temporary credentials (defaults to AWS_SESSION_TOKEN env var) */
  sessionToken?: string;
  /** Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0") */
  model: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Enable streaming (defaults to true) */
  stream?: boolean;
  /**
   * Prompt caching via Bedrock `cachePoint` checkpoints. Pass `true` to enable
   * with defaults — checkpoints are inserted after the tool list, after the
   * system prompt, and on the latest message. Only cache-capable models
   * (Anthropic Claude, Amazon Nova) honour them; others ignore the checkpoints.
   * Bedrock has no TTL knob, so the `ttl` option is ignored. Defaults to off.
   */
  cache?: PromptCacheConfig;
}

// Bedrock cachePoint block. Inline-typed because older `@aws-sdk` typings may
// not expose it on the content/system/tool unions.
const CACHE_POINT = { cachePoint: { type: "default" as const } };

/**
 * Insert Bedrock `cachePoint` checkpoints into a Converse request: after the
 * tool list, after the system prompt, and on the last message's content. Each
 * checkpoint caches everything before it, so the stable tool + system prefix
 * and the latest turn are reused across requests.
 */
export function applyBedrockPromptCache(
  params: ConverseCommandInput,
  cache: ResolvedPromptCache,
): ConverseCommandInput {
  if (!cache.enabled) return params;

  const out: ConverseCommandInput = { ...params };

  if (out.system && out.system.length > 0) {
    out.system = [...out.system, CACHE_POINT as never];
  }

  if (out.toolConfig?.tools && out.toolConfig.tools.length > 0) {
    out.toolConfig = {
      ...out.toolConfig,
      tools: [...out.toolConfig.tools, CACHE_POINT as never],
    };
  }

  if (out.messages && out.messages.length > 0) {
    const messages = [...out.messages];
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    messages[lastIdx] = {
      ...last,
      content: [...(last.content ?? []), CACHE_POINT as never],
    };
    out.messages = messages;
  }

  return out;
}

// ─── Format conversion: Glove → Bedrock ──────────────────────────────────────

// Use inline type to satisfy AWS SDK's discriminated union requirements
type BedrockTool = {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: unknown };
  };
};

function formatTools(tools: Array<Tool<unknown>>): BedrockTool[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: getToolJsonSchema(tool),
      },
    },
  }));
}

function formatToolResultContent(tr: ToolResult): ToolResultContentBlock[] {
  const { data, status, message } = tr.result;
  if (status === "error") {
    const detail = data ? (typeof data === "string" ? data : JSON.stringify(data)) : "";
    return [{ text: `Error: ${message ?? "Unknown error"}\n${detail}`.trim() }];
  }
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return [{ text }];
}

function formatContentParts(parts: ContentPart[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text) blocks.push({ text: part.text });
        break;
      case "image":
        if (part.source) {
          if (part.source.type === "base64" && part.source.data) {
            const format = part.source.media_type?.split("/")[1] as
              | "png"
              | "jpeg"
              | "gif"
              | "webp"
              | undefined;
            blocks.push({
              image: {
                format: format ?? "png",
                source: {
                  bytes: Buffer.from(part.source.data, "base64"),
                },
              },
            });
          } else if (part.source.type === "url" && part.source.url) {
            // Bedrock doesn't support URL images directly, note it
            blocks.push({
              text: `[Image URL: ${part.source.url}]`,
            });
          }
        }
        break;
      case "document":
        if (part.source) {
          if (part.source.type === "base64" && part.source.data) {
            const format = part.source.media_type?.split("/")[1] as
              | "pdf"
              | "csv"
              | "doc"
              | "docx"
              | "xls"
              | "xlsx"
              | "html"
              | "txt"
              | "md"
              | undefined;
            blocks.push({
              document: {
                format: format ?? "pdf",
                name: "document",
                source: {
                  bytes: Buffer.from(part.source.data, "base64"),
                },
              },
            });
          }
        }
        break;
      case "video":
        // Bedrock supports video for some models
        if (part.source) {
          if (part.source.type === "base64" && part.source.data) {
            const format = part.source.media_type?.split("/")[1] as
              | "mkv"
              | "mov"
              | "mp4"
              | "webm"
              | "three_gp"
              | "flv"
              | "mpeg"
              | "mpg"
              | "wmv"
              | undefined;
            blocks.push({
              video: {
                format: format ?? "mp4",
                source: {
                  bytes: Buffer.from(part.source.data, "base64"),
                },
              },
            });
          }
        }
        break;
    }
  }
  return blocks;
}

function formatMessage(msg: Message): BedrockMessage[] {
  const role: "user" | "assistant" = msg.sender === "agent" ? "assistant" : "user";

  // Tool results flowing back to the model
  if (role === "user" && msg.tool_results?.length) {
    return [
      {
        role: "user",
        content: msg.tool_results.map((tr) => ({
          toolResult: {
            toolUseId: tr.call_id ?? "_unknown",
            content: formatToolResultContent(tr),
            status: tr.result.status === "error" ? ("error" as const) : ("success" as const),
          },
        })),
      },
    ];
  }

  // Assistant message that made tool calls
  if (role === "assistant" && msg.tool_calls?.length) {
    const content: ContentBlock[] = [];

    if (msg.text?.length) {
      content.push({ text: msg.text });
    }

    for (const tc of msg.tool_calls) {
      // AWS SDK expects DocumentType which is a recursive JSON-like type
      // We cast through unknown since input_args is already JSON-serializable
      content.push({
        toolUse: {
          toolUseId: tc.id ?? `toolu_${crypto.randomUUID()}`,
          name: tc.tool_name,
          input: tc.input_args as unknown as Record<string, never> | undefined,
        },
      });
    }

    return [{ role: "assistant", content }];
  }

  // Multimodal content
  if (msg.content?.length) {
    return [{ role, content: formatContentParts(msg.content) }];
  }

  // Plain text
  return [{ role, content: [{ text: msg.text }] }];
}

export function formatBedrockMessages(messages: Array<Message>): BedrockMessage[] {
  const result: BedrockMessage[] = [];

  for (const msg of messages) {
    const formatted = formatMessage(msg);
    for (const m of formatted) {
      const prev = result[result.length - 1];
      // Merge consecutive messages with the same role
      if (prev && prev.role === m.role) {
        prev.content = [...(prev.content ?? []), ...(m.content ?? [])];
      } else {
        result.push(m);
      }
    }
  }

  // Deduplicate tool results by toolUseId
  for (const msg of result) {
    if (msg.role !== "user" || !msg.content) continue;

    const seen = new Set<string>();
    msg.content = msg.content.filter((block) => {
      if (!("toolResult" in block) || !block.toolResult) return true;
      const id = block.toolResult.toolUseId;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // Ensure every toolUse has a matching toolResult
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role !== "assistant" || !msg.content) continue;

    const toolUseIds: string[] = [];
    for (const block of msg.content) {
      if ("toolUse" in block && block.toolUse?.toolUseId) {
        toolUseIds.push(block.toolUse.toolUseId);
      }
    }

    if (toolUseIds.length === 0) continue;

    const next = result[i + 1];
    if (!next || next.role !== "user") {
      result.splice(i + 1, 0, {
        role: "user",
        content: toolUseIds.map((id) => ({
          toolResult: {
            toolUseId: id,
            content: [{ text: "No result available" }],
          },
        })),
      });
      continue;
    }

    const existingIds = new Set<string>();
    for (const block of next.content ?? []) {
      if ("toolResult" in block && block.toolResult?.toolUseId) {
        existingIds.add(block.toolResult.toolUseId);
      }
    }

    const missing = toolUseIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      next.content = [
        ...(next.content ?? []),
        ...missing.map((id) => ({
          toolResult: {
            toolUseId: id,
            content: [{ text: "No result available" }],
          },
        })),
      ];
    }
  }

  return result;
}

// ─── Parse Bedrock response → Glove Message ─────────────────────────────────

function parseResponse(content: ContentBlock[]): Message {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if ("text" in block && block.text) {
      textParts.push(block.text);
    } else if ("toolUse" in block && block.toolUse) {
      toolCalls.push({
        tool_name: block.toolUse.name ?? "",
        input_args: block.toolUse.input,
        id: block.toolUse.toolUseId,
      });
    }
  }

  return {
    sender: "agent",
    text: textParts.join(""),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class BedrockAdapter implements ModelAdapter {
  name: string;
  private client: BedrockRuntimeClient;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;
  private cache: ResolvedPromptCache;

  constructor(config: BedrockAdapterConfig) {
    this.name = `bedrock:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 8192;
    this.useStreaming = config.stream ?? true;
    this.cache = resolvePromptCache(config.cache);

    const region = config.region ?? process.env.AWS_REGION ?? "us-east-1";
    const credentials =
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            ...(config.sessionToken && { sessionToken: config.sessionToken }),
          }
        : undefined;

    this.client = new BedrockRuntimeClient({
      region,
      ...(credentials && { credentials }),
    });
  }

  setSystemPrompt(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal
  ): Promise<ModelPromptResult> {
    const messages = formatBedrockMessages(request.messages);
    const tools = request.tools?.length ? formatTools(request.tools) : undefined;

    const params: ConverseCommandInput = applyBedrockPromptCache(
      {
        modelId: this.model,
        messages,
        inferenceConfig: {
          maxTokens: this.maxTokens,
        },
        ...(this.systemPrompt && {
          system: [{ text: this.systemPrompt }],
        }),
        ...(tools && { toolConfig: { tools: tools as ConverseCommandInput["toolConfig"] extends { tools?: infer T } ? T : never } }),
      },
      this.cache,
    );

    if (this.useStreaming) {
      return this.promptStreaming(params, notify, signal);
    }

    return this.promptSync(params, notify, signal);
  }

  private async promptSync(
    params: ConverseCommandInput,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal
  ): Promise<ModelPromptResult> {
    const command = new ConverseCommand(params);
    const response = await this.client.send(command, {
      abortSignal: signal,
    });

    const content = response.output?.message?.content ?? [];
    const message = parseResponse(content);

    const cacheRead = response.usage?.cacheReadInputTokens ?? undefined;
    const cacheCreate = response.usage?.cacheWriteInputTokens ?? undefined;

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: response.stopReason,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    });

    return {
      messages: [message],
      tokens_in: response.usage?.inputTokens ?? 0,
      tokens_out: response.usage?.outputTokens ?? 0,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    };
  }

  private async promptStreaming(
    params: ConverseCommandInput,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal
  ): Promise<ModelPromptResult> {
    const command = new ConverseStreamCommand(params);
    const response = await this.client.send(command, {
      abortSignal: signal,
    });

    let fullText = "";
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; input: string }
    >();
    let currentToolIndex = -1;

    let tokensIn = 0;
    let tokensOut = 0;
    let cacheRead: number | undefined;
    let cacheCreate: number | undefined;
    let stopReason: string | undefined;

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockStart) {
          const start = event.contentBlockStart;
          if (start.start?.toolUse) {
            currentToolIndex = start.contentBlockIndex ?? currentToolIndex + 1;
            toolCallAccumulator.set(currentToolIndex, {
              id: start.start.toolUse.toolUseId ?? `toolu_${crypto.randomUUID()}`,
              name: start.start.toolUse.name ?? "",
              input: "",
            });
          }
        }

        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (delta?.text) {
            fullText += delta.text;
            notify("text_delta", { text: delta.text });
          }
          if (delta?.toolUse?.input) {
            const idx = event.contentBlockDelta.contentBlockIndex ?? currentToolIndex;
            const acc = toolCallAccumulator.get(idx);
            if (acc) {
              acc.input += delta.toolUse.input;
            }
          }
        }

        if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
        }

        if (event.metadata) {
          tokensIn = event.metadata.usage?.inputTokens ?? 0;
          tokensOut = event.metadata.usage?.outputTokens ?? 0;
          cacheRead = event.metadata.usage?.cacheReadInputTokens ?? cacheRead;
          cacheCreate =
            event.metadata.usage?.cacheWriteInputTokens ?? cacheCreate;
        }
      }
    }

    const toolCalls: ToolCall[] = [];
    for (const [, acc] of toolCallAccumulator) {
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(acc.input);
      } catch {
        parsedInput = acc.input;
      }

      toolCalls.push({
        tool_name: acc.name,
        input_args: parsedInput,
        id: acc.id,
      });

      await notify("tool_use", {
        id: acc.id,
        name: acc.name,
        input: parsedInput,
      });
    }

    const message: Message = {
      sender: "agent",
      text: fullText,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    };

    await notify("model_response_complete", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: stopReason,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    });

    return {
      messages: [message],
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      ...(cacheRead != null && { cache_read_input_tokens: cacheRead }),
      ...(cacheCreate != null && { cache_creation_input_tokens: cacheCreate }),
    };
  }
}
