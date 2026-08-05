// ─────────────────────────────────────────────────────────────────────────────
// createS2SAdapter — the same shape as glove-core's createAdapter.
//
//   createAdapter({ provider: "anthropic" })            // text models
//   createS2SAdapter({ provider: "openai" })            // speech-to-speech
//
// Provider, model and credentials resolve the same way the text factory's do:
// explicit argument first, then environment. A server passes nothing and the
// env carries it; a browser passes `getToken` (ephemeral secrets — never a raw
// key) and everything else stays declarative.
//
// Environment:
//   S2S_PROVIDER         openai | openai-webrtc | gemini. Unset: whichever of
//                        OPENAI_API_KEY / GEMINI_API_KEY exists (OpenAI first).
//   S2S_MODEL            provider-specific model id; unset = provider default
//                        ("gpt-realtime" / "models/gemini-live-2.5-flash-preview")
//   OPENAI_API_KEY /     the credential, when `getToken` isn't supplied.
//   GEMINI_API_KEY       Server-side only — env keys never belong in a browser.
//   S2S_TURN_DETECTION   OpenAI only: semantic_vad (default) | server_vad.
// ─────────────────────────────────────────────────────────────────────────────

import { GeminiLiveAdapter, type GeminiLiveConfig } from "./gemini-live";
import { OpenAIRealtimeAdapter, type OpenAIRealtimeConfig } from "./openai-realtime";
import {
  OpenAIRealtimeSocketAdapter,
  type OpenAIRealtimeSocketConfig,
  type OpenAITurnDetection,
} from "./openai-realtime-socket";
import type { S2SAdapter } from "./types";

export type S2SProvider = "openai" | "openai-webrtc" | "gemini";

interface CommonArgs {
  /** Which realtime provider. Default: S2S_PROVIDER, else key-presence. */
  provider?: S2SProvider;
  /** Explicit credential. Wins over the env key; loses to `getToken`. */
  apiKey?: string;
  /** Output voice (provider-specific name). Default: S2S_VOICE. Providers
   *  lock the voice once the model first speaks — this picks the voice for
   *  the SESSION; there is no mid-call switch. A voice named in the session
   *  config (e.g. RealtimeAgent's `voice`) wins over this. */
  voice?: string;
}

/** Discriminated on `provider`, carrying that adapter's own options minus
 *  auth (which the factory resolves). */
export type CreateS2SAdapterArgs =
  | (CommonArgs & { provider?: "openai" } & Partial<Omit<OpenAIRealtimeSocketConfig, "getToken">>)
  | (CommonArgs & { provider: "openai-webrtc" } & Partial<Omit<OpenAIRealtimeConfig, "getToken">> & {
      getToken?: () => Promise<string>;
    })
  | (CommonArgs & { provider: "gemini" } & Partial<Omit<GeminiLiveConfig, "getToken">> & {
      getToken?: () => Promise<string> | string;
    });

type ArgsWithToken = CreateS2SAdapterArgs & {
  getToken?: () => Promise<string> | string;
  model?: string;
};

const ENV_KEY: Record<S2SProvider, string> = {
  openai: "OPENAI_API_KEY",
  "openai-webrtc": "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export function createS2SAdapter(args: CreateS2SAdapterArgs = {}): S2SAdapter {
  const a = args as ArgsWithToken;

  const provider: S2SProvider | undefined =
    a.provider ??
    (env("S2S_PROVIDER") as S2SProvider | undefined) ??
    (env("OPENAI_API_KEY") ? "openai" : env("GEMINI_API_KEY") ? "gemini" : undefined);
  if (!provider) {
    throw new Error(
      "createS2SAdapter: no provider. Pass { provider }, set S2S_PROVIDER, " +
        "or set OPENAI_API_KEY / GEMINI_API_KEY.",
    );
  }
  if (!ENV_KEY[provider]) {
    throw new Error(
      `createS2SAdapter: unknown provider "${provider}". ` +
        `Use "openai" (WebSocket transport), "openai-webrtc" (browser device), or "gemini".`,
    );
  }

  // Resolve the credential EAGERLY, like createAdapter — a missing key should
  // fail at construction with a clear name, not at connect() with a 401.
  let getToken = a.getToken;
  if (!getToken) {
    const key = a.apiKey ?? env(ENV_KEY[provider]);
    if (!key) {
      throw new Error(
        `createS2SAdapter: ${ENV_KEY[provider]} is not set and no getToken/apiKey was provided.`,
      );
    }
    getToken = () => key;
  }

  const model = a.model ?? (env("S2S_MODEL") || undefined);
  const voice = a.voice ?? (env("S2S_VOICE") || undefined);

  switch (provider) {
    case "openai": {
      const { provider: _p, apiKey: _k, getToken: _t, model: _m, voice: _v, ...rest } =
        a as CommonArgs & OpenAIRealtimeSocketConfig;
      // Env can only pick the MODE — richer tuning (eagerness, thresholds)
      // is typed config. An unrecognised env value is ignored rather than
      // sent as an invalid frame.
      const envTd = env("S2S_TURN_DETECTION");
      const turnDetection: OpenAITurnDetection | undefined =
        rest.turnDetection !== undefined
          ? rest.turnDetection
          : envTd === "server_vad"
            ? { type: "server_vad" }
            : envTd === "semantic_vad"
              ? { type: "semantic_vad" }
              : undefined;
      return new OpenAIRealtimeSocketAdapter({
        ...rest,
        ...(turnDetection !== undefined ? { turnDetection } : {}),
        ...(model ? { model } : {}),
        ...(voice ? { voice } : {}),
        getToken,
      });
    }
    case "openai-webrtc": {
      const { provider: _p, apiKey: _k, getToken: _t, model: _m, voice: _v, ...rest } =
        a as CommonArgs & OpenAIRealtimeConfig;
      return new OpenAIRealtimeAdapter({
        ...rest,
        ...(model ? { model } : {}),
        ...(voice ? { voice } : {}),
        getToken: () => Promise.resolve(getToken()),
      });
    }
    case "gemini": {
      const { provider: _p, apiKey: _k, getToken: _t, model: _m, voice: _v, ...rest } =
        a as CommonArgs & GeminiLiveConfig;
      return new GeminiLiveAdapter({
        ...rest,
        ...(model ? { model } : {}),
        ...(voice ? { voice } : {}),
        getToken,
      });
    }
  }
}
