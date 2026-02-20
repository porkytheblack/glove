import EventEmitter from "eventemitter3";
import type { STTAdapter, STTAdapterEvents, GetTokenFn } from "../types";

export interface ElevenLabsSTTConfig {
  /**
   * Called to fetch a short-lived token from YOUR server.
   * Your server calls POST /v1/tokens/create with scope "stt_websocket".
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
  | { message_type: "error"; error: string };

/**
 * ElevenLabs Scribe Realtime STT adapter.
 *
 * Auth: server-side token via getToken(). Your server calls:
 *   POST https://api.elevenlabs.io/v1/tokens/create
 *   Body: { "type": "stt_websocket" }
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
      const url = [
        `wss://api.elevenlabs.io/v1/speech-to-text/stream`,
        `?token=${encodeURIComponent(token)}`,
        `&model_id=${this.model}`,
        `&language_code=${this.language}`,
        `&enable_partial_transcripts=true`,
        `&vad_silence_threshold_secs=${this.vadThreshold}`,
      ].join("");

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
          this.reconnectTimer = setTimeout(
            () => void this.connect(),
            500 * this.reconnects
          );
        } else if (!this.destroyed) {
          this.emit("close");
        }
      };
    });
  }

  private handleMessage(data: ScribeMessage): void {
    switch (data.message_type) {
      case "partial_transcript":
        this.partial = data.text;
        this.emit("partial", data.text);
        break;

      case "committed_transcript":
        this.partial = "";
        this.emit("final", data.text);
        break;

      case "error":
        this.emit("error", new Error(data.error));
        break;
    }
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Scribe expects base64-encoded PCM in a JSON message
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: int16ToBase64(pcm),
        sample_rate: 16000,
      })
    );
  }

  flushUtterance(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ message_type: "commit_audio_chunk" }));
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
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}