import OpenAI from "openai";
import type {
  Message,
  ToolResult,
  ToolCall,
  Tool,
  PromptRequest,
  ModelPromptResult,
  ModelAdapter,
  ModalitySupport,
  NotifySubscribersFunction,
} from "../core";
import { getToolJsonSchema } from "../core";
import { formatOpenAIContentParts, OPENAI_MODALITIES } from "./content";

// ─── Reasoning config ─────────────────────────────────────────────────────────

/**
 * Hints how much the model should think before answering. Sent as the top-level
 * `reasoning_effort` request field — broadly supported across OpenAI-compatible
 * reasoning models (GPT-5 / o-series, GLM-4.5/4.6, MiniMax M2.5, Kimi K2, etc.).
 *
 * `"minimal"` is GPT-5-specific; the rest are widely supported but have
 * provider-specific semantics (e.g. on adaptive models like `mimo-v2.5-pro`,
 * `"low"` and `"medium"` may suppress thinking instead of bounding it).
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Detailed reasoning options for the OpenAI-compatible adapter.
 *
 * Set `OpenAICompatAdapterConfig.reasoning = true` for sensible defaults
 * (capture reasoning into `Message.reasoning_content`, echo it back on tool
 * turns, no effort hint). Use this object for fine-grained control.
 */
export interface OpenAICompatReasoningOptions {
  /**
   * When true, wrap the model's reasoning trace in `<think>…</think>` and
   * prepend it to the visible `text` of the returned message. Defaults to
   * false — reasoning stays on `Message.reasoning_content` so renderers can
   * choose to surface it (or not).
   */
  includeInText?: boolean;

  /**
   * Echo the captured `reasoning_content` back on subsequent assistant turns
   * that produced tool_calls. Required by DeepSeek-R1, MiMo, and several other
   * reasoning models — they reject the request if the prior tool-calling turn
   * doesn't echo its reasoning. Defaults to true; providers that don't expect
   * the field ignore it.
   */
  echo?: boolean;

  /**
   * Hint how much the model should think before answering. Sent as the
   * top-level `reasoning_effort` request field. Pass through unchanged.
   */
  effort?: ReasoningEffort;

  /**
   * OpenRouter-style `reasoning` request object. Sent verbatim alongside any
   * `effort` set above. Useful when targeting OpenRouter or any provider that
   * documents the `reasoning` object on chat completions. See
   * https://openrouter.ai/docs/use-cases/reasoning-tokens for the
   * normalization OpenRouter performs across upstreams.
   */
  reasoningObject?: {
    effort?: "low" | "medium" | "high";
    max_tokens?: number;
    exclude?: boolean;
    enabled?: boolean;
  };

  /**
   * Anthropic-style `thinking` request object. Some Anthropic-compatible
   * OpenAI shims (proxies that translate to Claude over the OpenAI wire)
   * accept this directly. Sent verbatim.
   */
  thinking?: {
    type: "enabled" | "disabled";
    budget_tokens?: number;
  };

  /**
   * Arbitrary additional fields merged into the request body. Use for
   * provider-specific quirks not covered above — e.g. Qwen3 dashscope's
   * `enable_thinking: true` / `thinking_budget: 1024`. Fields here win over
   * the structured options on conflict.
   */
  extraBody?: Record<string, unknown>;
}

/**
 * Resolved reasoning configuration after normalizing the boolean shortcut.
 */
interface ResolvedReasoning {
  enabled: boolean;
  includeInText: boolean;
  echo: boolean;
  effort?: ReasoningEffort;
  reasoningObject?: OpenAICompatReasoningOptions["reasoningObject"];
  thinking?: OpenAICompatReasoningOptions["thinking"];
  extraBody?: Record<string, unknown>;
}

function resolveReasoning(
  config?: boolean | OpenAICompatReasoningOptions,
): ResolvedReasoning {
  if (config === undefined || config === false) {
    return { enabled: false, includeInText: false, echo: false };
  }
  if (config === true) {
    return { enabled: true, includeInText: false, echo: true };
  }
  return {
    enabled: true,
    includeInText: config.includeInText ?? false,
    echo: config.echo ?? true,
    ...(config.effort && { effort: config.effort }),
    ...(config.reasoningObject && { reasoningObject: config.reasoningObject }),
    ...(config.thinking && { thinking: config.thinking }),
    ...(config.extraBody && { extraBody: config.extraBody }),
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAICompatAdapterConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
  baseURL: string;
  /** Display name prefix, e.g. "openai", "gemini". Defaults to "openai-compat" */
  provider?: string;
  /**
   * Input modalities this endpoint accepts. Defaults to the real-OpenAI
   * baseline ({@link OPENAI_MODALITIES}). `createAdapter` passes the per-provider
   * set from the provider table. Parts whose modality isn't supported degrade
   * to a text note.
   */
  capabilities?: ModalitySupport;
  /** Request timeout in milliseconds. Useful for local LLMs that may be slow. Defaults to 10 minutes (600000). */
  timeout?: number;
  /**
   * Reasoning / thinking support for OpenAI-compatible reasoning models.
   *
   * - `undefined` / `false` (default): reasoning is ignored. Existing behavior.
   * - `true`: capture provider-emitted `reasoning_content` (DeepSeek-style) or
   *   `reasoning` (OpenRouter-style) into `Message.reasoning_content`, and
   *   echo it back on subsequent tool-calling assistant turns.
   * - object: fine-grained control. See {@link OpenAICompatReasoningOptions}.
   *
   * Works with DeepSeek-R1, Qwen3-Thinking, GLM-4.5/4.6, Kimi K2, MiniMax
   * M2.5, OpenRouter reasoning models, and any OpenAI-compatible endpoint
   * that follows the `reasoning_content` or `reasoning` field conventions.
   */
  reasoning?: boolean | OpenAICompatReasoningOptions;
}

// ─── Format conversion: Glove → OpenAI ──────────────────────────────────────

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam & {
  reasoning_content?: string;
};
type OpenAITool = OpenAI.Chat.ChatCompletionTool;

function formatTools(tools: Array<Tool<unknown>>): Array<OpenAITool> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: getToolJsonSchema(tool),
    },
  }));
}

function formatToolResultContent(tr: ToolResult): string {
  // Only send data/status/message to the model — renderData is client-only
  const { data, status, message } = tr.result;
  if (status === "error") {
    const detail = data ? (typeof data === "string" ? data : JSON.stringify(data)) : "";
    return `Error: ${message ?? "Unknown error"}\n${detail}`.trim();
  }
  return typeof data === "string" ? data : JSON.stringify(data);
}

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function formatMessage(
  msg: Message,
  echoReasoning: boolean,
  caps: ModalitySupport,
): OpenAIMessage[] {
  const role: "user" | "assistant" =
    msg.sender === "agent" ? "assistant" : "user";

  if (role === "user" && msg.tool_results?.length) {
    return msg.tool_results.map((tr) => ({
      role: "tool" as const,
      tool_call_id: tr.call_id ?? "_unknown",
      content: formatToolResultContent(tr),
    }));
  }

  if (role === "assistant" && msg.tool_calls?.length) {
    // Some reasoning providers (DeepSeek-R1, MiMo) reject multi-turn requests
    // where a tool-calling assistant turn doesn't echo its reasoning back.
    // Providers that don't expect the field ignore it, so when echo is on we
    // include it for any assistant turn that has one.
    const out: OpenAIMessage = {
      role: "assistant" as const,
      content: msg.text || null,
      tool_calls: msg.tool_calls.map((tc) => ({
        id: tc.id ?? `call_${crypto.randomUUID()}`,
        type: "function" as const,
        function: {
          name: tc.tool_name,
          arguments:
            typeof tc.input_args === "string"
              ? tc.input_args
              : JSON.stringify(tc.input_args ?? {}),
        },
      })),
    };
    if (echoReasoning && msg.reasoning_content) {
      out.reasoning_content = msg.reasoning_content;
    }
    return [out];
  }

  if (role === "assistant" && echoReasoning && msg.reasoning_content) {
    return [{
      role: "assistant" as const,
      content: msg.text,
      reasoning_content: msg.reasoning_content,
    }];
  }

  if (msg.content?.length && role === "user") {
    return [
      { role: "user" as const, content: formatOpenAIContentParts(msg.content, caps) },
    ];
  }

  return [{ role, content: msg.text }];
}

export function formatMessages(
  messages: Array<Message>,
  echoReasoning: boolean = false,
  caps: ModalitySupport = OPENAI_MODALITIES,
): OpenAIMessage[] {
  const flat: OpenAIMessage[] = [];
  for (const msg of messages) {
    flat.push(...formatMessage(msg, echoReasoning, caps));
  }

  const merged: OpenAIMessage[] = [];
  for (const msg of flat) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === "user" && msg.role === "user") {
      const prevText =
        typeof prev.content === "string" ? prev.content : String(prev.content);
      const newText =
        typeof msg.content === "string" ? msg.content : String(msg.content);
      (prev as any).content = prevText + "\n" + newText;
    } else {
      merged.push(msg);
    }
  }

  const seenToolCallIds = new Set<string>();
  const deduped: OpenAIMessage[] = [];
  for (const msg of merged) {
    if (msg.role === "tool") {
      const toolMsg = msg as OpenAI.Chat.ChatCompletionToolMessageParam;
      if (seenToolCallIds.has(toolMsg.tool_call_id)) continue;
      seenToolCallIds.add(toolMsg.tool_call_id);
    }
    deduped.push(msg);
  }

  const repaired: OpenAIMessage[] = [];
  for (let i = 0; i < deduped.length; i++) {
    repaired.push(deduped[i]);
    const msg = deduped[i];

    if (msg.role !== "assistant") continue;
    const assistantMsg =
      msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
    if (!assistantMsg.tool_calls?.length) continue;

    const expectedIds = new Set(
      (assistantMsg.tool_calls as OpenAI.Chat.ChatCompletionMessageToolCall[]).map(
        (tc) => tc.id,
      ),
    );

    const foundIds = new Set<string>();
    let j = i + 1;
    while (j < deduped.length && deduped[j].role === "tool") {
      const toolMsg =
        deduped[j] as OpenAI.Chat.ChatCompletionToolMessageParam;
      foundIds.add(toolMsg.tool_call_id);
      j++;
    }

    for (const id of expectedIds) {
      if (!foundIds.has(id)) {
        repaired.push({
          role: "tool" as const,
          tool_call_id: id,
          content: "No result available",
        });
      }
    }
  }

  return repaired;
}

// ─── Parse OpenAI response → Glove Message ──────────────────────────────────

/**
 * Read the reasoning trace from a response message. Providers expose it under
 * two field names today: `reasoning_content` (DeepSeek / MiMo / Qwen / GLM /
 * Kimi / MiniMax convention) and `reasoning` (OpenRouter's normalized field).
 * Some upstreams emit both; we prefer `reasoning_content` and fall back.
 */
function readReasoningFromMessage(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;
  const rc = m.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return rc;
  const r = m.reasoning;
  if (typeof r === "string" && r.length > 0) return r;
  return undefined;
}

/**
 * Read the reasoning chunk from a streaming delta. Same dual-field handling as
 * {@link readReasoningFromMessage}.
 */
function readReasoningFromDelta(delta: unknown): string | undefined {
  if (!delta || typeof delta !== "object") return undefined;
  const d = delta as Record<string, unknown>;
  const rc = d.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return rc;
  const r = d.reasoning;
  if (typeof r === "string" && r.length > 0) return r;
  return undefined;
}

function parseResponse(
  choice: OpenAI.Chat.ChatCompletion.Choice,
  reasoning: ResolvedReasoning,
): Message {
  const msg = choice.message;
  const toolCalls: ToolCall[] = [];

  let text = msg.content ?? "";
  const reasoningText = reasoning.enabled
    ? readReasoningFromMessage(msg)
    : undefined;
  if (reasoning.includeInText && reasoningText) {
    text = `<think>${reasoningText}</think>${text ? "\n" + text : ""}`;
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      toolCalls.push({
        tool_name: tc.function.name,
        input_args: safeJsonParse(tc.function.arguments),
        id: tc.id,
      });
    }
  }

  return {
    sender: "agent",
    text,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    ...(reasoningText && { reasoning_content: reasoningText }),
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class OpenAICompatAdapter implements ModelAdapter {
  name: string;
  readonly capabilities: ModalitySupport;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;
  private timeout: number;
  private reasoning: ResolvedReasoning;

  constructor(config: OpenAICompatAdapterConfig) {
    const provider = config.provider ?? "openai-compat";
    this.name = `${provider}:${config.model}`;
    this.capabilities = config.capabilities ?? OPENAI_MODALITIES;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    this.useStreaming = config.stream ?? false;
    this.timeout = config.timeout ?? 600000;
    this.reasoning = resolveReasoning(config.reasoning);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: this.timeout,
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
    const messages: OpenAIMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push(
      ...formatMessages(request.messages, this.reasoning.echo, this.capabilities),
    );

    const tools =
      request.tools?.length ? formatTools(request.tools) : undefined;

    const baseParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
      ...(tools && { tools }),
    };
    const params = this.applyReasoningParams(baseParams);

    if (this.useStreaming) {
      return this.promptStreaming(params, notify, signal);
    }

    return this.promptSync(params, notify, signal);
  }

  /**
   * Merge reasoning request-side knobs into the create params. Splitting this
   * out keeps `prompt()` readable and makes it easy to test the resulting
   * request shape for each provider.
   */
  private applyReasoningParams(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    const r = this.reasoning;
    if (!r.enabled) return params;
    const out: Record<string, unknown> = { ...params };
    if (r.effort) out.reasoning_effort = r.effort;
    if (r.reasoningObject) out.reasoning = r.reasoningObject;
    if (r.thinking) out.thinking = r.thinking;
    if (r.extraBody) {
      for (const [k, v] of Object.entries(r.extraBody)) out[k] = v;
    }
    return out as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  }

  private async promptSync(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    const response = await this.client.chat.completions.create({
      ...params,
      stream: false,
    }, signal ? { signal } : undefined);

    const choice = response.choices[0];
    if (!choice) {
      return { messages: [], tokens_in: 0, tokens_out: 0 };
    }

    const message = parseResponse(choice, this.reasoning);

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: choice.finish_reason ?? undefined,
    });

    return {
      messages: [message],
      tokens_in: response.usage?.prompt_tokens ?? 0,
      tokens_out: response.usage?.completion_tokens ?? 0,
    };
  }

  private async promptStreaming(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    notify: NotifySubscribersFunction,
    signal?: AbortSignal,
  ): Promise<ModelPromptResult> {
    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    }, signal ? { signal } : undefined);

    let fullText = "";
    let reasoningText = "";
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? 0;
        tokensOut = chunk.usage.completion_tokens ?? 0;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;

      if (this.reasoning.enabled) {
        const reasoningDelta = readReasoningFromDelta(delta);
        if (reasoningDelta) {
          reasoningText += reasoningDelta;
          if (this.reasoning.includeInText) {
            notify("text_delta", { text: reasoningDelta });
          }
        }
      }

      if (delta?.content) {
        fullText += delta.content;
        notify("text_delta", { text: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          if (!toolCallAccumulator.has(idx)) {
            toolCallAccumulator.set(idx, {
              id: tcDelta.id ?? `call_${crypto.randomUUID()}`,
              name: tcDelta.function?.name ?? "",
              arguments: "",
            });
          }
          const acc = toolCallAccumulator.get(idx)!;
          if (tcDelta.id) acc.id = tcDelta.id;
          if (tcDelta.function?.name) acc.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) {
            acc.arguments += tcDelta.function.arguments;
          }
        }
      }
    }

    const toolCalls: ToolCall[] = [];
    for (const [, acc] of toolCallAccumulator) {
      const parsedArgs = safeJsonParse(acc.arguments);
      toolCalls.push({
        tool_name: acc.name,
        input_args: parsedArgs,
        id: acc.id,
      });

      await notify("tool_use", {
        id: acc.id,
        name: acc.name,
        input: parsedArgs,
      });
    }

    const text = this.reasoning.includeInText && reasoningText
      ? `<think>${reasoningText}</think>${fullText ? "\n" + fullText : ""}`
      : fullText;

    const message: Message = {
      sender: "agent",
      text,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(reasoningText && { reasoning_content: reasoningText }),
    };

    await notify("model_response_complete", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: finishReason ?? undefined,
    });

    return {
      messages: [message],
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    };
  }
}
