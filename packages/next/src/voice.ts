// ─── Types ──────────────────────────────────────────────────────────────────

export type VoiceTokenProvider = "elevenlabs" | "deepgram" | "cartesia";

export type VoiceTokenHandlerConfig =
  | { provider: "elevenlabs"; type: "stt" | "tts"; apiKey?: string }
  | { provider: "deepgram"; apiKey?: string; ttlSeconds?: number }
  | { provider: "cartesia"; apiKey?: string };

// ─── Provider definitions ───────────────────────────────────────────────────

interface ProviderTokenDef {
  envVar: string;
  createToken: (apiKey: string, config: VoiceTokenHandlerConfig) => Promise<string>;
}

const voiceProviders: Record<VoiceTokenProvider, ProviderTokenDef> = {
  elevenlabs: {
    envVar: "ELEVENLABS_API_KEY",
    createToken: async (apiKey, config) => {
      const tokenType =
        (config as { type?: "stt" | "tts" }).type === "stt"
          ? "realtime_scribe"
          : "tts_websocket";

      const res = await fetch(
        `https://api.elevenlabs.io/v1/single-use-token/${tokenType}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey },
        },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ElevenLabs token error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as { token: string };
      return data.token;
    },
  },

  deepgram: {
    envVar: "DEEPGRAM_API_KEY",
    createToken: async (apiKey, config) => {
      const ttl = (config as { ttlSeconds?: number }).ttlSeconds ?? 30;

      const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ time_to_live_in_seconds: ttl }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Deepgram token error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as { key: string };
      return data.key;
    },
  },

  cartesia: {
    envVar: "CARTESIA_API_KEY",
    createToken: async (apiKey) => {
      const res = await fetch("https://api.cartesia.ai/audio/tokens", {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Cartesia token error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as { jwt: string };
      return data.jwt;
    },
  },
};

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates a Next.js App Router GET handler that returns a short-lived
 * voice API token for the specified provider.
 *
 * ```ts
 * // app/api/voice/stt-token/route.ts
 * import { createVoiceTokenHandler } from "glove-next";
 * export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
 *
 * // app/api/voice/tts-token/route.ts
 * import { createVoiceTokenHandler } from "glove-next";
 * export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
 * ```
 *
 * Supported providers: elevenlabs, deepgram, cartesia.
 *
 * API key resolution: `config.apiKey` → `process.env[PROVIDER_API_KEY]`.
 * Returns `{ token: string }` on success, `{ error: string }` with status 500 on failure.
 */
export function createVoiceTokenHandler(
  config: VoiceTokenHandlerConfig,
): (req: Request) => Promise<Response> {
  const providerDef = voiceProviders[config.provider];
  if (!providerDef) {
    throw new Error(
      `Unknown voice token provider "${config.provider}". Available: ${Object.keys(voiceProviders).join(", ")}`,
    );
  }

  return async function GET(): Promise<Response> {
    const apiKey = config.apiKey ?? process.env[providerDef.envVar];
    if (!apiKey) {
      return Response.json(
        { error: `No API key for ${config.provider}. Set ${providerDef.envVar} env var or pass apiKey.` },
        { status: 500 },
      );
    }

    try {
      const token = await providerDef.createToken(apiKey, config);
      return Response.json({ token });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token generation failed";
      return Response.json({ error: message }, { status: 500 });
    }
  };
}
