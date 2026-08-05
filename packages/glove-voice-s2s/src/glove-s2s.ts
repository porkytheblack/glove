// ─────────────────────────────────────────────────────────────────────────────
// GloveS2S — a speech-to-speech session driven by a Glove agent.
//
// `GloveVoice` wraps a Glove with a cascade (VAD → STT → LLM → TTS) and the
// Glove is the intelligence. `GloveS2S` wraps a Glove with a REALTIME MODEL
// and the intelligence splits: the realtime model owns everything that has
// to be instant — persona, turn-taking, barge-in, the voice — and the Glove
// owns everything that has to be right — tools, permissions, memory, the
// agent loop.
//
// The wiring between the two is a `S2SToolHost`, so building a realtime
// agent is the same three moves as building a text one:
//
//   const glove = new Glove({...}).fold(lookupHull).build(store);
//   const s2s = new GloveS2S({ adapter, tools: gloveToolHost(glove) });
//   await s2s.start();
//
// Everything that made the hand-wired version tedious — declaring tool
// schemas twice, dispatching `tool_call` by hand, serializing agent runs,
// measuring voice-to-voice, keeping the spoken conversation out of the
// agent's history — is handled here.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { Message, StoreAdapter } from "glove-core/core";
import type { IGloveRunnable } from "glove-core/glove";
import type { S2SAdapter, S2SSessionConfig, S2STool } from "./types";
import type { S2SToolHost } from "./tool-host";

/**
 * Coarse session state, derived from the provider's own speech events —
 * there is no client-side endpointing here to disagree with.
 */
export type S2SState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "speaking";

export type GloveS2SEvents = {
  /** Session state changed — drive your UI off this. */
  state: [state: S2SState];
  connected: [];
  disconnected: [];
  user_speech_started: [];
  user_speech_stopped: [];
  user_transcript: [text: string, isFinal: boolean];
  agent_transcript_delta: [text: string];
  agent_transcript_done: [text: string];
  agent_speech_started: [];
  agent_speech_stopped: [];
  interrupted: [];
  /** A tool call started running on the host. */
  tool_start: [call: { callId: string; name: string; input: unknown }];
  /** A tool call finished — `ok: false` means the model got an error result. */
  tool_end: [call: { callId: string; name: string; ok: boolean; ms: number; output: unknown }];
  /**
   * True voice-to-voice for the turn: the user going quiet → the agent
   * becoming audible. The number the cascade can't reach.
   */
  voice_to_voice: [ms: number];
  error: [err: Error];
};

/** Somewhere to mirror the spoken conversation. A Glove works directly. */
export type TranscriptSink = StoreAdapter | IGloveRunnable;

export interface GloveS2SConfig {
  /** The provider session — `OpenAIRealtimeAdapter`, or any `S2SAdapter`. */
  adapter: S2SAdapter;
  /**
   * Where this session's tool calls run. Omit for a voice-only agent with
   * no tools.
   */
  tools?: S2SToolHost;
  /**
   * Persona / system prompt. Usually baked into the token server-side (the
   * client can't then escalate its own prompt); set it here only when you
   * mean to change it from the client.
   */
  instructions?: string;
  /** Output voice id, when overriding what the token was minted with. */
  voice?: string;
  /**
   * Push tool declarations into the session on connect. On by default —
   * turn it off when the token already baked in the same list and you want
   * to skip the round trip.
   */
  publishTools?: boolean;
  /**
   * Mirror the spoken conversation into a store as ordinary messages, so
   * the text side of the system can read what was said out loud. Pass the
   * worker Glove itself to give it the conversation it's being asked about.
   */
  mirrorTo?: TranscriptSink;
  /**
   * Fail a tool call that runs longer than this (ms) so the model gets an
   * answer it can speak instead of waiting on a dead promise. Off by default.
   */
  toolTimeoutMs?: number;
}

function storeOf(sink: TranscriptSink): StoreAdapter {
  return "store" in sink ? sink.store : sink;
}

/**
 * A realtime voice session backed by a Glove agent.
 *
 * @example Agent tools, straight through
 * ```ts
 * const s2s = new GloveS2S({
 *   adapter: new OpenAIRealtimeAdapter({ getToken }),
 *   tools: gloveToolHost(glove),
 * });
 * s2s.on("state", setStatus);
 * await s2s.start();
 * ```
 *
 * @example Layered — realtime front, heavy worker behind one tool
 * ```ts
 * const s2s = new GloveS2S({
 *   adapter: new OpenAIRealtimeAdapter({ getToken }),
 *   tools: httpToolHost({ endpoint: "/api/s2s/tools" }), // delegateToolHost(worker) server-side
 *   mirrorTo: sessionStore,
 * });
 * ```
 */
export class GloveS2S extends EventEmitter<GloveS2SEvents> {
  private readonly adapter: S2SAdapter;
  private readonly cfg: GloveS2SConfig;
  private _state: S2SState = "idle";
  private _lastVoiceToVoiceMs: number | null = null;
  private userStoppedAt = 0;
  private inflight = new Map<string, AbortController>();
  private started = false;

  constructor(config: GloveS2SConfig) {
    super();
    this.cfg = config;
    this.adapter = config.adapter;
    this.wire();
  }

  get state(): S2SState {
    return this._state;
  }

  get isConnected(): boolean {
    return this.adapter.isConnected;
  }

  /** Voice-to-voice for the most recent turn, in ms. */
  get lastVoiceToVoiceMs(): number | null {
    return this._lastVoiceToVoiceMs;
  }

  /** The underlying provider adapter, for provider-specific escapes. */
  get session(): S2SAdapter {
    return this.adapter;
  }

  /**
   * Open the session: mic capture, provider connection, tool publication.
   * Idempotent while connected.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.setState("connecting");

    const sessionConfig: S2SSessionConfig = {};
    if (this.cfg.instructions !== undefined) sessionConfig.instructions = this.cfg.instructions;
    if (this.cfg.voice !== undefined) sessionConfig.voice = this.cfg.voice;

    try {
      await this.adapter.connect(sessionConfig);
    } catch (err) {
      this.started = false;
      this.setState("idle");
      throw err;
    }

    if (this.cfg.tools && this.cfg.publishTools !== false) {
      // Non-fatal: a session with a stale tool list is still a working
      // session, and the model will simply not call what it can't see.
      try {
        await this.publishTools();
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** Close the session and release the mic. Cancels in-flight tool calls. */
  async stop(): Promise<void> {
    this.started = false;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    await this.adapter.disconnect();
    this.setState("idle");
  }

  /** Re-read the host's declarations and push them into the live session. */
  async publishTools(): Promise<S2STool[]> {
    if (!this.cfg.tools) return [];
    const tools = await this.cfg.tools.listTools();
    this.adapter.updateSession({ tools });
    return tools;
  }

  /**
   * Inject out-of-band text and ask the agent to speak in reaction — the
   * wakeup path for anything that finishes AFTER the turn that asked for it
   * (a slow worker, a webhook, a background job).
   */
  relay(text: string, opts?: { role?: "user" | "system" }): void {
    this.adapter.injectText(text, { respond: true, role: opts?.role ?? "user" });
  }

  /**
   * Inject text the agent should KNOW but not answer — an overheard typed
   * message, a transcript correction, a state change on the page.
   */
  observe(text: string, opts?: { role?: "user" | "system" }): void {
    this.adapter.injectText(text, { respond: false, role: opts?.role ?? "system" });
  }

  /** Change persona / voice mid-call. */
  update(patch: Partial<S2SSessionConfig>): void {
    this.adapter.updateSession(patch);
  }

  /** Cut the agent off mid-sentence (manual barge-in). */
  interrupt(): void {
    this.adapter.interrupt();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private setState(state: S2SState) {
    if (this._state === state) return;
    this._state = state;
    this.emit("state", state);
  }

  private wire() {
    const a = this.adapter;

    a.on("connected", () => {
      this.setState("listening");
      this.emit("connected");
    });
    a.on("disconnected", () => {
      this.started = false;
      this.setState("idle");
      this.emit("disconnected");
    });
    a.on("error", (err) => this.emit("error", err));

    a.on("user_speech_started", () => {
      this.setState("user_speaking");
      this.emit("user_speech_started");
    });
    a.on("user_speech_stopped", () => {
      this.userStoppedAt = Date.now();
      this.setState("thinking");
      this.emit("user_speech_stopped");
    });
    a.on("user_transcript", (text, isFinal) => {
      this.emit("user_transcript", text, isFinal);
      if (isFinal && text.trim()) void this.mirror("user", text.trim());
    });

    a.on("agent_transcript_delta", (text) => this.emit("agent_transcript_delta", text));
    a.on("agent_transcript_done", (text) => {
      this.emit("agent_transcript_done", text);
      if (text.trim()) void this.mirror("agent", text.trim());
    });

    a.on("agent_speech_started", () => {
      if (this.userStoppedAt) {
        const ms = Date.now() - this.userStoppedAt;
        this.userStoppedAt = 0;
        this._lastVoiceToVoiceMs = ms;
        this.emit("voice_to_voice", ms);
      }
      this.setState("speaking");
      this.emit("agent_speech_started");
    });
    a.on("agent_speech_stopped", () => {
      this.setState("listening");
      this.emit("agent_speech_stopped");
    });
    a.on("interrupted", () => {
      this.userStoppedAt = 0;
      this.emit("interrupted");
    });

    a.on("tool_call", (call) => void this.handleToolCall(call));
  }

  private async handleToolCall(call: { callId: string; name: string; arguments: string }) {
    const { callId, name } = call;

    let input: unknown = {};
    try {
      input = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      this.adapter.sendToolResult(callId, {
        error: `Could not parse the arguments for "${name}". Try the call again with valid JSON.`,
      });
      return;
    }

    if (!this.cfg.tools) {
      this.adapter.sendToolResult(callId, {
        error: `This session has no tool host, so "${name}" cannot run.`,
      });
      return;
    }

    const controller = new AbortController();
    this.inflight.set(callId, controller);
    const timeout = this.cfg.toolTimeoutMs
      ? setTimeout(() => controller.abort(), this.cfg.toolTimeoutMs)
      : null;

    this.emit("tool_start", { callId, name, input });
    const t0 = Date.now();

    try {
      const output = await this.cfg.tools.callTool(name, input, { signal: controller.signal });
      this.adapter.sendToolResult(callId, output);
      this.emit("tool_end", { callId, name, ok: true, ms: Date.now() - t0, output });
    } catch (err) {
      // The model is holding the turn open waiting on this call — an error
      // result it can speak about beats a promise that never settles.
      const message =
        controller.signal.aborted && this.cfg.toolTimeoutMs
          ? `The "${name}" call timed out after ${this.cfg.toolTimeoutMs}ms.`
          : ((err as Error)?.message ?? `The "${name}" call failed.`);
      const output = { error: `${message} Level with the user — do not invent a result.` };
      this.adapter.sendToolResult(callId, output);
      this.emit("tool_end", { callId, name, ok: false, ms: Date.now() - t0, output });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.inflight.delete(callId);
    }
  }

  private async mirror(sender: Message["sender"], text: string) {
    if (!this.cfg.mirrorTo) return;
    try {
      await storeOf(this.cfg.mirrorTo).appendMessages([{ sender, text }]);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
}
