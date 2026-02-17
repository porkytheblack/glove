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
  /** Provider name from the registry (e.g. "openai", "anthropic", "openrouter", "gemini") */
  provider: string;
  /** Model name. Defaults to the provider's defaultModel. */
  model?: string;
  /** API key override. Defaults to the provider's envVar. */
  apiKey?: string;
  /** Maximum tokens in the response. Defaults to the provider's defaultMaxTokens. */
  maxTokens?: number;
}
