// ─────────────────────────────────────────────────────────────────────────────
// GPT-Live over the server WebSocket (/v1/live/sessions).
//
// Live is two models: a voice model that listens and speaks continuously, and
// a Responses backend it delegates to. Glove's tools register on the BACKEND
// (`delegation.responses.tools`), and its function calls surface here as
// ordinary `tool.call` events — so the Glove side runs them exactly as it
// does for every other provider.
//
// What the provider owns, and so this adapter declares:
//   - no conversation to edit or seed: context enters as appends (thinking
//     for silent state, commentary for things to say, instructions for
//     steering), each capped at ~500 tokens, so long text is chunked;
//   - context is provider-managed, so compact() is unsupported;
//   - transcripts are continuous fragments, not turns, and the provider can't
//     tell when playback ends — the host reports it via notifyPlayback().
// https://developers.openai.com/api/docs/guides/live-delegation
// ─────────────────────────────────────────────────────────────────────────────

import type {
  RealtimeAdapter,
  RealtimeAudioFormat,
  RealtimeCapabilities,
  RealtimeCompactionOutcome,
  RealtimeInjection,
  RealtimeMedia,
  RealtimeSessionSpec,
  RealtimeToolResult,
  RealtimeToolSpec,
} from "../types";
import { AdapterBase, asError, base64ToInt16, int16ToBase64, OpenCancelled, renderHistory, type WebSocketLike } from "../wire";

export interface OpenAILiveConfig {
  /** Project API key. Server-only: this transport sends an Authorization header. */
  getToken: () => Promise<string> | string;
  /** Default "gpt-live-1". */
  model?: string;
  voice?: string;
  sampleRate?: 16000 | 24000;
  /** A short voice prompt. Default: the session instructions. */
  voiceInstructions?: string;
  /** The Responses model that selects tools. Default gpt-5.6-luna. */
  backendModel?: string;
  /** Override the backend prompt. Default: the session instructions. */
  backendInstructions?: string;
  parallelToolCalls?: boolean;
  url?: string;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
  /** Supply the socket (proxies, tests). Default: `ws`, loaded lazily. */
  socketFactory?: (url: string, headers: Record<string, string>) => WebSocketLike | Promise<WebSocketLike>;
}

type Wire = { type?: string; [key: string]: unknown };
type Call = { callId: string; name: string; arguments: string };
type Batch = { id: string; calls: Map<string, Call>; results: Set<string>; completed: boolean; continued: boolean; respond: boolean };

export class OpenAILiveAdapter extends AdapterBase implements RealtimeAdapter {
  readonly provider = "openai-live";
  readonly model: string;
  readonly inputFormat: RealtimeAudioFormat;
  readonly outputFormat: RealtimeAudioFormat;
  readonly capabilities: RealtimeCapabilities = {
    input: ["audio", "text"],
    output: ["audio"],
    tools: { update: "live", nonBlocking: false, cancellation: false },
    instructions: { update: "append" },
    context: { silentInjection: true, supersede: false, historySeed: true },
    compaction: { native: true, apply: "none", summarize: false },
    resumption: false,
    transcripts: "continuous",
    speechLifecycle: "host",
  };

  private ws: WebSocketLike | null = null;
  private opened = false;
  private closing: Promise<void> | null = null;
  private finishClose?: (error?: Error) => void;
  private expectClose = false;
  private generation = 0;
  private cancelOpen: ((error: Error) => void) | null = null;
  private active = new Map<string, Batch>();
  private calls = new Map<string, Batch>();
  private muted = false;
  private playing = false;
  private typedResponse = false;
  private responseRequested = false;

  constructor(private readonly cfg: OpenAILiveConfig) {
    super();
    if (cfg.sampleRate !== undefined && cfg.sampleRate !== 16000 && cfg.sampleRate !== 24000) {
      throw new Error("GPT-Live PCM sampleRate must be 16000 or 24000");
    }
    this.model = cfg.model ?? "gpt-live-1";
    this.inputFormat = { sampleRate: cfg.sampleRate ?? 24_000, channels: 1, encoding: "pcm_s16le" };
    this.outputFormat = this.inputFormat;
  }

  get isOpen(): boolean {
    return this.opened && !this.closing;
  }

  async open(spec: RealtimeSessionSpec): Promise<void> {
    if (this.opened) return;
    if (typeof window !== "undefined") {
      throw new Error("OpenAILiveAdapter needs a trusted server: relay browser audio through your server or LiveKit");
    }
    const generation = ++this.generation;
    this.spec = { ...spec };
    this.expectClose = false;
    this.muted = false;
    this.active.clear();
    this.calls.clear();
    this.typedResponse = false;
    this.responseRequested = false;

    const token = await this.cfg.getToken();
    const url = this.cfg.url ?? "wss://api.openai.com/v1/live/sessions";
    const headers = { Authorization: `Bearer ${token}` };
    const ws = this.cfg.socketFactory
      ? await this.cfg.socketFactory(url, headers)
      : (new (await import("ws")).default(url, { headers }) as unknown as WebSocketLike);
    if (generation !== this.generation) {
      ws.close();
      throw new OpenCancelled("GPT-Live");
    }
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      let started = false;
      let failed = false;
      const fail = (error: Error) => {
        if (started || failed) return;
        failed = true;
        clearTimeout(timer);
        if (this.cancelOpen === fail) this.cancelOpen = null;
        if (this.ws === ws) this.ws = null;
        ++this.generation;
        reject(error);
        try { ws.close(); } catch { /* already closed */ }
      };
      const timer = setTimeout(() => fail(new Error("GPT-Live session startup timed out")), this.cfg.connectTimeoutMs ?? 15_000);
      // close() while starting rejects at once rather than at the timeout.
      this.cancelOpen = fail;
      const start = () => {
        if (generation !== this.generation) return;
        try {
          if (!this.send({ type: "session.start", session: this.startConfig(this.spec) })) fail(new Error("GPT-Live socket is not open"));
        } catch (error) { fail(asError(error)); }
      };
      // A supplied socket may already be open by the time the factory resolves.
      if (ws.readyState === 1) queueMicrotask(start);
      else ws.addEventListener("open", start);
      ws.addEventListener("message", (event: { data: unknown }) => {
        if (generation !== this.generation) return;
        let message: Wire;
        try {
          message = JSON.parse(String(event.data)) as Wire;
          if (!message || typeof message !== "object") throw new Error("not an object");
        } catch {
          this.fail("Invalid GPT-Live JSON event");
          return;
        }
        if (!started && message.type === "session.started") {
          started = true;
          clearTimeout(timer);
          this.cancelOpen = null;
          this.opened = true;
          resolve();
        } else if (!started && message.type === "error") {
          fail(providerError(message));
        } else if (!started && message.type === "session.closed") {
          fail(new Error("GPT-Live session closed during startup"));
        } else {
          this.handle(message);
        }
      });
      ws.addEventListener("error", () => {
        if (generation !== this.generation) return;
        if (!started) fail(new Error("GPT-Live socket error"));
        else this.fail("GPT-Live socket error");
      });
      ws.addEventListener("close", () => {
        if (generation !== this.generation) return;
        if (!started) return fail(new Error("GPT-Live socket closed before session.started"));
        this.finishClose?.(new Error("GPT-Live closed without session.closed; final usage is unconfirmed"));
        this.release("socket closed");
      });
    });

    // No conversation to seed: earlier turns enter as silent context.
    if (spec.history?.length) this.append("thinking", `Earlier in this conversation:\n${renderHistory(spec.history)}`);
    this.emit({ type: "session.opened", resumed: false });
  }

  private startConfig(spec: RealtimeSessionSpec): Record<string, unknown> {
    return {
      model: this.model,
      instructions: this.cfg.voiceInstructions ?? spec.instructions ??
        "Speak naturally and briefly. Delegate requests requiring tools or reasoning to the backend. Do not invent results.",
      audio: {
        format: { type: "audio/pcm", rate: this.inputFormat.sampleRate },
        output: { voice: spec.voice ?? this.cfg.voice ?? "marin" },
      },
      delegation: {
        type: "responses",
        responses: {
          model: this.cfg.backendModel ?? "gpt-5.6-luna",
          instructions: this.cfg.backendInstructions ?? spec.instructions ??
            "Use the available tools and return concise, verified results for the spoken conversation.",
          tools: toolDefinitions(spec.tools ?? []),
          parallel_tool_calls: this.cfg.parallelToolCalls ?? false,
        },
      },
    };
  }

  /** Waits for `session.closed`, which carries the final usage. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (!this.opened) {
      // Still starting: cancel it. It never opened, so nothing is reported closed.
      const cancel = this.cancelOpen;
      this.cancelOpen = null;
      ++this.generation;
      cancel?.(new OpenCancelled("GPT-Live"));
      this.ws = null;
      return Promise.resolve();
    }
    this.expectClose = true;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishClose?.(new Error("GPT-Live finalization timed out; final usage is unconfirmed"));
        this.release("finalization timed out");
      }, this.cfg.closeTimeoutMs ?? 15_000);
      this.finishClose = (error) => {
        clearTimeout(timer);
        this.finishClose = undefined;
        if (error) reject(error);
        else resolve();
      };
      if (!this.send({ type: "session.close" })) {
        this.finishClose(new Error("GPT-Live socket is not open; final usage is unconfirmed"));
        this.release("close failed");
      }
    });
    this.closing = done;
    void done.finally(() => { this.closing = null; }).catch(() => {});
    return done;
  }

  private release(reason?: string): void {
    const wasOpen = this.opened || this.ws !== null;
    const expected = this.expectClose;
    const ws = this.ws;
    this.ws = null;
    this.opened = false;
    this.expectClose = false;
    this.active.clear();
    this.calls.clear();
    this.notifyPlayback(false);
    try { ws?.close(); } catch { /* already closed */ }
    if (wasOpen) this.emit({ type: "session.closed", expected, ...(reason ? { reason } : {}) });
  }

  // ── input ─────────────────────────────────────────────────────────────────

  /** Continuous, realtime-paced PCM — silence included. */
  sendAudio(pcm: Int16Array): void {
    if (this.isOpen) this.post({ type: "session.input_audio.append", audio: int16ToBase64(pcm) });
  }

  sendText(text: string, opts?: { respond?: boolean }): void {
    if (!this.isOpen) return;
    if (!this.post({
      type: "response.item.create", event_id: crypto.randomUUID(),
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    })) return;
    // The voice frontend also needs the user's answer while the backend works.
    // This is silent context; commentary is reserved for material to speak.
    this.append("thinking", `The user typed: ${text}`);
    this.typedResponse ||= opts?.respond !== false;
    this.continueBackend();
  }

  sendMedia(_media: RealtimeMedia): void {
    throw new Error("GPT-Live takes audio and text only; use Gemini Live or OpenAI Realtime for images and video.");
  }

  // ── provider-owned agent concerns ─────────────────────────────────────────

  setTools(tools: RealtimeToolSpec[]): void {
    this.spec = { ...this.spec, tools };
    if (this.isOpen) {
      this.post({ type: "session.update", session: { delegation: { type: "responses", responses: { tools: toolDefinitions(tools) } } } });
    }
  }

  setInstructions(instructions: string): void {
    this.spec = { ...this.spec, instructions };
    if (!this.isOpen) return;
    if (!this.cfg.voiceInstructions) this.append("instructions", instructions);
    if (!this.cfg.backendInstructions) {
      this.post({ type: "session.update", session: { delegation: { type: "responses", responses: { instructions } } } });
    }
  }

  inject(injection: RealtimeInjection): void {
    if (!this.isOpen) return;
    const respond = injection.respond ?? injection.kind === "user";
    const kind = injection.kind === "instruction" ? "instructions" : respond ? "commentary" : "thinking";
    this.append(kind, injection.text);
  }

  sendToolResult(result: RealtimeToolResult): void {
    if (!this.isOpen) return;
    const batch = this.calls.get(result.callId);
    if (!batch) {
      this.fail(`GPT-Live has no pending tool call ${result.callId}`);
      return;
    }
    if (batch.results.has(result.callId)) return;
    const sent = this.post({
      type: "response.item.create",
      event_id: crypto.randomUUID(),
      item: {
        type: "function_call_output",
        call_id: result.callId,
        output: typeof result.output === "string" ? result.output : (JSON.stringify(result.output) ?? "null"),
      },
    });
    if (!sent) return;
    batch.results.add(result.callId);
    batch.respond ||= result.respond !== false;
    // The backend continues once, after EVERY call in its batch has a result.
    this.continueBackend();
  }

  /** Typed messages queue behind running work and all outstanding tool results. */
  private continueBackend(): void {
    if (this.responseRequested || !this.isOpen) return;
    const batches = [...this.active.values()];
    if (batches.some(batch => !batch.completed || batch.continued || batch.results.size < batch.calls.size)) return;
    if (!this.typedResponse && !batches.some(batch => batch.respond)) return;
    if (this.post({ type: "response.create", event_id: crypto.randomUUID() })) {
      this.responseRequested = true;
      this.typedResponse = false;
      for (const batch of batches) batch.continued = true;
    }
  }

  respond(opts?: { instructions?: string }): void {
    // Commentary is what the voice model speaks from; there is no bare
    // "respond now" event.
    if (this.isOpen) this.append("commentary", opts?.instructions ?? "Respond to the user now.");
  }

  /** Drops further output until the user speaks again or resumeOutput(). */
  interrupt(): void {
    this.muted = true;
    this.emit({ type: "interrupted" });
    this.notifyPlayback(false);
    if (this.isOpen) this.append("instructions", "Your audio playback was stopped. Stop speaking and listen. Do not resume the interrupted sentence.");
  }

  resumeOutput(): void {
    this.muted = false;
  }

  async compact(): Promise<RealtimeCompactionOutcome> {
    return "unsupported";
  }

  notifyPlayback(speaking: boolean): void {
    if (speaking === this.playing) return;
    this.playing = speaking;
    this.emit({ type: speaking ? "output.speech_started" : "output.speech_stopped" });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** False when the socket isn't open (it may be closing before its close event). */
  private send(event: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(event));
    return true;
  }

  /** Public-method sends: a closed socket is reported, never thrown at the caller. */
  private post(event: Record<string, unknown>): boolean {
    const sent = this.send(event);
    if (!sent) this.fail(`GPT-Live socket is not open; ${String(event.type)} was not sent`);
    return sent;
  }

  /** Appends are capped near 500 tokens; byte-sized chunks stay under it for any script. */
  private append(kind: "instructions" | "thinking" | "commentary", content: string): void {
    for (const chunk of splitContext(content)) {
      if (!this.post({ type: `session.${kind}.append`, event_id: crypto.randomUUID(), delegation_id: null, content: chunk })) return;
    }
  }

  private handle(event: Wire): void {
    switch (event.type) {
      case "session.output_audio.delta":
        if (!this.expectClose && !this.muted && typeof event.delta === "string") {
          this.emit({ type: "output.audio", pcm: base64ToInt16(event.delta), format: this.outputFormat });
        }
        break;
      case "session.input_transcript.delta":
      case "session.output_transcript.delta": {
        if (typeof event.delta !== "string" || typeof event.start_ms !== "number" || typeof event.end_ms !== "number") break;
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        // Speech dropped after interrupt() was never heard: not a fragment of the conversation.
        if (role === "assistant" && this.muted) break;
        this.emit({ type: "transcript.fragment", role, text: event.delta, startMs: event.start_ms, endMs: event.end_ms });
        if (role === "user") {
          // The user is talking again: whatever comes next answers them.
          this.muted = false;
          this.emit({ type: "input.transcript", text: event.delta, final: false });
        } else {
          this.emit({ type: "output.transcript", text: event.delta, final: false });
        }
        break;
      }
      case "response.event":
        if (this.isOpen) this.onDelegation(event);
        break;
      case "session.usage.updated":
      case "session.closed": {
        const seconds = (event.usage as { seconds?: unknown } | undefined)?.seconds;
        if (typeof seconds === "number") {
          this.emit({ type: "usage", usage: { tokensIn: 0, tokensOut: 0, seconds, final: event.type === "session.closed" } });
        }
        if (event.type === "session.closed") {
          this.finishClose?.();
          this.release();
        }
        break;
      }
      case "error":
        this.emit({ type: "error", error: providerError(event), fatal: false });
        break;
    }
  }

  private onDelegation(envelope: Wire): void {
    const event = envelope.event as Wire | undefined;
    if (!event || typeof envelope.delegation_id !== "string") return;
    const delegation = envelope.delegation_id;
    const response = event.response as { id?: string; error?: { message?: string } } | undefined;
    if (event.type === "response.created" && response?.id) {
      this.responseRequested = false;
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
      // Register every call before dispatching any: tools may answer synchronously.
      for (const call of batch.calls.values()) this.calls.set(call.callId, batch);
      for (const call of batch.calls.values()) this.emit({ type: "tool.call", ...call });
      if (!batch.calls.size) this.active.delete(delegation);
      this.continueBackend();
    } else if (
      (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "response.cancelled") &&
      response?.id === batch.id
    ) {
      for (const call of batch.calls.values()) this.calls.delete(call.callId);
      this.active.delete(delegation);
      this.responseRequested = false;
      this.typedResponse = false;
      this.fail(response.error?.message ?? `GPT-Live backend ${event.type}`);
    }
  }
}

function toolDefinitions(tools: RealtimeToolSpec[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}

function providerError(event: Wire): Error {
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
    if (bytes + size > 500) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
