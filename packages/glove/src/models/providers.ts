import type { ModelAdapter } from "../core";
import { AnthropicAdapter } from "./anthropic";
import { OpenAICompatAdapter } from "./openai-compat";

// ─── Provider definitions ─────────────────────────────────────────────────────

export interface ProviderDef {
  id: string;
  name: string;
  baseURL: string;
  envVar: string;
  defaultModel: string;
  models: string[];
  /** "anthropic" uses the Anthropic SDK; "openai" uses the OpenAI-compat adapter */
  format: "anthropic" | "openai";
  defaultMaxTokens: number;
}

export const providers: Record<string, ProviderDef> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4",
    models: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "minimax/minimax-m2.5",
      "moonshotai/kimi-k2.5",
      "z-ai/glm-5",
    ],
    format: "openai",
    defaultMaxTokens: 8192,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    baseURL: "https://api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-3-5-20241022",
    ],
    format: "anthropic",
    defaultMaxTokens: 8192,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1",
    models: [
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "o4-mini",
    ],
    format: "openai",
    defaultMaxTokens: 4096,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    envVar: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ],
    format: "openai",
    defaultMaxTokens: 8192,
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-M2.5",
    models: [
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M2.1",
    ],
    format: "openai",
    defaultMaxTokens: 8192,
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    baseURL: "https://api.moonshot.ai/v1",
    envVar: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2.5",
    models: [
      "kimi-k2.5",
      "kimi-k2-0905-preview",
      "moonshot-v1-auto",
    ],
    format: "openai",
    defaultMaxTokens: 8192,
  },
  glm: {
    id: "glm",
    name: "GLM (Zhipu AI)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
    envVar: "ZHIPUAI_API_KEY",
    defaultModel: "glm-4-plus",
    models: [
      "glm-4-plus",
      "glm-4-long",
      "glm-4-flash",
    ],
    format: "openai",
    defaultMaxTokens: 4096,
  },
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateAdapterOptions {
  provider: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  stream?: boolean;
}

export function createAdapter(opts: CreateAdapterOptions): ModelAdapter {
  const providerDef = providers[opts.provider];
  if (!providerDef) {
    throw new Error(
      `Unknown provider "${opts.provider}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }

  const model = opts.model ?? providerDef.defaultModel;
  const apiKey = opts.apiKey ?? process.env[providerDef.envVar];
  const maxTokens = opts.maxTokens ?? providerDef.defaultMaxTokens;
  const stream = opts.stream ?? true;

  if (!apiKey) {
    throw new Error(
      `No API key for provider "${providerDef.name}". Set ${providerDef.envVar} env var or pass apiKey.`,
    );
  }

  if (providerDef.format === "anthropic") {
    return new AnthropicAdapter({
      apiKey,
      model,
      maxTokens,
      stream,
    });
  }

  return new OpenAICompatAdapter({
    apiKey,
    model,
    maxTokens,
    stream,
    baseURL: providerDef.baseURL,
    provider: providerDef.id,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** List providers with available API keys (based on env vars) */
export function getAvailableProviders(): Array<{
  id: string;
  name: string;
  available: boolean;
  models: string[];
  defaultModel: string;
}> {
  return Object.values(providers).map((p) => ({
    id: p.id,
    name: p.name,
    available: !!process.env[p.envVar],
    models: p.models,
    defaultModel: p.defaultModel,
  }));
}
