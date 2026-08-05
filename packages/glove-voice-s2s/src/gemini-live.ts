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

export interface GeminiLiveConfig {
  /** Called to fetch an ephemeral token or API key from YOUR server. */
  getToken: () => Promise<string> | string;
  /** Default: "models/gemini-live-2.5-flash-preview". */
  model?: string;
  /** Default prebuilt voice, used when the session config doesn't name one.
   *  Gemini takes the voice in the first frame only — per-session, not
   *  mid-call. */
  voice?: string;
  /** Override the endpoint (regional deployments, Vertex). */
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
    const base =
      this.cfg.url ??
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
    const url = `${base}?key=${encodeURIComponent(token)}`;

    const ws = this.cfg.socketFactory
      ? this.cfg.socketFactory(url)
      : (new WebSocket(url) as unknown as WebSocketLike);
    this.ws = ws;

    ws.addEventListener("message", (ev: { data: unknown }) => this.onMessage(ev.data));
    ws.addEventListener("error", () => this.emit("error", new Error("Gemini Live socket error")));
    ws.addEventListener("close", () => {
      this.connected = false;
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
    if (config?.instructions) {
      setup.systemInstruction = { parts: [{ text: config.instructions }] };
    }
    if (config?.tools?.length) {
      setup.tools = [
        {
          functionDeclarations: config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
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
    let msg: any;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
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

