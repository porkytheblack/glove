// ─────────────────────────────────────────────────────────────────────────────
// createRealtimeAdapter — the same shape as glove-core's createAdapter:
// explicit arguments first, environment second, credentials resolved at
// construction so a missing key fails with its name instead of a 401.
//
//   REALTIME_PROVIDER   openai | openai-live | gemini. Unset: whichever of
//                       OPENAI_API_KEY / GEMINI_API_KEY exists (OpenAI first).
//   REALTIME_MODEL      provider model id; unset = provider default.
//   REALTIME_VOICE      provider voice name.
//   OPENAI_API_KEY / GEMINI_API_KEY   the credential when no apiKey/getToken.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModelAdapter } from "glove-core";
import { GeminiLiveAdapter, type GeminiLiveConfig } from "./adapters/gemini-live";
import { OpenAILiveAdapter, type OpenAILiveConfig } from "./adapters/openai-live";
import { OpenAIRealtimeAdapter, type OpenAIRealtimeConfig } from "./adapters/openai-realtime";
import type { RealtimeAdapter } from "./types";

export type RealtimeProvider = "openai" | "openai-live" | "gemini";

type Auth = {
  /** Explicit credential. Wins over the env key; loses to getToken. */
  apiKey?: string;
  getToken?: () => Promise<string> | string;
};

/** Discriminated on `provider`; each branch takes that adapter's options. */
export type CreateRealtimeAdapterArgs =
  | (Auth & { provider?: "openai" } & Partial<Omit<OpenAIRealtimeConfig, "getToken">>)
  | (Auth & { provider: "openai-live" } & Partial<Omit<OpenAILiveConfig, "getToken">>)
  | (Auth & { provider: "gemini" } & Partial<Omit<GeminiLiveConfig, "getToken">>);

const ENV_KEY: Record<RealtimeProvider, string> = {
  openai: "OPENAI_API_KEY",
  "openai-live": "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] || undefined : undefined;
}

export function createRealtimeAdapter(args: CreateRealtimeAdapterArgs = {}): RealtimeAdapter {
  const provider: RealtimeProvider | undefined =
    args.provider ??
    (env("REALTIME_PROVIDER") as RealtimeProvider | undefined) ??
    (env("OPENAI_API_KEY") ? "openai" : env("GEMINI_API_KEY") ? "gemini" : undefined);
  if (!provider) {
    throw new Error(
      "createRealtimeAdapter: no provider. Pass { provider }, set REALTIME_PROVIDER, or set OPENAI_API_KEY / GEMINI_API_KEY.",
    );
  }
  if (!ENV_KEY[provider]) {
    throw new Error(`createRealtimeAdapter: unknown provider "${provider}". Use "openai", "openai-live" or "gemini".`);
  }

  let getToken = args.getToken;
  if (!getToken) {
    const key = args.apiKey ?? env(ENV_KEY[provider]);
    if (!key) throw new Error(`createRealtimeAdapter: ${ENV_KEY[provider]} is not set and no apiKey/getToken was provided.`);
    getToken = () => key;
  }

  const { provider: _p, apiKey: _k, getToken: _t, ...rest } = args as Auth & { provider?: RealtimeProvider } & Record<string, unknown>;
  const model = (rest.model as string | undefined) ?? env("REALTIME_MODEL");
  const voice = (rest.voice as string | undefined) ?? env("REALTIME_VOICE");
  const common = { ...rest, ...(model ? { model } : {}), ...(voice ? { voice } : {}), getToken };

  switch (provider) {
    case "openai":
      return new OpenAIRealtimeAdapter(common as OpenAIRealtimeConfig);
    case "openai-live":
      return new OpenAILiveAdapter(common as OpenAILiveConfig);
    case "gemini":
      return new GeminiLiveAdapter(common as GeminiLiveConfig);
  }
}

/** A model slot that carries realtime configuration. */
export interface RealtimeModel extends ModelAdapter {
  readonly realtime: CreateRealtimeAdapterArgs;
}

/**
 * The model slot for an agent whose turns run on a realtime provider.
 *
 * A Glove needs a ModelAdapter to build; a realtime agent never runs Glove's
 * text loop, so this one carries the provider configuration instead and
 * `RealtimeSession` builds the adapter from it. It throws, naming the agent,
 * if anything calls `processRequest` — swap in `createAdapter(...)` to serve
 * text turns from the same definition.
 *
 * ```ts
 * const agent = new Glove({
 *   model: realtimeModel({ provider: "gemini", voice: "Puck" }),
 *   systemPrompt, displayManager, compaction_config,
 * }).fold(lookupOrder).build();
 * const session = new RealtimeSession({ agent });
 * ```
 */
export function realtimeModel(config: CreateRealtimeAdapterArgs & { label?: string } = {}): RealtimeModel {
  const { label = "realtime", ...realtime } = config;
  return {
    name: label,
    realtime: realtime as CreateRealtimeAdapterArgs,
    async prompt(): Promise<never> {
      throw new Error(
        `"${label}" is a realtime model slot: run this agent through RealtimeSession. ` +
          `To serve text turns from the same agent, give it a text model (createAdapter(...) from glove-core).`,
      );
    },
    setSystemPrompt() {
      /* the realtime session carries the prompt */
    },
  };
}

export function isRealtimeModel(model: ModelAdapter | undefined): model is RealtimeModel {
  const realtime = (model as Partial<RealtimeModel> | undefined)?.realtime;
  return typeof realtime === "object" && realtime !== null;
}
