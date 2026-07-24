import EventEmitter from "eventemitter3";
import type { TTSAdapter, TTSAdapterEvents, GetTokenFn } from "../types";
import { base64ToBytes } from "../../base64";

export interface ElevenLabsTTSConfig {
  /**
   * Called to fetch a short-lived token from YOUR server.
   * Your server calls POST /v1/single-use-token/tts_websocket.
   *
   * @example
   * getToken: () => fetch("/api/voice/tts-token").then(r => r.json()).then(d => d.token)
   */
  getToken: GetTokenFn;

  /** ElevenLabs voice ID */
  voiceId: string;

  /** TTS model (default: "eleven_turbo_v2_5" — lowest latency) */
  model?: string;

  /** Output audio format (default: "pcm_16000") */
  outputFormat?: string;

  /**
   * Enable ElevenLabs `auto_mode`: generation triggers as soon as a sentence
   * completes instead of waiting for the default chunk schedule (~120+ chars
   * buffered before ANY audio). Without this, responses shorter than the
   * buffer threshold only synthesize at flush() — i.e. after the whole turn.
   * When enabled, send full sentences/phrases (e.g. via `SentenceBuffer`),
   * not raw token fragments. Default: false (previous behavior).
   */
  autoMode?: boolean;

  /**
   * Override the buffering schedule instead. `chunkLengthSchedule` (sent as
   * `generation_config.chunk_length_schedule` on the BOS message) sets how
   * many buffered characters trigger each successive generation — e.g.
   * `[60, 120, 160, 250]` starts synthesis mid-sentence after ~60 chars,
   * which beats sentence-boundary triggering for short single-sentence
   * replies. Values must be 50–500 per ElevenLabs. Ignored under `autoMode`.
   */
  generationConfig?: { chunkLengthSchedule?: number[] };

  /** Voice settings */
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  };
}

interface TTSServerMessage {
  audio?: string;       // base64 PCM chunk
  isFinal?: boolean;
  normalizedAlignment?: unknown;
}

/**
 * ElevenLabs TTS Input Streaming adapter.
 *
 * Auth: server-side token via getToken(). Your server calls:
 *   POST https://api.elevenlabs.io/v1/single-use-token/tts_websocket
 *   Headers: { "xi-api-key": YOUR_API_KEY }
 *
 * Open in parallel with your Glove request — hides ~200ms handshake cost.
 */
export class ElevenLabsTTSAdapter
  extends EventEmitter<TTSAdapterEvents>
  implements TTSAdapter
{
  private ws: WebSocket | null = null;
  private ready = false;
  private queue: Array<{ text: string; flush?: boolean }> = [];
  private sawFinal = false;
  private emittedAudio = false;
  private closedByUs = false;

  private readonly model: string;
  private readonly outputFormat: string;

  constructor(private readonly cfg: ElevenLabsTTSConfig) {
    super();
    this.model = cfg.model ?? "eleven_turbo_v2_5";
    this.outputFormat = cfg.outputFormat ?? "pcm_16000";
  }

  async open(): Promise<void> {
    const token = await this.cfg.getToken();

    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        single_use_token: token,
        model_id: this.model,
        output_format: this.outputFormat,
      });
      if (this.cfg.autoMode) params.set("auto_mode", "true");
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.cfg.voiceId}/stream-input?${params}`;

      console.debug(`[ElevenLabsTTS] connecting to ${url.replace(/single_use_token=[^&]+/, "single_use_token=***")}`);
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.debug(`[ElevenLabsTTS] WebSocket opened, sending BOS`);
        // BOS marker — required before sending text
        const schedule = this.cfg.generationConfig?.chunkLengthSchedule;
        this.ws!.send(
          JSON.stringify({
            text: " ",
            voice_settings: {
              stability: this.cfg.voiceSettings?.stability ?? 0.5,
              similarity_boost: this.cfg.voiceSettings?.similarityBoost ?? 0.8,
              speed: this.cfg.voiceSettings?.speed ?? 1.0,
            },
            ...(schedule?.length
              ? { generation_config: { chunk_length_schedule: schedule } }
              : {}),
          })
        );
        this.ready = true;

        // Flush text that arrived before the socket opened
        for (const msg of this.queue) this._send(msg.text, msg.flush);
        this.queue = [];

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: TTSServerMessage & { error?: unknown; message?: unknown; code?: unknown } =
            JSON.parse(event.data as string);
          if (data.audio) {
            console.debug(`[ElevenLabsTTS] audio chunk (${data.audio.length} b64 chars)`);
            this.emittedAudio = true;
            this.emit("audio_chunk", base64ToUint8Array(data.audio));
          }
          if (data.isFinal) {
            console.debug(`[ElevenLabsTTS] isFinal received`);
            this.sawFinal = true;
            this.emit("done");
          }
          if (!data.audio && !data.isFinal && (data.error || data.message)) {
            // Policy/validation frames (e.g. a rejected BOS option) — surface
            // them instead of silently buffering-forever.
            console.warn(`[ElevenLabsTTS] server frame:`, event.data);
            if (data.error) {
              this.emit("error", new Error(`ElevenLabs TTS: ${String(data.error)}`));
            }
          }
        } catch {
          // Ignore non-JSON frames
        }
      };

      this.ws.onerror = (ev) => {
        console.error(`[ElevenLabsTTS] WebSocket error`, ev);
        const err = new Error("ElevenLabs TTS WebSocket error");
        this.emit("error", err);
        reject(err);
      };

      this.ws.onclose = (ev) => {
        console.debug(`[ElevenLabsTTS] WebSocket closed (code=${ev.code}, reason="${ev.reason}")`);
        this.ready = false;
        // A close without isFinal would otherwise leave consumers hanging
        // forever (no done, no error) — always complete the lifecycle.
        if (!this.sawFinal && !this.closedByUs) {
          console.warn(`[ElevenLabsTTS] closed without isFinal (code=${ev.code}, reason="${ev.reason}")`);
          this.sawFinal = true;
          if (this.emittedAudio) this.emit("done");
          else this.emit("error", new Error(`ElevenLabs TTS socket closed before any audio (code=${ev.code}${ev.reason ? `, ${ev.reason}` : ""})`));
        }
      };
    });
  }

  /**
   * Send a text chunk. Pass `opts.flush` to force ElevenLabs to synthesize
   * everything buffered so far (the `flush: true` message flag) — the
   * deterministic realtime trigger, independent of server-side buffering
   * schedules.
   */
  sendText(text: string, opts?: { flush?: boolean }): void {
    if (!this.ready) {
      this.queue.push({ text, flush: opts?.flush });
      return;
    }
    this._send(text, opts?.flush);
  }

  private _send(text: string, flush?: boolean): void {
    this.ws?.send(JSON.stringify({ text, ...(flush ? { flush: true } : {}) }));
  }

  flush(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text: "" })); // EOS marker
    }
    this.ready = false;
  }

  destroy(): void {
    this.ready = false;
    this.closedByUs = true;
    this.queue = [];
    this.ws?.close();
    this.ws = null;
  }

  get isReady(): boolean {
    return this.ready;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  // Pure-JS base64 — works in browsers AND React Native (no atob in Hermes).
  return base64ToBytes(b64);
}