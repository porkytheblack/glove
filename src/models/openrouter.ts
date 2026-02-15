import OpenAI from "openai";
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

export interface OpenRouterAdapterConfig {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  stream?: boolean;
  baseURL?: string;
}

// ─── Format conversion: Glove → OpenAI ──────────────────────────────────────

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.ChatCompletionTool;

function formatTools(tools: Array<Tool<unknown>>): Array<OpenAITool> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.input_schema) as Record<string, unknown>,
    },
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

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// A single Glove Message may expand to multiple OpenAI messages because
// tool results are separate { role: "tool" } messages in the OpenAI format
// (unlike Anthropic where they are content blocks inside a user message).
function formatMessage(msg: Message): OpenAIMessage[] {
  const role: "user" | "assistant" =
    msg.sender === "agent" ? "assistant" : "user";

  // tool results → individual { role: "tool" } messages
  if (role === "user" && msg.tool_results?.length) {
    return msg.tool_results.map((tr) => ({
      role: "tool" as const,
      tool_call_id: tr.call_id ?? "_unknown",
      content: formatToolResultContent(tr),
    }));
  }

  // assistant message that made tool calls
  if (role === "assistant" && msg.tool_calls?.length) {
    return [
      {
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
      },
    ];
  }

  // plain text
  return [{ role, content: msg.text }];
}

function formatMessages(messages: Array<Message>): OpenAIMessage[] {
  // Stage 1: flatten — each Glove message may produce multiple OpenAI messages
  const flat: OpenAIMessage[] = [];
  for (const msg of messages) {
    flat.push(...formatMessage(msg));
  }

  // Stage 2: merge consecutive user messages (never merge tool or assistant)
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

  // Stage 3: deduplicate tool result messages by tool_call_id
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

  // Stage 4: repair orphaned tool_calls — every assistant message with
  // tool_calls must be followed by matching { role: "tool" } messages
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

    // look ahead through immediately-following tool messages
    const foundIds = new Set<string>();
    let j = i + 1;
    while (j < deduped.length && deduped[j].role === "tool") {
      const toolMsg =
        deduped[j] as OpenAI.Chat.ChatCompletionToolMessageParam;
      foundIds.add(toolMsg.tool_call_id);
      j++;
    }

    // insert synthetic results for any missing IDs
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

function parseResponse(
  choice: OpenAI.Chat.ChatCompletion.Choice,
): Message {
  const msg = choice.message;
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  if (msg.content) {
    textParts.push(msg.content);
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
    text: textParts.join(""),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class OpenRouterAdapter implements ModelAdapter {
  name: string;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private systemPrompt?: string;
  private useStreaming: boolean;

  constructor(config: OpenRouterAdapterConfig) {
    this.name = `openrouter:${config.model}`;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    this.useStreaming = config.stream ?? false;
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: config.baseURL ?? "https://openrouter.ai/api/v1",
    });
  }

  setSystemPrompt(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  async prompt(
    request: PromptRequest,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    // System prompt is a message in the OpenAI format
    const messages: OpenAIMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push(...formatMessages(request.messages));

    const tools =
      request.tools?.length ? formatTools(request.tools) : undefined;

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
      ...(tools && { tools }),
    };

    if (this.useStreaming) {
      return this.promptStreaming(params, notify);
    }

    return this.promptSync(params, notify);
  }

  private async promptSync(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    notify: NotifySubscribersFunction,
  ): Promise<ModelPromptResult> {
    const response = await this.client.chat.completions.create({
      ...params,
      stream: false,
    });

    const choice = response.choices[0];
    if (!choice) {
      return { messages: [], tokens_in: 0, tokens_out: 0 };
    }

    const message = parseResponse(choice);

    await notify("model_response", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: choice.finish_reason,
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
  ): Promise<ModelPromptResult> {
    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullText = "";
    // OpenAI streams tool call arguments as string fragments across chunks.
    // We accumulate them keyed by the tool_call index within the response.
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      // Usage arrives in the final chunk when stream_options.include_usage is set
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

      // text content delta
      if (delta?.content) {
        fullText += delta.content;
        notify("text_delta", { text: delta.content });
      }

      // tool call deltas — arrive incrementally
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

    // assemble completed tool calls from accumulated deltas
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

    const message: Message = {
      sender: "agent",
      text: fullText,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    };

    await notify("model_response_complete", {
      text: message.text,
      tool_calls: message.tool_calls,
      stop_reason: finishReason,
    });

    return {
      messages: [message],
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    };
  }
}
