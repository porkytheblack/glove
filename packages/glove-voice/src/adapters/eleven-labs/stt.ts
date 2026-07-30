import EventEmitter from "eventemitter3";
import type { STTAdapter, STTAdapterEvents, GetTokenFn } from "../types";
import { bytesToBase64 } from "../../base64";

export interface ElevenLabsSTTConfig {
  /**
   * Called to fetch a short-lived token from YOUR server.
   * Your server calls POST /v1/single-use-token/realtime_scribe.
   *
   * @example
   * getToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token)
   */
  getToken: GetTokenFn;

  /** Scribe model (default: "scribe_v2_realtime") */
  model?: string;

  /** Language code (default: "en") */
  language?: string;

  /**
   * Seconds of silence before Scribe auto-commits an utterance.
   * Set to 0 to disable auto-commit and rely on manual flushUtterance() calls.
   * (default: 0 — we manage VAD ourselves for lower latency)
   */
  vadSilenceThreshold?: number;

  /** Max auto-reconnect attempts on unexpected disconnect (default: 3) */
  maxReconnects?: number;
}

type ScribeMessage =
  | { message_type: "session_started"; session_id: string; config: unknown }
  | { message_type: "partial_transcript"; text: string }
  | { message_type: "committed_transcript"; text: string }
  | { message_type: "invalid_request"; error: string; [key: string]: unknown }
  | { message_type: "error"; error: string };

/**
 * ElevenLabs Scribe Realtime STT adapter.
 *
 * Auth: server-side token via getToken(). Your server calls:
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe
 *   Headers: { "xi-api-key": YOUR_API_KEY }
 *
 * The token is passed as a query param to the WebSocket URL.
 */
export class ElevenLabsSTTAdapter
  extends EventEmitter<STTAdapterEvents>
  implements STTAdapter
{
  private ws: WebSocket | null = null;
  private partial = "";
  private reconnects = 0;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly model: string;
  private readonly language: string;
  private readonly vadThreshold: number;
  private readonly maxReconnects: number;

  constructor(private readonly cfg: ElevenLabsSTTConfig) {
    super();
    this.model = cfg.model ?? "scribe_v2_realtime";
    this.language = cfg.language ?? "en";
    this.vadThreshold = cfg.vadSilenceThreshold ?? 0;
    this.maxReconnects = cfg.maxReconnects ?? 3;
  }

  async connect(): Promise<void> {
    const token = await this.cfg.getToken();

    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        token,
        model_id: this.model,
        language_code: this.language,
        audio_format: "pcm_16000",
      });

      // Only add VAD params when using server-side VAD commit strategy
      if (this.vadThreshold > 0) {
        params.set("commit_strategy", "vad");
        params.set("vad_silence_threshold_secs", String(this.vadThreshold));
      }

      const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`;

      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.reconnects = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: ScribeMessage = JSON.parse(event.data as string);
          this.handleMessage(data);
        } catch {
          // Binary frame — not expected from Scribe
        }
      };

      this.ws.onerror = () => {
        const err = new Error("ElevenLabs STT WebSocket error");
        this.emit("error", err);
        reject(err);
      };

      this.ws.onclose = () => {
        if (!this.destroyed && this.reconnects < this.maxReconnects) {
          this.reconnects++;
          this.reconnectTimer = setTimeout(() => {
            // A reconnect's failure must never become an UNHANDLED rejection.
            // `connect()` both rejects on a socket error and throws when the
            // token mint fails, and nobody awaits it on this path — so a
            // transient 5xx from the token endpoint (seen live as a DNS blip
            // returning 503) took down the entire host process. For a voice
            // gateway that means the room dies mid-call and the caller's
            // microphone goes permanently dead. Surface it and let the next
            // close event schedule the following attempt instead.
            this.connect().catch((err: unknown) => {
              this.emit(
                "error",
                err instanceof Error ? err : new Error(String(err)),
              );
              if (this.reconnects >= this.maxReconnects && !this.destroyed) {
                this.emit("close");
              }
            });
          }, 500 * this.reconnects);
        } else if (!this.destroyed) {
          this.emit("close");
        }
      };
    });
  }

  private handleMessage(data: ScribeMessage): void {
    switch (data.message_type) {
      case "session_started":
        console.debug(`[ElevenLabsSTT] session started`, data.session_id);
        break;

      case "partial_transcript":
        console.debug(`[ElevenLabsSTT] partial: "${data.text}"`);
        this.partial = data.text;
        this.emit("partial", data.text);
        break;

      case "committed_transcript": {
        // ElevenLabs sometimes returns an empty committed transcript for
        // short utterances ("No", "Hi") when we flush with a silence frame.
        // Fall back to the last partial — it's what Scribe actually heard.
        const text = data.text || this.partial;
        console.debug(`[ElevenLabsSTT] committed: "${data.text}"${data.text ? "" : ` (using partial: "${text}")`}`);
        this.partial = "";
        this.emit("final", text);
        break;
      }

      case "invalid_request":
        console.error(`[ElevenLabsSTT] invalid_request:`, JSON.stringify(data));
        this.emit("error", new Error(`Scribe invalid_request: ${data.error}`));
        break;

      case "error":
        console.error(`[ElevenLabsSTT] error:`, data.error);
        this.emit("error", new Error(data.error));
        break;

      default:
        console.debug(`[ElevenLabsSTT] unknown message:`, JSON.stringify(data));
        break;
    }
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: int16ToBase64(pcm),
        commit: false,
        sample_rate: 16000,
      })
    );
  }

  flushUtterance(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Scribe rejects a commit with less than 0.3s of uncommitted audio
    // ("commit_throttled"), and a rejected commit is invisible: the caller
    // believes the buffer was cleared while Scribe keeps accumulating, so the
    // next utterance arrives glued to the last one. Send enough silence to
    // clear that bar. It costs 320ms of padding at an utterance boundary,
    // where the speaker has already stopped.
    const silence = new Int16Array(5120); // 0.32s at 16kHz — over Scribe's 0.3s floor
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: int16ToBase64(silence),
        commit: true,
        sample_rate: 16000,
      })
    );
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentPartial(): string {
    return this.partial;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function int16ToBase64(pcm: Int16Array): string {
  // Pure-JS base64 — works in browsers AND React Native (no btoa in Hermes).
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}