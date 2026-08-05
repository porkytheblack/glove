// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Realtime over WebSocket — transport-mode S2S adapter.
//
// The WebRTC adapter (openai-realtime.ts) is DEVICE mode: it opens the
// microphone and plays the reply itself, which is the least code in a browser
// and impossible anywhere else. This adapter is the other half: a plain
// WebSocket moving JSON and base64 PCM, so it runs in a Node room process or
// a phone bridge — the host owns capture and playback.
//
// Audio is 24 kHz mono PCM16 in BOTH directions (OpenAI's pcm16 rate), unlike
// Gemini's asymmetric 16-in/24-out. Both formats are declared on the adapter
// so the host resamples rather than guesses.
//
// Auth uses the `openai-insecure-api-key.<token>` WebSocket subprotocol,
// because the spec WebSocket in both Node (22+) and the browser cannot set an
// Authorization header. "Insecure" refers to putting a key where a browser
// could see it — hand this adapter an EPHEMERAL client secret in a browser,
// or the real API key only in a server process that already holds it.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { S2SAdapter, S2SAudioFormat, S2SEvents, S2SSessionConfig } from "./types";
import type { WebSocketLike } from "./gemini-live";
import { base64ToInt16, int16ToBase64 } from "./pcm";

export interface OpenAIRealtimeSocketConfig {
  /** An ephemeral client secret (browser) or the API key (server-side only). */
  getToken: () => Promise<string> | string;
  /** Realtime model (default "gpt-realtime"). */
  model?: string;
  /** Override the endpoint (default wss://api.openai.com/v1/realtime). */
  url?: string;
  /** Model for user-audio transcription events (default gpt-4o-mini-transcribe). */
  transcriptionModel?: string;
  /** Turn detection. Default: semantic VAD — the model decides from LISTENING
   *  whether the speaker is done. */
  turnDetection?: Record<string, unknown>;
  /** Inject the socket — proxies, custom TLS, and tests. Note the subprotocol
   *  list: it carries the auth. */
  socketFactory?: (url: string, protocols: string[]) => WebSocketLike;
}

const OPENAI_PCM: S2SAudioFormat = { sampleRate: 24_000, channels: 1, encoding: "pcm_s16le" };

export class OpenAIRealtimeSocketAdapter extends EventEmitter<S2SEvents> implements S2SAdapter {
  readonly mode = "transport" as const;
  readonly inputFormat = OPENAI_PCM;

  private ws: WebSocketLike | null = null;
  private connected = false;
  private agentTranscript = "";
  private speaking = false;
  /**
   * The assistant item currently being (or last) spoken, for truncation sync.
   *
   * Audio generates faster than it plays, so on a barge-in the model's
   * context holds its FULL reply while the caller heard only a prefix. The
   * heard length is estimated from the playback clock — audio drains at
   * realtime from the first delta, so heard ≈ min(elapsed, emitted) — and
   * `conversation.item.truncate` rewrites the item to just that prefix. The
   * model then knows exactly where it was cut off and can decide how much
   * of the explanation still needs saying.
   */
  private spokenItem: { id: string; emittedMs: number; firstDeltaAt: number } | null = null;

  constructor(private readonly cfg: OpenAIRealtimeSocketConfig) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(config?: S2SSessionConfig): Promise<void> {
    const token = await this.cfg.getToken();
    const base = (this.cfg.url ?? "wss://api.openai.com/v1/realtime").replace(/\/$/, "");
    const url = `${base}?model=${encodeURIComponent(this.cfg.model ?? "gpt-realtime")}`;
    const protocols = ["realtime", `openai-insecure-api-key.${token}`];

    const ws = this.cfg.socketFactory
      ? this.cfg.socketFactory(url, protocols)
      : (new WebSocket(url, protocols) as unknown as WebSocketLike);
    this.ws = ws;

    ws.addEventListener("message", (ev: { data: unknown }) => this.onMessage(ev.data));
    ws.addEventListener("error", () => this.emit("error", new Error("Realtime socket error")));
    ws.addEventListener("close", () => {
      this.connected = false;
      this.emit("disconnected");
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime connect timed out")), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.connected = true;
        this.sendSessionUpdate(config ?? {}, true);
        this.emit("connected");
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Realtime connect failed"));
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.ws?.close();
    this.ws = null;
    this.emit("disconnected");
  }

  sendAudio(pcm: Int16Array): void {
    if (!this.connected || !this.ws) return;
    this.send({ type: "input_audio_buffer.append", audio: int16ToBase64(pcm) });
  }

  injectText(text: string, opts?: { respond?: boolean; role?: "user" | "system" }): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: opts?.role ?? "user",
        content: [{ type: "input_text", text }],
      },
    });
    if (opts?.respond) this.send({ type: "response.create" });
  }

  sendToolResult(callId: string, output: unknown, opts?: { respond?: boolean }): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof output === "string" ? output : JSON.stringify(output),
      },
    });
    if (opts?.respond !== false) this.send({ type: "response.create" });
  }

  updateSession(patch: Partial<S2SSessionConfig>): void {
    this.sendSessionUpdate(patch, false);
  }

  interrupt(): void {
    this.send({ type: "response.cancel" });
    this.truncateToHeard();
    // No remote playback buffer to clear over plain WS — the HOST holds the
    // queue. Always report the interruption (see speech_started above for
    // why this must not gate on `speaking`).
    const wasSpeaking = this.speaking;
    this.speaking = false;
    this.emit("interrupted");
    if (wasSpeaking) this.emit("agent_speech_stopped");
  }

  /**
   * Rewrite the model's context to what the caller actually HEARD.
   *
   * Without this, an interrupted reply stays in context in full and the model
   * believes everything was delivered — so it never re-explains the part that
   * was cut. The heard length is a playback-clock estimate: audio drains at
   * realtime from the first delta, so heard ≈ elapsed wall-clock, clamped to
   * what was emitted. If playback plainly finished (elapsed ≥ emitted), there
   * is nothing to truncate and no frame is sent.
   */
  private truncateToHeard(): void {
    const item = this.spokenItem;
    this.spokenItem = null;
    if (!item || item.emittedMs <= 0) return;
    const elapsedMs = Date.now() - item.firstDeltaAt;
    if (elapsedMs >= item.emittedMs) return; // fully heard — nothing was cut
    this.send({
      type: "conversation.item.truncate",
      item_id: item.id,
      content_index: 0,
      audio_end_ms: Math.max(0, Math.round(elapsedMs)),
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private send(event: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(event));
  }

  /** `full` includes the audio formats, transcription and turn detection —
   *  first-frame session setup; patches only carry what changed. */
  private sendSessionUpdate(patch: Partial<S2SSessionConfig>, full: boolean): void {
    const session: Record<string, unknown> = { type: "realtime" };
    const audio: Record<string, unknown> = {};
    if (full) {
      audio.input = {
        format: { type: "audio/pcm", rate: OPENAI_PCM.sampleRate },
        transcription: { model: this.cfg.transcriptionModel ?? "gpt-4o-mini-transcribe" },
        turn_detection: this.cfg.turnDetection ?? { type: "semantic_vad" },
      };
      audio.output = { format: { type: "audio/pcm", rate: OPENAI_PCM.sampleRate } };
    }
    if (patch.voice !== undefined) {
      audio.output = { ...(audio.output as object | undefined), voice: patch.voice };
    }
    if (Object.keys(audio).length) session.audio = audio;
    if (patch.instructions !== undefined) session.instructions = patch.instructions;
    if (patch.tools !== undefined) {
      session.tools = patch.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }
    this.send({ type: "session.update", session });
  }

  private onMessage(raw: unknown): void {
    let e: { type?: string; [key: string]: unknown };
    try {
      e = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }

    switch (e.type) {
      case "input_audio_buffer.speech_started": {
        this.emit("user_speech_started");
        // Over plain WS the provider cannot know what the host has PLAYED.
        // Audio arrives faster than realtime, so a response is usually done
        // GENERATING (and `speaking` already false) while seconds of it still
        // sit in the host's playback queue — gating the flush on `speaking`
        // is exactly how barge-in silently stops working. User speech is
        // therefore ALWAYS treated as a potential interruption: cancel any
        // in-flight response and tell the host to flush. Flushing an empty
        // queue is free; talking over the caller is not.
        this.send({ type: "response.cancel" });
        this.truncateToHeard();
        const wasSpeaking = this.speaking;
        this.speaking = false;
        this.emit("interrupted");
        if (wasSpeaking) this.emit("agent_speech_stopped");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.emit("user_speech_stopped");
        break;

      case "conversation.item.input_audio_transcription.delta":
        this.emit("user_transcript", String(e.delta ?? ""), false);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit("user_transcript", String(e.transcript ?? ""), true);
        break;

      // GA name first, beta name second — same payload shape throughout.
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const pcm = base64ToInt16(String(e.delta ?? ""));
        const itemId = String(e.item_id ?? "");
        if (itemId) {
          if (this.spokenItem?.id !== itemId) {
            this.spokenItem = { id: itemId, emittedMs: 0, firstDeltaAt: Date.now() };
          }
          this.spokenItem.emittedMs += (pcm.length * 1000) / OPENAI_PCM.sampleRate;
        }
        if (!this.speaking) {
          this.speaking = true;
          this.emit("agent_speech_started");
        }
        this.emit("audio", pcm, OPENAI_PCM);
        break;
      }
      case "response.output_audio.done":
      case "response.audio.done":
      case "response.done":
        if (this.speaking) {
          this.speaking = false;
          this.emit("agent_speech_stopped");
        }
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const d = String(e.delta ?? "");
        this.agentTranscript += d;
        this.emit("agent_transcript_delta", d);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.emit("agent_transcript_done", String(e.transcript ?? this.agentTranscript));
        this.agentTranscript = "";
        break;

      case "response.function_call_arguments.done":
        this.emit("tool_call", {
          callId: String(e.call_id ?? ""),
          name: String(e.name ?? ""),
          arguments: String(e.arguments ?? "{}"),
        });
        break;

      case "error": {
        const err = (e.error ?? {}) as { message?: string; code?: string };
        // Cancelling with nothing in flight is a no-op, not a failure.
        if (err.code === "response_cancel_not_active") break;
        this.emit("error", new Error(err.message ?? "Realtime error"));
        break;
      }
      default:
        break;
    }
  }
}
