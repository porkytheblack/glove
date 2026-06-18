import type { Message, PromptCacheConfig } from "glove-core/core";
import type {
  OpenAICompatReasoningOptions,
  ReasoningEffort,
} from "glove-core/models/openai-compat";

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
   * When true, the reasoning trace is wrapped in `<think>…</think>` and
   * streamed alongside the visible text. Defaults to false — reasoning is
   * captured server-side and echoed back on subsequent turns but isn't sent
   * to the client. Honoured by the OpenAI-compat and MiMo handlers; the
   * Anthropic handler ignores it.
   */
  includeReasoningInText?: boolean;
  /**
   * Hint how much the model should think before answering. Sent as the
   * top-level `reasoning_effort` request field on the OpenAI-compat handler
   * (works with GPT-5/o-series, GLM-4.5/4.6, MiniMax M2.5, Kimi K2,
   * DeepSeek V4) and mapped onto MiMo's existing knob for the MiMo handler.
   *
   * `"minimal"` is GPT-5-specific. On adaptive models like `mimo-v2.5-pro`,
   * `"low"` / `"medium"` can suppress thinking — pass `"high"` for
   * consistently deep reasoning. Leave unset to let the model decide.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Reasoning / thinking support for OpenAI-compatible providers. Pass `true`
   * for sensible defaults (capture provider-emitted `reasoning_content` /
   * `reasoning` into `Message.reasoning_content`, echo it back on tool
   * turns), or an object for fine-grained control over request shape and
   * echo policy.
   *
   * Honoured by the OpenAI-compat handler. Ignored by the Anthropic and
   * MiMo handlers — the MiMo handler reads `reasoningEffort` /
   * `includeReasoningInText` directly.
   */
  reasoning?: boolean | OpenAICompatReasoningOptions;
  /**
   * Prompt caching. Pass `true` to enable with defaults or an object
   * (`{ ttl: "1h" }`) to tune the cache lifetime.
   *
   * - **anthropic** handler: places `cache_control` breakpoints on the tool +
   *   system prefix and the latest turn (TTL honoured).
   * - **openrouter** (OpenAI-compat handler): forwards `cache_control`
   *   breakpoints to the upstream model.
   * - other OpenAI-compatible providers cache automatically — enabling has no
   *   request-side effect.
   */
  cache?: PromptCacheConfig;
}
