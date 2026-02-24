import type { ModelAdapter } from "../core";
import { AnthropicAdapter } from "./anthropic";
import { BedrockAdapter } from "./bedrock";
import { OpenAICompatAdapter } from "./openai-compat";

// ─── Provider definitions ─────────────────────────────────────────────────────

export interface ProviderDef {
  id: string;
  name: string;
  baseURL: string;
  envVar: string;
  defaultModel: string;
  models: string[];
  /** "anthropic" uses the Anthropic SDK; "openai" uses the OpenAI-compat adapter; "bedrock" uses the AWS Bedrock adapter */
  format: "anthropic" | "openai" | "bedrock";
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
  bedrock: {
    id: "bedrock",
    name: "Amazon Bedrock",
    baseURL: "", // Bedrock uses AWS SDK, not a REST endpoint
    envVar: "AWS_ACCESS_KEY_ID", // Bedrock uses standard AWS credentials
    defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    models: [
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "anthropic.claude-3-5-haiku-20241022-v1:0",
      "anthropic.claude-3-opus-20240229-v1:0",
      "anthropic.claude-3-sonnet-20240229-v1:0",
      "anthropic.claude-3-haiku-20240307-v1:0",
      "amazon.nova-pro-v1:0",
      "amazon.nova-lite-v1:0",
      "amazon.nova-micro-v1:0",
      "meta.llama3-2-90b-instruct-v1:0",
      "meta.llama3-2-11b-instruct-v1:0",
      "meta.llama3-2-3b-instruct-v1:0",
      "meta.llama3-2-1b-instruct-v1:0",
      "mistral.mistral-large-2407-v1:0",
      "cohere.command-r-plus-v1:0",
    ],
    format: "bedrock",
    defaultMaxTokens: 8192,
  },
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateAdapterOptions {
  provider: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  stream?: boolean;
  /** AWS region for Bedrock (defaults to AWS_REGION env var or "us-east-1") */
  region?: string;
  /** AWS access key ID for Bedrock (defaults to AWS_ACCESS_KEY_ID env var) */
  accessKeyId?: string;
  /** AWS secret access key for Bedrock (defaults to AWS_SECRET_ACCESS_KEY env var) */
  secretAccessKey?: string;
  /** AWS session token for Bedrock temporary credentials (defaults to AWS_SESSION_TOKEN env var) */
  sessionToken?: string;
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

  if (providerDef.format === "bedrock") {
    return new BedrockAdapter({
      model,
      maxTokens,
      stream,
      region: opts.region,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      sessionToken: opts.sessionToken,
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
