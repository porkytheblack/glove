// Server-side helpers — API keys never reach the browser (the same token
// pattern as glove-voice/server).

export interface RealtimeTokenConfig {
  /** Your OpenAI API key (server-side only). */
  apiKey: string;
  /** Realtime model (default "gpt-realtime"). */
  model?: string;
  /** System prompt baked into the session at mint time. */
  instructions?: string;
  /** Output voice (e.g. "marin", "cedar"). */
  voice?: string;
  /** Function tools the model may call. */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  /**
   * Turn detection. Default: semantic VAD — the model decides from LISTENING
   * whether the speaker is done, replacing client-side endpointing entirely.
   */
  turnDetection?: Record<string, unknown>;
  /** Model for user-audio transcription events (default gpt-4o-mini-transcribe). */
  transcriptionModel?: string;
  /** API base (default https://api.openai.com/v1). */
  baseUrl?: string;
}

/**
 * Mint an ephemeral client secret for a browser Realtime session
 * (POST /v1/realtime/client_secrets). Session config is baked in at mint
 * time, so the client can't escalate its own permissions or prompt.
 */
export async function createOpenAIRealtimeToken(
  cfg: RealtimeTokenConfig,
): Promise<{ token: string; expiresAt: number | null }> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const session: Record<string, unknown> = {
    type: "realtime",
    model: cfg.model ?? "gpt-realtime",
    audio: {
      input: {
        transcription: { model: cfg.transcriptionModel ?? "gpt-4o-mini-transcribe" },
        turn_detection: cfg.turnDetection ?? { type: "semantic_vad" },
      },
      ...(cfg.voice ? { output: { voice: cfg.voice } } : {}),
    },
  };
  if (cfg.instructions) session.instructions = cfg.instructions;
  if (cfg.tools?.length) {
    session.tools = cfg.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  const res = await fetch(`${base}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session }),
  });
  if (!res.ok) {
    throw new Error(
      `realtime client_secrets failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    value?: string;
    client_secret?: { value?: string; expires_at?: number };
    expires_at?: number;
  };
  const token = data.value ?? data.client_secret?.value;
  if (!token) throw new Error("realtime client_secrets returned no token");
  return { token, expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null };
}
