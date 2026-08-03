/**
 * A minimal OpenRouter chat-completions client.
 *
 * Deliberately not routed through a glove-core ModelAdapter: the subject of
 * this benchmark is the working environment, and a thin client keeps the
 * agent loop's behaviour attributable to the environment rather than to an
 * adapter's message shaping.
 */

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cost?: number;
}

export interface Completion {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterError extends Error {}

export async function complete(opts: {
  model: string;
  messages: Message[];
  tools: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<Completion> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError("OPENROUTER_API_KEY is not set");

  const body = {
    model: opts.model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: "auto",
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0,
    usage: { include: true },
  };

  let lastError: unknown;
  // Rate limits and upstream hiccups are routine on a shared gateway; a few
  // backed-off retries keep one blip from voiding a whole run.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/porkytheblack/glove",
          "X-Title": "glove-working-environment-bench",
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        lastError = new OpenRouterError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new OpenRouterError(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string };
      };
      if (json.error) throw new OpenRouterError(json.error.message ?? "unknown upstream error");
      const choice = json.choices?.[0];
      if (!choice) throw new OpenRouterError("no choices returned");

      return {
        content: choice.message?.content ?? null,
        toolCalls: choice.message?.tool_calls ?? [],
        finishReason: choice.finish_reason ?? "stop",
        usage: {
          prompt_tokens: json.usage?.prompt_tokens ?? 0,
          completion_tokens: json.usage?.completion_tokens ?? 0,
          cost: json.usage?.cost,
        },
      };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new OpenRouterError(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
