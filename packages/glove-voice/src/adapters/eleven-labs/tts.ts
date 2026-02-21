import EventEmitter from "eventemitter3";
import type { TTSAdapter, TTSAdapterEvents, GetTokenFn } from "../types";

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
  private queue: string[] = [];

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
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.cfg.voiceId}/stream-input?${params}`;

      console.debug(`[ElevenLabsTTS] connecting to ${url.replace(/single_use_token=[^&]+/, "single_use_token=***")}`);
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.debug(`[ElevenLabsTTS] WebSocket opened, sending BOS`);
        // BOS marker — required before sending text
        this.ws!.send(
          JSON.stringify({
            text: " ",
            voice_settings: {
              stability: this.cfg.voiceSettings?.stability ?? 0.5,
              similarity_boost: this.cfg.voiceSettings?.similarityBoost ?? 0.8,
              speed: this.cfg.voiceSettings?.speed ?? 1.0,
            },
          })
        );
        this.ready = true;

        // Flush text that arrived before the socket opened
        for (const text of this.queue) this._send(text);
        this.queue = [];

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: TTSServerMessage = JSON.parse(event.data as string);
          if (data.audio) {
            console.debug(`[ElevenLabsTTS] audio chunk (${data.audio.length} b64 chars)`);
            this.emit("audio_chunk", base64ToUint8Array(data.audio));
          }
          if (data.isFinal) {
            console.debug(`[ElevenLabsTTS] isFinal received`);
            this.emit("done");
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
      };
    });
  }

  sendText(text: string): void {
    if (!this.ready) {
      this.queue.push(text);
      return;
    }
    this._send(text);
  }

  private _send(text: string): void {
    this.ws?.send(JSON.stringify({ text }));
  }

  flush(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text: "" })); // EOS marker
    }
    this.ready = false;
  }

  destroy(): void {
    this.ready = false;
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
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}