import { providers, type ProviderDef } from "@glove/core/models/providers";
import { formatMessages } from "@glove/core/models/openai-compat";
import type { Message } from "@glove/core/core";
import type { ChatHandlerConfig, RemotePromptRequest, SerializedTool } from "./types";
import { createSSEStream, SSE_HEADERS } from "./sse";

// ─── Tool conversion ─────────────────────────────────────────────────────────

function toOpenAITools(tools?: SerializedTool[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function toAnthropicTools(tools?: SerializedTool[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a Next.js App Router POST handler that streams LLM responses as SSE.
 *
 * ```ts
 * // app/api/chat/route.ts
 * import { createChatHandler } from "@glove/next";
 *
 * export const POST = createChatHandler({
 *   provider: "openai",
 *   model: "gpt-4o-mini",
 * });
 * ```
 *
 * Supports all providers from `@glove/core/models/providers`:
 * openai, anthropic, openrouter, gemini, minimax, kimi, glm.
 *
 * The handler receives `RemotePromptRequest` and streams `RemoteStreamEvent`s
 * compatible with `@glove/react`'s `useGlove({ endpoint })` mode.
 */
export function createChatHandler(
  config: ChatHandlerConfig,
): (req: Request) => Promise<Response> {
  const providerDef = providers[config.provider];
  if (!providerDef) {
    throw new Error(
      `Unknown provider "${config.provider}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }

  const model = config.model ?? providerDef.defaultModel;
  const maxTokens = config.maxTokens ?? providerDef.defaultMaxTokens;

  if (providerDef.format === "anthropic") {
    return createAnthropicHandler(providerDef, model, maxTokens, config);
  }

  return createOpenAIHandler(providerDef, model, maxTokens, config);
}

// ─── OpenAI-compat handler (openai, openrouter, gemini, minimax, kimi, glm) ──

function createOpenAIHandler(
  providerDef: ProviderDef,
  model: string,
  maxTokens: number,
  config: ChatHandlerConfig,
) {
  let clientPromise: Promise<any> | null = null;

  function getClient() {
    if (!clientPromise) {
      clientPromise = import("openai").then((mod) => {
        const OpenAI = mod.default;
        const apiKey = config.apiKey ?? process.env[providerDef.envVar];
        if (!apiKey) {
          throw new Error(
            `No API key for ${providerDef.name}. Set ${providerDef.envVar} env var or pass apiKey.`,
          );
        }
        return new OpenAI({ apiKey, baseURL: providerDef.baseURL });
      });
    }
    return clientPromise;
  }

  return async function POST(req: Request): Promise<Response> {
    const body: RemotePromptRequest = await req.json();
    const client = await getClient();

    const messages = [
      { role: "system" as const, content: body.systemPrompt },
      ...formatMessages(body.messages as Message[]),
    ];
    const tools = toOpenAITools(body.tools);

    const stream = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
      ...(tools ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });

    const readable = createSSEStream(async (send) => {
      let fullText = "";
      const toolCallAcc = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let tokensIn = 0;
      let tokensOut = 0;

      for await (const chunk of stream) {
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens ?? 0;
          tokensOut = chunk.usage.completion_tokens ?? 0;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          fullText += choice.delta.content;
          send({ type: "text_delta", text: choice.delta.content });
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (!toolCallAcc.has(tc.index)) {
              toolCallAcc.set(tc.index, {
                id: tc.id ?? `call_${crypto.randomUUID()}`,
                name: tc.function?.name ?? "",
                arguments: "",
              });
            }
            const acc = toolCallAcc.get(tc.index)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments)
              acc.arguments += tc.function.arguments;
          }
        }
      }

      // Emit accumulated tool calls
      const toolCalls = [...toolCallAcc.values()].map((acc) => {
        let input: unknown;
        try {
          input = JSON.parse(acc.arguments);
        } catch {
          input = acc.arguments;
        }
        send({ type: "tool_use", id: acc.id, name: acc.name, input });
        return { tool_name: acc.name, input_args: input, id: acc.id };
      });

      send({
        type: "done",
        message: {
          sender: "agent",
          text: fullText,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      });
    });

    return new Response(readable, { headers: SSE_HEADERS });
  };
}

// ─── Anthropic handler ───────────────────────────────────────────────────────

function createAnthropicHandler(
  providerDef: ProviderDef,
  model: string,
  maxTokens: number,
  config: ChatHandlerConfig,
) {
  let clientPromise: Promise<any> | null = null;

  function getClient() {
    if (!clientPromise) {
      clientPromise = import("@anthropic-ai/sdk").then((mod) => {
        const Anthropic = mod.default;
        const apiKey = config.apiKey ?? process.env[providerDef.envVar];
        if (!apiKey) {
          throw new Error(
            `No API key for ${providerDef.name}. Set ${providerDef.envVar} env var or pass apiKey.`,
          );
        }
        return new Anthropic({ apiKey });
      });
    }
    return clientPromise;
  }

  return async function POST(req: Request): Promise<Response> {
    const body: RemotePromptRequest = await req.json();
    const client = await getClient();

    // Dynamically import the Anthropic message formatter
    const { formatAnthropicMessages } = await import(
      "@glove/core/models/anthropic"
    );
    const messages = formatAnthropicMessages(body.messages as Message[]);
    const tools = toAnthropicTools(body.tools);

    const readable = createSSEStream(async (send) => {
      let fullText = "";
      const toolCalls: Array<{
        tool_name: string;
        input_args: unknown;
        id: string;
      }> = [];

      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        messages,
        system: body.systemPrompt,
        ...(tools ? { tools } : {}),
      });

      stream.on("text", (text: string) => {
        fullText += text;
        send({ type: "text_delta", text });
      });

      stream.on("contentBlock", (block: any) => {
        if (block.type === "tool_use") {
          send({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
          toolCalls.push({
            tool_name: block.name,
            input_args: block.input,
            id: block.id,
          });
        }
      });

      const finalMessage = await stream.finalMessage();

      // Fallback: extract text from content blocks if not accumulated
      if (!fullText) {
        fullText = finalMessage.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }

      send({
        type: "done",
        message: {
          sender: "agent",
          text: fullText,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        tokens_in: finalMessage.usage.input_tokens,
        tokens_out: finalMessage.usage.output_tokens,
      });
    });

    return new Response(readable, { headers: SSE_HEADERS });
  };
}
