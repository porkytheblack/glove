import OpenAI from "openai";
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
} from "../core";
import { getToolJsonSchema } from "../core";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface MimoAdapterConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
  /** Defaults to the Token Plan SGP gateway. Override for CN or self-hosted gateways. */
  baseURL?: string;
  /**
   * When true, the model's `reasoning_content` is wrapped in `<think>…</think>`
   * and prepended to the visible `text` of the returned message. Defaults to
   * false — reasoning stays on `Message.reasoning_content` so renderers can
   * choose to surface it (or not).
   */
  includeReasoningInText?: boolean;
  /** Request timeout in milliseconds. Defaults to 10 minutes. */
  timeout?: number;
}

export const MIMO_DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";

// ─── Format conversion: Glove → MiMo (OpenAI-compatible) ────────────────────

type MimoMessage = OpenAI.Chat.ChatCompletionMessageParam & {
  reasoning_content?: string;
};
type MimoTool = OpenAI.Chat.ChatCompletionTool;

function formatTools(tools: Array<Tool<unknown>>): Array<MimoTool> {
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
  const { data, status, message } = tr.result;
  if (status === "error") {
    const detail = data ? JSON.stringify(data) : "";
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

function formatContentParts(
  parts: ContentPart[],
): OpenAI.Chat.ChatCompletionContentPart[] {
  const result: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text) result.push({ type: "text", text: part.text });
        break;
      case "image":
      case "video":
        if (part.source) {
          const url =
            part.source.type === "url"
              ? part.source.url!
              : `data:${part.source.media_type};base64,${part.source.data}`;
          result.push({ type: "image_url", image_url: { url } });
        }
        break;
      case "document":
        result.push({
          type: "text",
          text: `[Document attachment: ${part.source?.media_type ?? "document"}]`,
        });
        break;
    }
  }
  return result;
}

function formatMessage(msg: Message): MimoMessage[] {
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
    // MiMo rejects the request if the assistant turn produced tool_calls but
    // we don't echo back the reasoning_content. Preserve it verbatim.
    const out: MimoMessage = {
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
    if (msg.reasoning_content) {
      out.reasoning_content = msg.reasoning_content;
    }
    return [out];
  }

  if (role === "assistant") {
    const out: MimoMessage = { role: "assistant" as const, content: msg.text };
    if (msg.reasoning_content) {
      out.reasoning_content = msg.reasoning_content;
    }
    return [out];
  }

  if (msg.content?.length && role === "user") {
    return [{ role: "user" as const, content: formatContentParts(msg.content) }];
  }

  return [{ role, content: msg.text }];
}

export function formatMessages(messages: Array<Message>): MimoMessage[] {
  const flat: MimoMessage[] = [];
  for (const msg of messages) {
    flat.push(...formatMessage(msg));
  }

  const merged: MimoMessage[] = [];
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
  const deduped: MimoMessage[] = [];
  for (const msg of merged) {
    if (msg.role === "tool") {
      const toolMsg = msg as OpenAI.Chat.ChatCompletionToolMessageParam;
      if (seenToolCallIds.has(toolMsg.tool_call_id)) continue;
      seenToolCallIds.add(toolMsg.tool_call_id);
    }
    deduped.push(msg);
  }

  const repaired: MimoMessage[] = [];
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

// ─── Parse MiMo response → Glove Message ────────────────────────────────────

function parseResponse(
  choice: OpenAI.Chat.ChatCompletion.Choice,
  includeReasoningInText: boolean,
): Message {
  const msg = choice.message as OpenAI.Chat.ChatCompletionMessage & {
    reasoning_content?: string | null;
  };
  const toolCalls: ToolCall[] = [];

  let text = msg.content ?? "";
  const reasoning = msg.reasoning_content ?? undefined;
  if (includeReasoningInText && reasoning) {
    text = `<think>${reasoning}</think>${text ? "\n" + text : ""}`;
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
    ...(reasoning && { reasoning_content: reasoning }),
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class MimoAdapter implements ModelAdapter {
  name: string;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;
  private includeReasoningInText: boolean;
  private timeout: number;

  constructor(config: MimoAdapterConfig) {
    this.name = `mimo:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 8192;
    this.useStreaming = config.stream ?? true;
    this.includeReasoningInText = config.includeReasoningInText ?? false;
    this.timeout = config.timeout ?? 600000;
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.MIMO_API_KEY ?? "",
      baseURL: config.baseURL ?? process.env.MIMO_BASE_URL ?? MIMO_DEFAULT_BASE_URL,
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
    const messages: MimoMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push(...formatMessages(request.messages));

    const tools =
      request.tools?.length ? formatTools(request.tools) : undefined;

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ...(tools && { tools }),
    };

    if (this.useStreaming) {
      return this.promptStreaming(params, notify, signal);
    }

    return this.promptSync(params, notify, signal);
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

    const message = parseResponse(choice, this.includeReasoningInText);

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

      const delta = choice.delta as
        | (OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
            reasoning_content?: string | null;
          })
        | undefined;

      if (delta?.reasoning_content) {
        reasoningText += delta.reasoning_content;
        if (this.includeReasoningInText) {
          notify("text_delta", { text: delta.reasoning_content });
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

    const text = this.includeReasoningInText && reasoningText
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
