// ─────────────────────────────────────────────────────────────────────────────
// Gemini Live over WebSocket.
//
// Gemini is the multimodal one: audio, text, images and video frames in;
// audio or text out. It is also the one whose session is the least mutable,
// and that shapes every provider-owned concern here —
//
//   - The setup frame is first-frame-only. Tools and instructions can't be
//     patched, so setTools()/setInstructions() reconnect with the latest
//     resumption handle: Gemini carries the conversation over and takes the
//     new setup. Without a handle the change waits for the next session.
//   - Turns can't be removed, so compact() reconnects WITHOUT a handle and
//     seeds the new session with the summary and the recent turns.
//   - The window is bounded natively by `contextWindowCompression`, on by
//     default: without it an audio session dies at ~15 minutes.
//   - Functions can be NON_BLOCKING: the conversation goes on while they run,
//     and the result says when the model should take it in.
//
// Two traps worth stating plainly. Audio is 16 kHz in and 24 kHz out — both
// formats are declared so the host resamples instead of guessing. And the
// JSON arrives over BINARY frames; see decodeFrame.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  RealtimeAdapter,
  RealtimeAudioFormat,
  RealtimeCapabilities,
  RealtimeCompaction,
  RealtimeCompactionOutcome,
  RealtimeHistoryItem,
  RealtimeInjection,
  RealtimeMedia,
  RealtimeSessionSpec,
  RealtimeToolResult,
  RealtimeToolSpec,
  RealtimeUsage,
} from "../types";
import {
  AdapterBase,
  asError,
  awaitOpen,
  base64ToInt16,
  decodeFrame,
  defaultSocket,
  int16ToBase64,
  mediaBase64,
  OpenCancelled,
  type WebSocketLike,
} from "../wire";

export interface GeminiAutomaticActivityDetection {
  /** `true`: no provider VAD — push-to-talk. */
  disabled?: boolean;
  startOfSpeechSensitivity?: "START_SENSITIVITY_UNSPECIFIED" | "START_SENSITIVITY_HIGH" | "START_SENSITIVITY_LOW";
  /** LOW waits longer before ending the user's turn. */
  endOfSpeechSensitivity?: "END_SENSITIVITY_UNSPECIFIED" | "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW";
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
}

export interface GeminiRealtimeInputConfig {
  automaticActivityDetection?: GeminiAutomaticActivityDetection;
  /** `NO_INTERRUPTION`: the agent always finishes its sentence. */
  activityHandling?: "ACTIVITY_HANDLING_UNSPECIFIED" | "START_OF_ACTIVITY_INTERRUPTS" | "NO_INTERRUPTION";
  turnCoverage?: "TURN_COVERAGE_UNSPECIFIED" | "TURN_INCLUDES_ONLY_ACTIVITY" | "TURN_INCLUDES_ALL_INPUT";
}

export interface GeminiLiveConfig {
  /** API key or ephemeral token. */
  getToken: () => Promise<string> | string;
  /** Default "models/gemini-3.1-flash-live-preview". */
  model?: string;
  voice?: string;
  realtimeInput?: GeminiRealtimeInputConfig;
  /**
   * Native window management, ON by default. `false` accepts the provider's
   * hard session cap instead (~15 minutes of audio).
   */
  contextWindowCompression?: false | { triggerTokens?: number; targetTokens?: number };
  /** Ask for resumption handles. Default true. */
  resumption?: boolean;
  /** Frame resolution for image/video input. */
  mediaResolution?: "MEDIA_RESOLUTION_LOW" | "MEDIA_RESOLUTION_MEDIUM" | "MEDIA_RESOLUTION_HIGH";
  /**
   * Which API version serves the model. Default "v1beta". Model-dependent:
   * the wrong one closes the session with "not found for API version".
   */
  apiVersion?: "v1beta" | "v1alpha" | (string & {});
  /** Override the endpoint (regional, Vertex). Wins over apiVersion. */
  url?: string;
  connectTimeoutMs?: number;
  socketFactory?: (url: string) => WebSocketLike;
}

const IN16: RealtimeAudioFormat = { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" };
const OUT24: RealtimeAudioFormat = { sampleRate: 24_000, channels: 1, encoding: "pcm_s16le" };

/** Every key Gemini's Schema (an OpenAPI 3.0 subset) accepts — an allowlist,
 *  so a new Zod-emitted keyword can't reject the whole setup. */
const SCHEMA_KEYS = new Set([
  "type", "format", "title", "description", "nullable", "enum", "items",
  "properties", "required", "minItems", "maxItems", "minProperties",
  "maxProperties", "minLength", "maxLength", "pattern", "minimum", "maximum",
  "default", "anyOf", "example", "propertyOrdering",
]);

/**
 * Project JSON Schema onto Gemini's Schema. Load-bearing: Gemini rejects the
 * ENTIRE setup over one unknown key (`$schema`, `additionalProperties` —
 * both emitted by `z.toJSONSchema()`), closes the socket, and the call is
 * silent end to end.
 */
export function geminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, geminiSchema(sub)]),
      );
    } else if (key === "items") {
      out.items = geminiSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      // Zod writes `.nullable()` as anyOf [T, {type: "null"}]; Gemini's way
      // to say it is `nullable` on T.
      const isNull = (sub: unknown) => (sub as { type?: unknown } | null)?.type === "null";
      const rest = value.filter((sub) => !isNull(sub));
      if (rest.length !== value.length) out.nullable = true;
      if (rest.length === 1) Object.assign(out, geminiSchema(rest[0]), out.nullable ? { nullable: true } : {});
      else out.anyOf = rest.map((sub) => geminiSchema(sub));
    } else if (key === "type" && Array.isArray(value)) {
      const types = value.filter((t) => t !== "null");
      out.type = types[0] ?? "string";
      if (types.length !== value.length) out.nullable = true;
    } else {
      out[key] = value;
    }
  }
  if ("const" in src && !("enum" in out)) out.enum = [src.const];
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

/** "57s" / "1.5s" / { seconds, nanos } → ms. */
function durationMs(value: unknown): number {
  if (typeof value === "string") {
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  }
  if (value && typeof value === "object") {
    const { seconds, nanos } = value as { seconds?: number | string; nanos?: number };
    return Math.round(Number(seconds ?? 0) * 1000 + Number(nanos ?? 0) / 1e6);
  }
  return 0;
}

type Wire = Record<string, any>;

export class GeminiLiveAdapter extends AdapterBase implements RealtimeAdapter {
  readonly provider = "gemini";
  readonly model: string;
  readonly inputFormat = IN16;
  readonly outputFormat = OUT24;
  readonly capabilities: RealtimeCapabilities;

  private ws: WebSocketLike | null = null;
  private opened = false;
  private expectClose = false;
  private generation = 0;
  private handle: string | undefined;
  private reconfiguring: Promise<void> | null = null;
  private reconfigureQueued = false;
  private cancelOpen: ((error: Error) => void) | null = null;

  // per-turn state
  private speaking = false;
  private responding = false;
  /** After interrupt(): drop the rest of this turn's output. */
  private muted = false;
  private userText = "";
  private agentTranscript = "";
  private agentText = "";
  private turnUsage: RealtimeUsage | undefined;

  constructor(private readonly cfg: GeminiLiveConfig) {
    super();
    const model = cfg.model ?? "models/gemini-3.1-flash-live-preview";
    this.model = model.startsWith("models/") ? model : `models/${model}`;
    const resumption = cfg.resumption !== false;
    this.capabilities = {
      input: ["audio", "text", "image", "video"],
      output: ["audio", "text"],
      tools: { update: resumption ? "reconnect" : "next_session", nonBlocking: true, cancellation: true },
      instructions: { update: resumption ? "reconnect" : "append" },
      context: { silentInjection: true, supersede: false, historySeed: true },
      compaction: { native: cfg.contextWindowCompression !== false, apply: "reconnect", summarize: false },
      resumption,
      transcripts: "turns",
      speechLifecycle: "provider",
    };
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The latest resumption handle, if the provider issued one. */
  get resumeHandle(): string | undefined {
    return this.handle;
  }

  async open(spec: RealtimeSessionSpec): Promise<void> {
    if (this.opened) return;
    const generation = ++this.generation;
    this.spec = { ...spec };
    this.expectClose = false;
    this.resetTurn();
    // The handle a session opens with is the only one that can be current:
    // a fresh (or compacted) session must never resume an older conversation.
    this.handle = spec.resumeHandle;

    // close() while connecting rejects this open at once and the socket never
    // outlives it.
    let cancel!: (error: Error) => void;
    const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
    cancelled.catch(() => {});
    this.cancelOpen = cancel;
    let ws: WebSocketLike | undefined;
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const token = await Promise.race([Promise.resolve(this.cfg.getToken()), cancelled]);
      const version = this.cfg.apiVersion ?? "v1beta";
      const base = this.cfg.url ??
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`;
      const url = `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(token)}`;
      const socket = this.cfg.socketFactory ? this.cfg.socketFactory(url) : defaultSocket(url);
      try { (socket as { binaryType?: string }).binaryType = "arraybuffer"; } catch { /* fakes */ }
      ws = socket;
      this.ws = socket;

      let acknowledge!: () => void;
      let refuse!: (error: Error) => void;
      const accepted = new Promise<void>((resolve, reject) => {
        acknowledge = resolve;
        refuse = reject;
      });

      socket.addEventListener("message", (ev: { data: unknown }) => {
        if (generation !== this.generation) return;
        decodeFrame(ev.data, (text) => {
          if (generation !== this.generation) return;
          let message: Wire;
          try {
            message = JSON.parse(text);
          } catch {
            return;
          }
          if (pending && message.setupComplete !== undefined) {
            pending = false;
            acknowledge();
            return;
          }
          this.onMessage(message);
        });
      });
      socket.addEventListener("close", (ev: { code?: number; reason?: string }) => {
        if (generation !== this.generation) return;
        // Gemini reports a REJECTED SETUP by closing with a reason ("Unknown
        // name \"$schema\" at 'setup.tools[0]…'"). That reason is the only
        // diagnosis the caller will get, so it is always surfaced.
        const reason = `Gemini Live closed (${ev?.code ?? "?"})${ev?.reason ? `: ${ev.reason}` : ""}`;
        if (pending) {
          pending = false;
          refuse(new Error(`${reason} — the session never started; check the setup frame`));
          return;
        }
        this.release(reason);
      });
      socket.addEventListener("error", () => {
        if (generation === this.generation && this.opened) this.fail("Gemini Live socket error");
      });

      const timeoutMs = this.cfg.connectTimeoutMs ?? 15_000;
      await Promise.race([awaitOpen(socket, timeoutMs, "Gemini Live"), cancelled]);
      // Setup MUST be the first frame.
      socket.send(JSON.stringify({ setup: this.buildSetup(this.spec) }));
      await Promise.race([
        accepted,
        cancelled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Gemini Live setup timed out")), timeoutMs);
        }),
      ]);
    } catch (error) {
      pending = false;
      if (generation === this.generation) ++this.generation;
      if (this.ws === ws) this.ws = null;
      try { ws?.close(); } catch { /* already closed */ }
      throw asError(error);
    } finally {
      clearTimeout(timer);
      if (this.cancelOpen === cancel) this.cancelOpen = null;
    }

    this.opened = true;
    const resumed = Boolean(this.spec.resumeHandle);
    if (!resumed && spec.history?.length) this.seed(spec.history);
    this.emit({ type: "session.opened", resumed });
  }

  async close(): Promise<void> {
    if (this.cancelOpen) {
      const cancel = this.cancelOpen;
      this.cancelOpen = null;
      ++this.generation;
      cancel(new OpenCancelled("Gemini Live"));
    }
    if (!this.ws) return;
    this.expectClose = true;
    const ws = this.ws;
    ++this.generation;
    try { ws.close(1000, "closed by client"); } catch { /* already closed */ }
    this.release("closed by client");
  }

  private release(reason?: string): void {
    const wasOpen = this.opened || this.ws !== null;
    const expected = this.expectClose;
    this.ws = null;
    this.opened = false;
    this.expectClose = false;
    this.resetTurn();
    if (wasOpen) this.emit({ type: "session.closed", expected, ...(reason ? { reason } : {}) });
  }

  /**
   * Swap the provider session without reporting a close: the old socket's
   * events are ignored from here on, and the new one announces itself with
   * `session.opened`. If the new one can't open, THAT is reported as a drop
   * so the Glove session's reconnect policy takes over.
   */
  private async swap(spec: RealtimeSessionSpec): Promise<void> {
    const old = this.ws;
    ++this.generation;
    this.ws = null;
    this.opened = false;
    try { old?.close(1000, "reconnecting"); } catch { /* already closed */ }
    try {
      await this.open(spec);
    } catch (error) {
      // close() cancelled it: the session is ending on purpose.
      if (error instanceof OpenCancelled) throw error;
      this.emit({ type: "error", error: asError(error), fatal: false });
      this.emit({ type: "session.closed", expected: false, reason: asError(error).message });
      throw error;
    }
  }

  private buildSetup(spec: RealtimeSessionSpec): Record<string, unknown> {
    const output = spec.output ?? "audio";
    const voice = spec.voice ?? this.cfg.voice;
    const setup: Record<string, unknown> = {
      model: this.model,
      generationConfig: {
        responseModalities: [output === "text" ? "TEXT" : "AUDIO"],
        ...(output === "audio" && voice
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
          : {}),
        ...(this.cfg.mediaResolution ? { mediaResolution: this.cfg.mediaResolution } : {}),
      },
      // Without both, the conversation never exists as text anywhere.
      inputAudioTranscription: {},
      ...(output === "audio" ? { outputAudioTranscription: {} } : {}),
    };
    if (this.cfg.realtimeInput) setup.realtimeInputConfig = this.cfg.realtimeInput;
    if (this.cfg.contextWindowCompression !== false) {
      const cwc = this.cfg.contextWindowCompression;
      setup.contextWindowCompression = {
        slidingWindow: cwc?.targetTokens ? { targetTokens: String(cwc.targetTokens) } : {},
        ...(cwc?.triggerTokens ? { triggerTokens: String(cwc.triggerTokens) } : {}),
      };
    }
    if (this.capabilities.resumption) {
      setup.sessionResumption = spec.resumeHandle ? { handle: spec.resumeHandle } : {};
    }
    if (spec.instructions) setup.systemInstruction = { parts: [{ text: spec.instructions }] };
    if (spec.tools?.length) {
      setup.tools = [{
        functionDeclarations: spec.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: geminiSchema(tool.parameters),
          ...(tool.behavior === "non_blocking" ? { behavior: "NON_BLOCKING" } : {}),
        })),
      }];
    }
    return setup;
  }

  /** Initial history goes in as client content with an open turn, so the
   *  model reads it without answering it. */
  private seed(history: RealtimeHistoryItem[]): void {
    const turns = history.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.role === "system" ? `[context] ${item.text}` : item.text }],
    }));
    this.send({ clientContent: { turns, turnComplete: false } });
  }

  // ── input ─────────────────────────────────────────────────────────────────

  sendAudio(pcm: Int16Array): void {
    if (this.opened) this.send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: int16ToBase64(pcm) } } });
  }

  sendText(text: string, opts?: { respond?: boolean }): void {
    if (!this.opened) return;
    if (opts?.respond === false) this.silent(text);
    // Runtime text turns go through realtimeInput: Gemini 3.1 Live accepts
    // clientContent turns but produces no model turn for them.
    else this.send({ realtimeInput: { text } });
  }

  sendMedia(media: RealtimeMedia): void {
    if (!this.opened) return;
    // Stills and video frames share the realtime video channel.
    this.send({ realtimeInput: { video: { mimeType: media.mimeType, data: mediaBase64(media) } } });
  }

  // ── provider-owned agent concerns ─────────────────────────────────────────

  /** Resolves once the reconnected session is open (or the change is deferred). */
  setTools(tools: RealtimeToolSpec[]): Promise<void> {
    this.spec = { ...this.spec, tools };
    return this.reconfigure("tools");
  }

  setInstructions(instructions: string): Promise<void> {
    this.spec = { ...this.spec, instructions };
    if (this.opened && !this.handle) {
      // No handle to carry the conversation across a new setup: the best
      // left is saying it, with system framing, as context.
      this.silent(`[system] Updated instructions — these replace earlier ones:\n${instructions}`);
      return Promise.resolve();
    }
    return this.reconfigure("instructions");
  }

  /** Coalesce setTools + setInstructions into one reconnect. */
  private reconfigure(what: string): Promise<void> {
    if (!this.opened) return Promise.resolve();
    if (!this.handle) {
      this.fail(`Gemini Live can't change ${what} mid-session without a resumption handle; the change applies to the next session.`);
      return Promise.resolve();
    }
    if (this.reconfigureQueued && this.reconfiguring) return this.reconfiguring;
    this.reconfigureQueued = true;
    const previous = this.reconfiguring ?? Promise.resolve();
    const run = previous.then(() => new Promise<void>((resolve) => queueMicrotask(resolve))).then(async () => {
      this.reconfigureQueued = false;
      if (!this.opened || !this.handle) return;
      await this.swap({ ...this.spec, resumeHandle: this.handle, history: undefined });
    }).catch(() => { /* reported by swap */ }).finally(() => {
      if (this.reconfiguring === run) this.reconfiguring = null;
    });
    this.reconfiguring = run;
    return run;
  }

  inject(injection: RealtimeInjection): void {
    if (!this.opened) return;
    const respond = injection.respond ?? injection.kind === "user";
    const text =
      injection.kind === "instruction" ? `[system] ${injection.text}`
      : injection.kind === "context" ? `[context] ${injection.text}`
      : injection.text;
    if (respond) this.send({ realtimeInput: { text } });
    else this.silent(text);
  }

  /**
   * Silent context: a client-content turn left open. Gemini has no other
   * mid-session primitive for text the model should read but not answer.
   */
  private silent(text: string): void {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } });
  }

  sendToolResult(result: RealtimeToolResult): void {
    if (!this.opened) return;
    const nonBlocking = this.spec.tools?.some((tool) => tool.name === result.name && tool.behavior === "non_blocking");
    const scheduling = nonBlocking
      ? (result.respond === false ? "silent" : result.scheduling ?? "when_idle")
      : undefined;
    this.send({
      toolResponse: {
        functionResponses: [{
          id: result.callId,
          name: result.name,
          response: { output: result.output },
          ...(scheduling ? { scheduling: scheduling.toUpperCase() } : {}),
        }],
      },
    });
  }

  respond(opts?: { instructions?: string }): void {
    if (!this.opened) return;
    // No "respond now" primitive: a text turn is what starts a model turn.
    this.send({ realtimeInput: { text: opts?.instructions ? `[system] ${opts.instructions}` : "[system] Continue the conversation." } });
  }

  interrupt(): void {
    // No cancel on this protocol. An empty completed client turn is what
    // stops the in-flight response; the rest of the current turn is muted in
    // case audio is already on the wire, and the host is told to flush.
    this.send({ clientContent: { turns: [], turnComplete: true } });
    if (this.responding) this.muted = true;
    const wasSpeaking = this.speaking;
    this.speaking = false;
    this.emit({ type: "interrupted" });
    if (wasSpeaking) this.emit({ type: "output.speech_stopped" });
  }

  async compact(request: RealtimeCompaction): Promise<RealtimeCompactionOutcome> {
    if (!this.opened) return "unsupported";
    // A handle would bring the old turns back; compaction needs a session
    // that starts from the summary.
    this.handle = undefined;
    await this.swap({
      ...this.spec,
      resumeHandle: undefined,
      history: [
        { role: "system", text: `Summary of the conversation so far:\n${request.summary}` },
        ...(request.recent ?? []),
      ],
    });
    this.emit({ type: "context.compacted", mode: "reconnected" });
    return "reconnected";
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  private resetTurn(): void {
    this.speaking = false;
    this.responding = false;
    this.muted = false;
    this.userText = "";
    this.agentTranscript = "";
    this.agentText = "";
    this.turnUsage = undefined;
  }

  /** The user's turn is over once the model starts its own. */
  private finishUserTranscript(): void {
    if (!this.userText) return;
    this.emit({ type: "input.transcript", text: this.userText, final: true });
    this.userText = "";
  }

  private startResponse(): void {
    if (this.responding) return;
    this.responding = true;
    this.finishUserTranscript();
    this.emit({ type: "response.started" });
  }

  private endResponse(status: "completed" | "interrupted"): void {
    if (this.speaking) {
      this.speaking = false;
      this.emit({ type: "output.speech_stopped" });
    }
    if (this.agentTranscript) this.emit({ type: "output.transcript", text: this.agentTranscript, final: true });
    if (this.agentText) this.emit({ type: "output.text", text: this.agentText, final: true });
    const usage = this.turnUsage;
    if (this.responding || usage) {
      this.emit({ type: "response.done", status, ...(usage ? { usage } : {}) });
      if (usage) this.emit({ type: "usage", usage });
    }
    this.responding = false;
    this.muted = false;
    this.agentTranscript = "";
    this.agentText = "";
    this.turnUsage = undefined;
  }

  private onMessage(msg: Wire): void {
    // Usage may be repeated across a turn's messages; keep the latest and
    // report it once, at the turn boundary, so nothing is counted twice.
    if (msg.usageMetadata) this.turnUsage = toUsage(msg.usageMetadata);

    if (msg.sessionResumptionUpdate) {
      const { newHandle, resumable } = msg.sessionResumptionUpdate;
      if (resumable !== false && typeof newHandle === "string" && newHandle) {
        this.handle = newHandle;
        this.emit({ type: "session.resumable", handle: newHandle });
      }
    }
    if (msg.goAway) this.emit({ type: "session.going_away", timeLeftMs: durationMs(msg.goAway.timeLeft) });

    if (msg.toolCall?.functionCalls) {
      this.startResponse();
      for (const fc of msg.toolCall.functionCalls) {
        this.emit({
          type: "tool.call",
          callId: String(fc.id ?? fc.name),
          name: String(fc.name),
          arguments: JSON.stringify(fc.args ?? {}),
        });
      }
    }
    if (Array.isArray(msg.toolCallCancellation?.ids)) {
      this.emit({ type: "tool.cancelled", callIds: msg.toolCallCancellation.ids.map(String) });
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) {
      const text = String(sc.inputTranscription.text);
      this.userText += text;
      this.emit({ type: "input.transcript", text, final: false });
    }
    if (sc.inputTranscription?.finished) this.finishUserTranscript();

    if (sc.outputTranscription?.text && !this.muted) {
      this.startResponse();
      const text = String(sc.outputTranscription.text);
      this.agentTranscript += text;
      this.emit({ type: "output.transcript", text, final: false });
    }

    for (const part of sc.modelTurn?.parts ?? []) {
      if (this.muted) break;
      if (part.inlineData?.data) {
        this.startResponse();
        if (!this.speaking) {
          this.speaking = true;
          this.emit({ type: "output.speech_started" });
        }
        this.emit({ type: "output.audio", pcm: base64ToInt16(String(part.inlineData.data)), format: OUT24 });
      } else if (typeof part.text === "string" && !part.thought) {
        this.startResponse();
        this.agentText += part.text;
        this.emit({ type: "output.text", text: part.text, final: false });
      }
    }

    if (sc.interrupted) {
      const wasMuted = this.muted;
      this.speaking = false;
      // interrupt() already told the host; the provider echoing it doesn't
      // need a second flush.
      if (!wasMuted) this.emit({ type: "interrupted" });
      this.endResponse("interrupted");
    }
    if (sc.turnComplete) this.endResponse("completed");
  }
}

function toUsage(raw: Wire): RealtimeUsage {
  const byModality = (details: unknown) => {
    const out: Record<string, number> = {};
    if (!Array.isArray(details)) return out;
    for (const entry of details) {
      const modality = String(entry?.modality ?? "").toLowerCase();
      if (modality) out[modality] = (out[modality] ?? 0) + Number(entry?.tokenCount ?? 0);
    }
    return out;
  };
  const tokensIn = Number(raw.promptTokenCount ?? 0);
  const tokensOut = Number(raw.responseTokenCount ?? raw.candidatesTokenCount ?? 0);
  return {
    tokensIn,
    tokensOut,
    ...(raw.cachedContentTokenCount != null ? { cachedTokensIn: Number(raw.cachedContentTokenCount) } : {}),
    byModality: { in: byModality(raw.promptTokensDetails), out: byModality(raw.responseTokensDetails) },
    contextTokens: Number(raw.totalTokenCount ?? tokensIn + tokensOut),
  };
}
