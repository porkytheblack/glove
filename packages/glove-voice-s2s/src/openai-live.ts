import { EventEmitter } from "eventemitter3";
import type { WebSocketLike } from "./gemini-live";
import { base64ToInt16, int16ToBase64 } from "./pcm";
import type { S2SAdapter, S2SAudioFormat, S2SEvents, S2SSessionConfig, S2STool } from "./types";

export interface OpenAILiveConfig {
  /** Project API key. This is a SERVER transport, not an ephemeral browser connection. */
  getToken: () => Promise<string> | string;
  model?: string;
  voice?: string;
  sampleRate?: 16000 | 24000;
  /** Short voice/persona prompt. The Glove session prompt also configures the backend. */
  instructions?: string;
  /** Live uses this Responses model to select Glove tools. Default: gpt-5.6-luna. */
  backendModel?: string;
  /** Override the backend prompt; defaults to the Glove session instructions. */
  backendInstructions?: string;
  parallelToolCalls?: boolean;
  url?: string;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
  /** Auth headers require ws (loaded lazily), or a supplied server socket. */
  socketFactory?: (url: string, headers: Record<string, string>) => WebSocketLike | Promise<WebSocketLike>;
}

type WireEvent = { type?: string; [key: string]: unknown };
type ToolCall = { callId: string; name: string; arguments: string };
type Batch = {
  id: string;
  calls: Map<string, ToolCall>;
  results: Set<string>;
  completed: boolean;
  continued: boolean;
  respond: boolean;
};

/**
 * GPT-Live over the primary server WebSocket. Responses delegation adapts
 * Live's two-model architecture to Glove's existing tool_call contract.
 * No Realtime commits, response.cancel, or synthetic turn-ending timers.
 * https://developers.openai.com/api/docs/guides/live-delegation
 */
export class OpenAILiveAdapter extends EventEmitter<S2SEvents> implements S2SAdapter {
  readonly mode = "transport" as const;
  readonly capabilities = { transcripts: "continuous", speechLifecycle: "host" } as const;
  readonly inputFormat: S2SAudioFormat;
  private ws: WebSocketLike | null = null;
  private connected = false;
  private closing = false;
  private connecting: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private generation = 0;
  private rejectStart?: (error: Error) => void;
  private finishClose?: (error?: Error) => void;
  private active = new Map<string, Batch>();
  private calls = new Map<string, Batch>();
  private outputMuted = false;
  private playbackSpeaking = false;
  private sessionConfig: S2SSessionConfig = {};

  constructor(private readonly cfg: OpenAILiveConfig) {
    super();
    if (cfg.sampleRate !== undefined && cfg.sampleRate !== 16000 && cfg.sampleRate !== 24000) {
      throw new Error("GPT-Live PCM sampleRate must be 16000 or 24000");
    }
    this.inputFormat = { sampleRate: cfg.sampleRate ?? 24000, channels: 1, encoding: "pcm_s16le" };
  }

  get isConnected(): boolean { return this.connected && !this.closing; }

  connect(config: S2SSessionConfig = {}): Promise<void> {
    if (this.closing) return Promise.reject(new Error("GPT-Live session is closing"));
    if (this.connecting) return this.connecting;
    if (this.connected) return Promise.resolve();
    const generation = ++this.generation;
    this.sessionConfig = config;
    this.outputMuted = false;
    this.active.clear();
    this.calls.clear();
    const connection = this.open(config, generation);
    this.connecting = connection;
    void connection.finally(() => {
      if (this.connecting === connection) this.connecting = null;
    }).catch(() => {});
    return connection;
  }

  private async open(config: S2SSessionConfig, generation: number): Promise<void> {
    if (typeof window !== "undefined") throw new Error("OpenAILiveAdapter requires a trusted server; relay browser audio through your server or LiveKit");
    const token = await this.cfg.getToken();
    if (generation !== this.generation) throw new Error("GPT-Live connection cancelled");
    const url = this.cfg.url ?? "wss://api.openai.com/v1/live/sessions";
    const headers = { Authorization: `Bearer ${token}` };
    const ws = this.cfg.socketFactory
      ? await this.cfg.socketFactory(url, headers)
      : new (await import("ws")).default(url, { headers }) as unknown as WebSocketLike;
    if (generation !== this.generation) {
      ws.close();
      throw new Error("GPT-Live connection cancelled");
    }
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      let started = false;
      let failed = false;
      const timer = setTimeout(() => fail(new Error("GPT-Live session startup timed out")), this.cfg.connectTimeoutMs ?? 15000);
      const fail = (error: Error) => {
        if (started || failed) return;
        failed = true;
        clearTimeout(timer);
        this.rejectStart = undefined;
        if (this.ws === ws) this.ws = null;
        reject(error);
        ws.close();
      };
      this.rejectStart = fail;
      ws.addEventListener("open", () => {
        if (this.ws !== ws) return;
        try {
          this.send({ type: "session.start", session: this.startConfig(config) });
        } catch (error) { fail(asError(error)); }
      });
      ws.addEventListener("message", (event: { data: unknown }) => {
        if (this.ws !== ws) return;
        let message: WireEvent;
        try {
          message = JSON.parse(String(event.data)) as WireEvent;
          if (!message || typeof message !== "object") throw new Error("Invalid event");
        }
        catch { this.emit("error", new Error("Invalid GPT-Live JSON event")); return; }
        if (message.type === "session.started" && !started) {
          started = true;
          clearTimeout(timer);
          this.rejectStart = undefined;
          this.connected = true;
          resolve();
          this.emit("connected");
        } else if (!started && message.type === "error") {
          fail(providerError(message));
        } else if (!started && message.type === "session.closed") {
          fail(new Error("GPT-Live session closed during startup"));
        } else {
          this.handleEvent(message);
        }
      });
      ws.addEventListener("error", () => {
        const error = new Error("GPT-Live socket error");
        if (!started) fail(error);
        else if (this.ws === ws) this.emit("error", error);
      });
      ws.addEventListener("close", () => {
        if (!started) fail(new Error("GPT-Live socket closed before session.started"));
        if (this.ws !== ws) return;
        this.finishClose?.(new Error("GPT-Live closed without session.closed; final usage is unconfirmed"));
        this.release();
      });
    });
  }

  private startConfig(config: S2SSessionConfig): Record<string, unknown> {
    return {
      model: this.cfg.model ?? "gpt-live-1",
      instructions: this.cfg.instructions ?? config.instructions ??
        "Speak naturally and briefly. Delegate requests requiring tools or reasoning to the backend. Do not invent results.",
      audio: { format: { type: "audio/pcm", rate: this.inputFormat.sampleRate }, output: { voice: config.voice ?? this.cfg.voice ?? "marin" } },
      delegation: { type: "responses", responses: {
        model: this.cfg.backendModel ?? "gpt-5.6-luna",
        instructions: this.cfg.backendInstructions ?? config.instructions ?? "Use the available tools and return concise, verified results for the spoken conversation.",
        tools: this.toolDefinitions(config.tools ?? []),
        parallel_tool_calls: this.cfg.parallelToolCalls ?? false,
      } },
    };
  }

  private toolDefinitions(tools: S2STool[]): Record<string, unknown>[] {
    return tools.map(tool => ({ type: "function", ...tool, strict: false }));
  }

  disconnect(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (!this.connected) {
      ++this.generation;
      this.rejectStart?.(new Error("GPT-Live connection cancelled"));
      this.release();
      return Promise.resolve();
    }
    this.closing = true;
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishClose?.(new Error("GPT-Live finalization timed out; final usage is unconfirmed"));
        this.release();
      }, this.cfg.closeTimeoutMs ?? 15000);
      this.finishClose = error => {
        clearTimeout(timer);
        this.finishClose = undefined;
        if (error) reject(error); else resolve();
      };
      try { this.send({ type: "session.close" }); }
      catch (error) { this.finishClose(asError(error)); this.release(); }
    });
    this.closePromise = completion;
    void completion.finally(() => { this.closePromise = null; }).catch(() => {});
    return completion;
  }

  private release(): void {
    const wasConnected = this.connected;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    this.closing = false;
    this.active.clear();
    this.calls.clear();
    this.notifyPlaybackState(false);
    ws?.close();
    if (wasConnected) this.emit("disconnected");
  }

  /** Host must supply continuous, realtime-paced PCM, including silence. */
  sendAudio(pcm: Int16Array): void {
    if (this.isConnected) this.send({ type: "session.input_audio.append", audio: int16ToBase64(pcm) });
  }

  injectText(text: string, opts?: { respond?: boolean; role?: "user" | "system" }): void {
    if (!this.isConnected) return;
    this.append(opts?.role === "system" ? "instructions" : opts?.respond ? "commentary" : "thinking", text);
  }

  /** Conservative byte-sized chunks stay below Live's 500-token append cap,
   * including non-Latin text. Keep the full result in the Glove backend. */
  private append(kind: "instructions" | "thinking" | "commentary", content: string): void {
    for (const chunk of splitContext(content)) {
      this.send({ type: `session.${kind}.append`, event_id: crypto.randomUUID(), delegation_id: null, content: chunk });
    }
  }

  updateSession(patch: Partial<S2SSessionConfig>): void {
    if (!this.isConnected) return;
    if (patch.voice !== undefined && patch.voice !== (this.sessionConfig.voice ?? this.cfg.voice ?? "marin")) {
      throw new Error("GPT-Live voice is fixed at startup; start a new session to change it");
    }
    const responses: Record<string, unknown> = {};
    if (patch.tools !== undefined) responses.tools = this.toolDefinitions(patch.tools);
    if (patch.instructions !== undefined) {
      if (!this.cfg.instructions) this.append("instructions", patch.instructions);
      if (!this.cfg.backendInstructions) responses.instructions = patch.instructions;
    }
    if (Object.keys(responses).length) this.send({ type: "session.update", session: { delegation: { type: "responses", responses } } });
    this.sessionConfig = { ...this.sessionConfig, ...patch };
  }

  sendToolResult(callId: string, output: unknown, opts?: { respond?: boolean }): void {
    if (!this.isConnected) return;
    const batch = this.calls.get(callId);
    if (!batch) {
      this.emit("error", new Error(`GPT-Live has no pending tool call ${callId}`));
      return;
    }
    if (batch.results.has(callId)) return;
    this.send({ type: "response.item.create", event_id: crypto.randomUUID(), item: {
      type: "function_call_output", call_id: callId,
      output: typeof output === "string" ? output : JSON.stringify(output) ?? "null",
    } });
    batch.results.add(callId);
    batch.respond ||= opts?.respond !== false;
    if (batch.completed && !batch.continued && batch.respond && batch.results.size === batch.calls.size) {
      batch.continued = true;
      this.send({ type: "response.create", event_id: crypto.randomUUID() });
    }
  }

  /** Hard stop means dropping subsequent output as well as clearing queued
   * audio. The host explicitly calls resumeOutput() after its recovery policy.
   * This never cancels tool execution or mistakes a backchannel for barge-in. */
  interrupt(): void {
    this.outputMuted = true;
    this.emit("interrupted");
    this.notifyPlaybackState(false);
    if (this.isConnected) this.append("instructions", "Your audio playback was stopped. Stop speaking and listen. Do not resume the interrupted sentence.");
  }

  resumeOutput(): void {
    this.emit("interrupted"); // discard stale host audio before unmuting
    this.outputMuted = false;
  }

  /** Continuous providers have no audio-done event. Call from real playback
   * state to drive shared speaking indicators and avatar utterance boundaries. */
  notifyPlaybackState(speaking: boolean): void {
    if (speaking === this.playbackSpeaking) return;
    this.playbackSpeaking = speaking;
    this.emit(speaking ? "agent_speech_started" : "agent_speech_stopped");
  }

  private send(event: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1) throw new Error("GPT-Live socket is not open");
    this.ws.send(JSON.stringify(event));
  }

  private handleEvent(event: WireEvent): void {
    switch (event.type) {
      case "session.output_audio.delta":
        if (!this.closing && !this.outputMuted && typeof event.delta === "string") {
          this.emit("audio", base64ToInt16(event.delta), this.inputFormat);
        }
        break;
      case "session.input_transcript.delta":
      case "session.output_transcript.delta": {
        if (typeof event.delta !== "string" || typeof event.start_ms !== "number" || typeof event.end_ms !== "number") break;
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        this.emit("transcript", { role, delta: event.delta, startMs: event.start_ms, endMs: event.end_ms });
        if (role === "user") this.emit("user_transcript", event.delta, false);
        else this.emit("agent_transcript_delta", event.delta);
        break;
      }
      case "response.event":
        if (this.isConnected) this.handleResponse(event);
        break;
      case "session.usage.updated":
      case "session.closed": {
        const seconds = (event.usage as { seconds?: unknown } | undefined)?.seconds;
        if (typeof seconds === "number") this.emit("usage", { seconds, final: event.type === "session.closed" });
        if (event.type === "session.closed") {
          this.finishClose?.();
          this.release();
        }
        break;
      }
      case "error": this.emit("error", providerError(event)); break;
    }
  }

  private handleResponse(envelope: WireEvent): void {
    const event = envelope.event as WireEvent | undefined;
    if (!event || typeof envelope.delegation_id !== "string") return;
    const delegation = envelope.delegation_id;
    const response = event.response as { id?: string; error?: { message?: string } } | undefined;
    if (event.type === "response.created" && response?.id) {
      const prior = this.active.get(delegation);
      if (prior?.id === response.id) return;
      if (prior) for (const callId of prior.calls.keys()) this.calls.delete(callId);
      this.active.set(delegation, { id: response.id, calls: new Map(), results: new Set(), completed: false, continued: false, respond: false });
      return;
    }
    const batch = this.active.get(delegation);
    if (!batch) return;
    if (event.type === "response.output_item.done" && !batch.completed) {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type !== "function_call" || typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") return;
      batch.calls.set(item.call_id, { callId: item.call_id, name: item.name, arguments: item.arguments });
    } else if (event.type === "response.completed" && response?.id === batch.id && !batch.completed) {
      batch.completed = true;
      // Register ALL calls before dispatch: tools may return synchronously.
      for (const call of batch.calls.values()) this.calls.set(call.callId, batch);
      for (const call of batch.calls.values()) this.emit("tool_call", call);
    } else if ((event.type === "response.failed" || event.type === "response.incomplete" || event.type === "response.cancelled") && response?.id === batch.id) {
      for (const call of batch.calls.values()) this.calls.delete(call.callId);
      this.active.delete(delegation);
      this.emit("error", new Error(response.error?.message ?? `GPT-Live backend ${event.type}`));
    }
  }
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
function providerError(event: WireEvent): Error {
  const detail = event.error as { message?: string } | undefined;
  return new Error(detail?.message ?? "GPT-Live provider error");
}

function splitContext(text: string): string[] {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > 500) { chunks.push(chunk); chunk = ""; bytes = 0; }
    chunk += char;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
