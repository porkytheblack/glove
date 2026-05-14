import type { Message } from "glove-core/core";

/** Serialized tool definition from the client (JSON Schema, no Zod/run fns) */
export interface SerializedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** What the client sends to the chat handler */
export interface RemotePromptRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: SerializedTool[];
}

/** Configuration for createChatHandler */
export interface ChatHandlerConfig {
  /** Provider name from the registry (e.g. "openai", "anthropic", "openrouter", "mimo", "ollama", "lmstudio") */
  provider: string;
  /** Model name. Defaults to the provider's defaultModel. */
  model?: string;
  /** API key override. Defaults to the provider's envVar. */
  apiKey?: string;
  /** Maximum tokens in the response. Defaults to the provider's defaultMaxTokens. */
  maxTokens?: number;
  /** Override the provider's default base URL (e.g., custom port for local LLMs, MIMO_BASE_URL). */
  baseURL?: string;
  /**
   * MiMo only: when true, the reasoning trace is wrapped in `<think>…</think>`
   * and streamed alongside the visible text. Defaults to false — reasoning is
   * captured server-side and echoed back on subsequent turns but isn't sent to
   * the client. Ignored by other providers.
   */
  includeReasoningInText?: boolean;
  /**
   * MiMo only: hint how much the model should think. `mimo-v2.5-pro` is
   * adaptive by default (skips thinking on trivial prompts); pass `"high"`
   * for consistently deep reasoning. Ignored by other providers.
   */
  reasoningEffort?: "low" | "medium" | "high";
}
