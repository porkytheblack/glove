// ─────────────────────────────────────────────────────────────────────────────
// Gemini Live — transport-mode S2S adapter.
//
// A plain WebSocket carrying JSON, which is why this one works in Node and the
// browser alike: it never touches WebRTC, a microphone, or an audio element.
// That is the mode a server-hosted room needs, since there is no microphone in
// the process to open.
//
// The protocol's asymmetric audio rates are a real trap and worth stating
// plainly: input is 16 kHz, output is 24 kHz. Feed 24 kHz in and Gemini hears
// a chipmunk; play 16 kHz out and the agent sounds drunk. Both formats are
// declared on the adapter so a host resamples rather than guesses.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { S2SAdapter, S2SAudioFormat, S2SEvents, S2SSessionConfig } from "./types";
import { base64ToInt16, int16ToBase64 } from "./pcm";

// ── turn-taking types ────────────────────────────────────────────────────────
// Gemini's realtimeInputConfig, typed — static schema, so a typo'd field or
// invalid enum fails at compile time instead of being silently ignored by
// the provider.

export type GeminiStartSensitivity =
  | "START_SENSITIVITY_UNSPECIFIED"
  | "START_SENSITIVITY_HIGH"
  | "START_SENSITIVITY_LOW";

export type GeminiEndSensitivity =
  | "END_SENSITIVITY_UNSPECIFIED"
  | "END_SENSITIVITY_HIGH"
  | "END_SENSITIVITY_LOW";

export interface GeminiAutomaticActivityDetection {
  /** `true` disables provider VAD entirely — manual activityStart /
   *  activityEnd signalling (push-to-talk). */
  disabled?: boolean;
  /** How readily speech START is detected. HIGH triggers on shorter speech
   *  (more false positives); LOW needs more before committing. */
  startOfSpeechSensitivity?: GeminiStartSensitivity;
  /** How readily speech END is called. LOW waits longer before ending your
   *  turn — the patience knob for slow talkers. */
  endOfSpeechSensitivity?: GeminiEndSensitivity;
  /** Audio kept from BEFORE speech was detected, so first syllables aren't
   *  clipped. */
  prefixPaddingMs?: number;
  /** Trailing silence before end-of-speech commits. */
  silenceDurationMs?: number;
}

export interface GeminiRealtimeInputConfig {
  automaticActivityDetection?: GeminiAutomaticActivityDetection;
  /** Default `START_OF_ACTIVITY_INTERRUPTS` (barge-in). `NO_INTERRUPTION`
   *  means the agent always finishes its sentence. */
  activityHandling?: "ACTIVITY_HANDLING_UNSPECIFIED" | "START_OF_ACTIVITY_INTERRUPTS" | "NO_INTERRUPTION";
  /** Whether the model's turn sees only detected speech (default) or ALL
   *  input audio, background included. */
  turnCoverage?: "TURN_COVERAGE_UNSPECIFIED" | "TURN_INCLUDES_ONLY_ACTIVITY" | "TURN_INCLUDES_ALL_INPUT";
}

export interface GeminiLiveConfig {
  /** Called to fetch an ephemeral token or API key from YOUR server. */
  getToken: () => Promise<string> | string;
  /** Default: "models/gemini-live-2.5-flash-preview". */
  model?: string;
  /** Default prebuilt voice, used when the session config doesn't name one.
   *  Gemini takes the voice in the first frame only — per-session, not
   *  mid-call. */
  voice?: string;
  /** Turn-taking knobs, sent as the setup frame's `realtimeInputConfig`. */
  realtimeInput?: GeminiRealtimeInputConfig;
  /**
   * Server-side context management. ON by default (`{ slidingWindow: {} }`):
   * without it an audio session hard-caps at ~15 MINUTES and then dies —
   * with it, Gemini discards the oldest turns (keeping the system
   * instruction) and the session runs indefinitely. Pass `triggerTokens` to
   * tune when compression kicks in, or `false` to accept the 15-minute cap.
   */
  contextWindowCompression?: false | { triggerTokens?: number };
  /**
   * The API version the Live endpoint is served from. Default "v1beta".
   *
   * This is model-dependent and NOT cosmetic: a model served only from
   * another version is reported as "<model> is not found for API version
   * v1beta, or is not supported for bidiGenerateContent" and the session
   * closes (1008). Newer preview models commonly land on "v1alpha" first.
   * `listGeminiLiveModels()` answers which versions serve which models for
   * your own key.
   */
  apiVersion?: "v1beta" | "v1alpha" | (string & {});
  /** Override the endpoint entirely (regional deployments, Vertex). Wins
   *  over `apiVersion`. */
  url?: string;
  /**
   * Inject the socket. Node has a global `WebSocket` from 22, but a host that
   * needs proxying or custom TLS supplies its own — and tests supply a fake.
   */
  socketFactory?: (url: string) => WebSocketLike;
}

/** The slice of the WebSocket API this adapter uses. */
export interface WebSocketLike {
  send(data: string | ArrayBufferLike): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: any) => void): void;
  readyState: number;
}

const GEMINI_INPUT: S2SAudioFormat = { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" };
const GEMINI_OUTPUT: S2SAudioFormat = { sampleRate: 24_000, channels: 1, encoding: "pcm_s16le" };

/**
 * Every field Gemini's `Schema` accepts — an OpenAPI 3.0 subset, NOT JSON
 * Schema. An allowlist rather than a blocklist on purpose: the input comes
 * from `z.toJSONSchema()`, and a Zod release that starts emitting one more
 * keyword must not be able to take the voice down again.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  "type", "format", "title", "description", "nullable", "enum", "items",
  "properties", "required", "minItems", "maxItems", "minProperties",
  "maxProperties", "minLength", "maxLength", "pattern", "minimum", "maximum",
  "default", "anyOf", "example", "propertyOrdering",
]);

/**
 * Project a JSON Schema onto Gemini's Schema.
 *
 * This is load-bearing, not hygiene. Gemini validates the setup frame
 * strictly and rejects the ENTIRE session over a single unknown key —
 * `$schema` and `additionalProperties`, both of which `z.toJSONSchema()`
 * emits by default, are each enough. The socket then closes and the call is
 * silent end to end: mic streaming up, nothing ever coming back. (OpenAI
 * Realtime accepts full JSON Schema, which is why only this adapter needs it.)
 */
export function geminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        props[name] = geminiSchema(sub);
      }
      out.properties = props;
    } else if (key === "items") {
      out.items = geminiSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map((s) => geminiSchema(s));
    } else if (key === "type" && Array.isArray(value)) {
      // JSON Schema's `["string", "null"]` union is Gemini's `nullable`.
      const types = value.filter((t) => t !== "null");
      out.type = types[0] ?? "string";
      if (types.length !== value.length) out.nullable = true;
    } else {
      out[key] = value;
    }
  }

  // `const` has no Gemini equivalent, but a single-value enum says the same
  // thing — and dropping it silently would widen the contract instead.
  if ("const" in src && !("enum" in out)) out.enum = [src.const];
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

/**
 * Ask Google which models THIS key can actually open a Live session with.
 *
 * "<model> is not found for API version v1beta, or is not supported for
 * bidiGenerateContent" is the single most common Gemini Live failure, and it
 * has three different causes (wrong id, wrong API version, no access on this
 * key) that the message doesn't distinguish. ListModels does: it reports each
 * model's `supportedGenerationMethods`, per version, for the caller's own
 * project — so this replaces guesswork with an answer.
 */
export async function listGeminiLiveModels(opts: {
  apiKey: string;
  /** Versions to probe. Default: both — which one serves a model is exactly
   *  the thing in question. */
  apiVersions?: string[];
  fetchFn?: typeof fetch;
}): Promise<Array<{ name: string; apiVersion: string; displayName?: string }>> {
  const doFetch = opts.fetchFn ?? fetch;
  const out: Array<{ name: string; apiVersion: string; displayName?: string }> = [];
  for (const version of opts.apiVersions ?? ["v1beta", "v1alpha"]) {
    try {
      const res = await doFetch(
        `https://generativelanguage.googleapis.com/${version}/models?key=${encodeURIComponent(opts.apiKey)}&pageSize=200`,
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      for (const m of body.models ?? []) {
        if (!m.name) continue;
        if (!m.supportedGenerationMethods?.includes("bidiGenerateContent")) continue;
        out.push({
          name: m.name.replace(/^models\//, ""),
          apiVersion: version,
          ...(m.displayName ? { displayName: m.displayName } : {}),
        });
      }
    } catch {
      /* one version being unreachable must not hide the other */
    }
  }
  return out;
}

export class GeminiLiveAdapter extends EventEmitter<S2SEvents> implements S2SAdapter {
  readonly mode = "transport" as const;
  readonly inputFormat = GEMINI_INPUT;

  private ws: WebSocketLike | null = null;
  private connected = false;
  private agentTranscript = "";
  private speaking = false;
  /** callId → function name. Gemini's functionResponse requires the NAME of
   *  the function alongside the id; the S2S contract only threads the id, so
   *  remember the pairing from the inbound call. */
  private readonly callNames = new Map<string, string>();

  constructor(private readonly cfg: GeminiLiveConfig) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(config?: S2SSessionConfig): Promise<void> {
    const token = await this.cfg.getToken();
    const version = this.cfg.apiVersion ?? "v1beta";
    const base =
      this.cfg.url ??
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`;
    const url = `${base}?key=${encodeURIComponent(token)}`;

    const ws = this.cfg.socketFactory
      ? this.cfg.socketFactory(url)
      : (new WebSocket(url) as unknown as WebSocketLike);
    this.ws = ws;
    // Gemini delivers its JSON over BINARY frames. Ask for ArrayBuffer so we
    // decode synchronously; without this, browsers (and undici) hand back a
    // Blob. Best-effort — fakes and exotic sockets may not have the property.
    try {
      (ws as { binaryType?: string }).binaryType = "arraybuffer";
    } catch {
      /* fake sockets */
    }

    ws.addEventListener("message", (ev: { data: unknown }) => this.onMessage(ev.data));
    ws.addEventListener("error", (ev: { message?: string; error?: { message?: string } }) =>
      this.emit(
        "error",
        new Error(`Gemini Live socket error: ${ev?.error?.message ?? ev?.message ?? "unknown"}`),
      ),
    );
    ws.addEventListener("close", (ev: { code?: number; reason?: string }) => {
      const wasConnected = this.connected;
      this.connected = false;
      // Gemini reports a REJECTED SETUP by closing with a descriptive reason
      // ("Unknown name \"$schema\" at 'setup.tools[0]…'"). Swallowing it turns
      // every configuration mistake into an unexplained silent call, so an
      // abnormal close is surfaced as an error, not just a disconnect.
      const code = ev?.code;
      const reason = ev?.reason;
      if (code !== undefined && code !== 1000 && code !== 1005) {
        this.emit(
          "error",
          new Error(
            `Gemini Live closed (${code})${reason ? `: ${reason}` : ""}` +
              (wasConnected ? "" : " — the session never started; check the setup frame"),
          ),
        );
      }
      this.emit("disconnected");
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Gemini Live connect timed out")), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        // Setup MUST be the first frame; Gemini rejects anything else.
        ws.send(JSON.stringify({ setup: this.buildSetup(config) }));
        this.connected = true;
        this.emit("connected");
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Gemini Live connect failed"));
      });
    });
  }

  private buildSetup(config?: S2SSessionConfig): Record<string, unknown> {
    const voice = config?.voice ?? this.cfg.voice;
    const setup: Record<string, unknown> = {
      model: this.cfg.model ?? "models/gemini-live-2.5-flash-preview",
      generationConfig: {
        responseModalities: ["AUDIO"],
        ...(voice
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
          : {}),
      },
      // Both transcriptions on: without them the host has no record of the
      // conversation at all, since the audio never becomes text anywhere else.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (this.cfg.realtimeInput) {
      setup.realtimeInputConfig = this.cfg.realtimeInput;
    }
    // Context compression defaults ON — see the config doc: without it the
    // provider ends audio sessions at ~15 minutes.
    if (this.cfg.contextWindowCompression !== false) {
      const cwc = this.cfg.contextWindowCompression;
      setup.contextWindowCompression = {
        slidingWindow: {},
        ...(cwc?.triggerTokens ? { triggerTokens: String(cwc.triggerTokens) } : {}),
      };
    }
    if (config?.instructions) {
      setup.systemInstruction = { parts: [{ text: config.instructions }] };
    }
    if (config?.tools?.length) {
      setup.tools = [
        {
          functionDeclarations: config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            // MUST be sanitized: Gemini's Schema is an OpenAPI 3.0 subset and
            // REJECTS THE WHOLE SETUP over one unknown key. See geminiSchema.
            parameters: geminiSchema(t.parameters),
          })),
        },
      ];
    }
    return setup;
  }

  sendAudio(pcm: Int16Array): void {
    if (!this.connected || !this.ws) return;
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { mimeType: "audio/pcm;rate=16000", data: int16ToBase64(pcm) },
        },
      }),
    );
  }

  injectText(text: string, opts?: { respond?: boolean }): void {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          // turnComplete is what asks for a reply. False leaves the text as
          // context the model will use on the next turn without speaking now.
          turnComplete: opts?.respond !== false,
        },
      }),
    );
  }

  sendToolResult(callId: string, output: unknown): void {
    if (!this.ws) return;
    const name = this.callNames.get(callId) ?? callId;
    this.callNames.delete(callId);
    this.ws.send(
      JSON.stringify({
        toolResponse: {
          functionResponses: [{ id: callId, name, response: { output } }],
        },
      }),
    );
  }

  updateSession(patch: Partial<S2SSessionConfig>): void {
    // Gemini has no mid-session setup patch: setup is first-frame-only. Text
    // is the only channel left, so instruction changes go in as context rather
    // than silently doing nothing.
    if (patch.instructions) {
      this.injectText(`[system] ${patch.instructions}`, { respond: false });
    }
  }

  interrupt(): void {
    // Gemini interrupts natively when the user speaks; an explicit barge-in is
    // expressed as an empty turn, which cancels the in-flight response. The
    // host's playback queue is local and often still holds audio after the
    // turn finished GENERATING, so always report the interruption locally
    // rather than waiting for the provider to echo one back.
    if (this.ws) {
      this.ws.send(JSON.stringify({ clientContent: { turns: [], turnComplete: true } }));
    }
    const wasSpeaking = this.speaking;
    this.speaking = false;
    this.agentTranscript = "";
    this.emit("interrupted");
    if (wasSpeaking) this.emit("agent_speech_stopped");
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.ws?.close();
    this.ws = null;
    this.emit("disconnected");
  }

  // ── inbound ────────────────────────────────────────────────────────────────

  private onMessage(raw: unknown): void {
    // THE trap of this protocol: Gemini sends its JSON over BINARY WebSocket
    // frames, not text. `String(blob)` is "[object Blob]", so a naive parse
    // silently drops every inbound message — the session connects, the mic
    // streams up, and nothing ever comes back. Decode by frame type instead.
    if (typeof Blob !== "undefined" && raw instanceof Blob) {
      void raw
        .text()
        .then((text) => this.handleFrame(text))
        .catch(() => {});
      return;
    }
    if (raw instanceof ArrayBuffer) {
      this.handleFrame(new TextDecoder().decode(raw));
      return;
    }
    if (ArrayBuffer.isView(raw)) {
      // Node Buffer (ws package) lands here.
      this.handleFrame(new TextDecoder().decode(raw as Uint8Array));
      return;
    }
    this.handleFrame(String(raw));
  }

  private handleFrame(text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.toolCall?.functionCalls) {
      for (const fc of msg.toolCall.functionCalls) {
        const callId = String(fc.id ?? fc.name);
        this.callNames.set(callId, String(fc.name));
        this.emit("tool_call", {
          callId,
          name: String(fc.name),
          arguments: JSON.stringify(fc.args ?? {}),
        });
      }
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) {
      this.emit("user_transcript", String(sc.inputTranscription.text), true);
    }
    if (sc.outputTranscription?.text) {
      const text = String(sc.outputTranscription.text);
      this.agentTranscript += text;
      this.emit("agent_transcript_delta", text);
    }

    for (const part of sc.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (!data) continue;
      if (!this.speaking) {
        this.speaking = true;
        this.emit("agent_speech_started");
      }
      this.emit("audio", base64ToInt16(String(data)), GEMINI_OUTPUT);
    }

    if (sc.interrupted) {
      this.speaking = false;
      this.agentTranscript = "";
      this.emit("interrupted");
    }
    if (sc.turnComplete) {
      if (this.speaking) {
        this.speaking = false;
        this.emit("agent_speech_stopped");
      }
      if (this.agentTranscript) {
        this.emit("agent_transcript_done", this.agentTranscript);
        this.agentTranscript = "";
      }
    }
  }

}

