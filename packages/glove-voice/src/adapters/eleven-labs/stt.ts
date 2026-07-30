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

  /**
   * Vocabulary the model is biased towards.
   *
   * This is the single most effective accuracy lever the API exposes, and it
   * matters most for exactly the cases a general model handles worst: proper
   * nouns, product names, identifiers — and accented speech, where biasing
   * toward the words that plausibly occur in THIS conversation narrows what
   * the model has to guess at. Pass the domain's real vocabulary.
   */
  keyterms?: string[];

  /**
   * Strip filler words, false starts and disfluencies from the transcript.
   *
   * Off by default, deliberately. A cleaner transcript reads better, but "uh",
   * "I mean" and a trailing false start are exactly the evidence an
   * end-of-utterance model uses to decide someone has NOT finished talking —
   * removing them upstream makes every turn look complete and invites the
   * agent to interrupt a thought in progress.
   */
  noVerbatim?: boolean;
}

/** Scribe accepts up to 1000 keyterms. The head of the list is what survives
 *  truncation, so callers should pass their most distinctive terms first. */
const MAX_KEYTERMS = 1000;
/**
 * Scribe rejects any keyterm longer than this — and rejects the WHOLE list
 * when one offends, replying `invalid_request` on a socket that stays open and
 * keeps transcribing. So the failure mode is silent: biasing is simply off and
 * nothing downstream can tell. Drop over-long terms here rather than let one
 * "Vanguard Interceptor MkII" disable the vocabulary.
 */
const MAX_KEYTERM_CHARS = 20;

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
  private readonly keyterms: string[];
  private readonly noVerbatim: boolean;

  constructor(private readonly cfg: ElevenLabsSTTConfig) {
    super();
    this.model = cfg.model ?? "scribe_v2_realtime";
    this.language = cfg.language ?? "en";
    this.vadThreshold = cfg.vadSilenceThreshold ?? 0;
    this.maxReconnects = cfg.maxReconnects ?? 3;
    this.keyterms = (cfg.keyterms ?? [])
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= MAX_KEYTERM_CHARS)
      .slice(0, MAX_KEYTERMS);
    this.noVerbatim = cfg.noVerbatim ?? false;
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
      // One REPEATED param per term, not a JSON array: a JSON-encoded list is
      // read as a single enormous keyterm and the whole thing is rejected
      // ("...is 448 characters"), leaving the socket open and unbiased.
      for (const term of this.keyterms) params.append("keyterms", term);
      if (this.noVerbatim) params.set("no_verbatim", "true");

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