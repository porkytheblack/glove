import EventEmitter from "eventemitter3";
import type { S2SAdapter, S2SEvents, S2SSessionConfig } from "./types";

export interface OpenAIRealtimeConfig {
  /**
   * Fetch an EPHEMERAL client secret from YOUR server (never ship the real
   * API key to the browser). Your server calls
   * POST https://api.openai.com/v1/realtime/client_secrets — see
   * `createOpenAIRealtimeToken` in `glove-voice-s2s/server`.
   */
  getToken: () => Promise<string>;
  /** Realtime model (default "gpt-realtime"). */
  model?: string;
  /** Where to POST the WebRTC SDP offer (default the GA calls endpoint). */
  sdpUrl?: string;
  /**
   * Reuse an existing <audio> element for the agent's voice; one is created
   * (and appended to <body>) otherwise.
   */
  audioElement?: HTMLAudioElement;
}

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * OpenAI Realtime (gpt-realtime) over WebRTC.
 *
 * The provider owns the hard parts the cascaded pipeline reimplements
 * client-side: echo handling, voice activity detection, SEMANTIC turn
 * detection (the model decides from listening whether you're done), and
 * barge-in cancellation. The browser's job reduces to: mic track in, audio
 * track out, and a JSON data channel for tools + text injection.
 *
 * Auth follows the glove-voice pattern: the browser only ever holds a
 * short-lived token minted by your server.
 */
export class OpenAIRealtimeAdapter extends EventEmitter<S2SEvents> implements S2SAdapter {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private ownsAudioEl = false;
  private connected = false;
  private agentTranscript = "";
  private readonly model: string;
  private readonly sdpUrl: string;

  constructor(private readonly cfg: OpenAIRealtimeConfig) {
    super();
    this.model = cfg.model ?? "gpt-realtime";
    this.sdpUrl = cfg.sdpUrl ?? "https://api.openai.com/v1/realtime/calls";
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(config?: S2SSessionConfig): Promise<void> {
    const token = await this.cfg.getToken();

    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Agent audio out.
    this.audioEl = this.cfg.audioElement ?? document.createElement("audio");
    if (!this.cfg.audioElement) {
      this.ownsAudioEl = true;
      this.audioEl.style.display = "none";
      document.body.appendChild(this.audioEl);
    }
    this.audioEl.autoplay = true;
    pc.ontrack = (ev) => {
      if (this.audioEl) this.audioEl.srcObject = ev.streams[0];
    };

    // Mic in.
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    for (const track of this.mic.getTracks()) pc.addTrack(track, this.mic);

    // Event side-channel.
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (ev) => {
      try {
        this.handleEvent(JSON.parse(ev.data as string) as RealtimeEvent);
      } catch {
        /* non-JSON frame */
      }
    };
    dc.onopen = () => {
      this.connected = true;
      if (config) this.updateSession(config);
      this.emit("connected");
    };
    dc.onclose = () => {
      if (this.connected) {
        this.connected = false;
        this.emit("disconnected");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(`${this.sdpUrl}?model=${encodeURIComponent(this.model)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      await this.disconnect();
      throw new Error(`Realtime SDP exchange failed (${res.status}): ${detail}`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      this.dc?.close();
    } catch {
      /* already closed */
    }
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    if (this.ownsAudioEl && this.audioEl) this.audioEl.remove();
    this.pc = null;
    this.dc = null;
    this.mic = null;
    this.audioEl = null;
    this.emit("disconnected");
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
    const session: Record<string, unknown> = { type: "realtime" };
    if (patch.instructions !== undefined) session.instructions = patch.instructions;
    if (patch.tools !== undefined) {
      session.tools = patch.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }
    if (patch.voice !== undefined) {
      session.audio = { output: { voice: patch.voice } };
    }
    this.send({ type: "session.update", session });
  }

  interrupt(): void {
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private send(event: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private handleEvent(e: RealtimeEvent): void {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        this.emit("user_speech_started");
        break;
      case "input_audio_buffer.speech_stopped":
        this.emit("user_speech_stopped");
        break;

      case "conversation.item.input_audio_transcription.delta":
        this.emit("user_transcript", String(e.delta ?? ""), false);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit("user_transcript", String(e.transcript ?? ""), true);
        break;

      // GA name first, beta name second — same payload shape.
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

      // WebRTC-only lifecycle events for the remote audio buffer.
      case "output_audio_buffer.started":
        this.emit("agent_speech_started");
        break;
      case "output_audio_buffer.stopped":
        this.emit("agent_speech_stopped");
        break;
      case "output_audio_buffer.cleared":
        this.emit("interrupted");
        this.emit("agent_speech_stopped");
        break;

      case "response.function_call_arguments.done":
        this.emit("tool_call", {
          callId: String(e.call_id ?? ""),
          name: String(e.name ?? ""),
          arguments: String(e.arguments ?? "{}"),
        });
        break;

      case "error": {
        const err = (e.error ?? {}) as { message?: string };
        this.emit("error", new Error(err.message ?? "Realtime error"));
        break;
      }
      default:
        break;
    }
  }
}
