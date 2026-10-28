// ─────────────────────────────────────────────────────────────────────────────
// The realtime adapter contract.
//
// glove-voice-s2s draws the line at the MODEL: the adapter moves audio and
// surfaces tool calls, and everything an agent is made of — which tools
// exist, what the model is told between turns, what happens when the context
// fills up — is improvised on top of a voice pipe.
//
// That line is in the wrong place for realtime models, because those
// concerns live on the provider's side of the socket. Gemini decides what a
// function declaration may contain, can't change tools mid-session without a
// reconnect, and compresses its own window. OpenAI Realtime keeps a mutable
// conversation you can delete items from and can generate a response that
// never enters it. GPT-Live has no history at all, only appends. Any one
// strategy for "inject this context" or "compact now" is wrong for two of
// the three.
//
// So the adapter here owns everything the provider owns:
//
//   - tool REGISTRATION   setTools()      — schema projection, mid-session
//                                           update or reconnect
//   - synthetic PROMPTS   inject()        — silent context, steering,
//                                           superseding earlier snapshots
//   - COMPACTION          compact()       — in place, by reconnecting with a
//                                           seed, or not at all
//                         summarize()     — the model summarising itself,
//                                           where the provider allows it
//   - MODALITIES          sendAudio/Text/Media, audio or text out
//
// and reports everything through one standardized event stream
// (RealtimeEvent), so the Glove side (RealtimeSession) never branches on the
// provider. Glove keeps what is Glove's: executing tools through the
// Executor, the store, permissions, runtime context, the inbox, subscribers,
// and the lifecycle of the session itself — reconnects, resumption, history
// restore, and WHEN to compact.
// ─────────────────────────────────────────────────────────────────────────────

/** PCM on the wire. Every realtime provider today is mono signed 16-bit LE. */
export interface RealtimeAudioFormat {
  sampleRate: number;
  channels: 1;
  encoding: "pcm_s16le";
}

export type RealtimeInputModality = "audio" | "text" | "image" | "video";
export type RealtimeOutputModality = "audio" | "text";

/**
 * What an adapter can do, declared rather than discovered. The session reads
 * this to pick a strategy (seed history or resume, compact in place or not at
 * all) and a host reads it to refuse a mismatch at startup — a camera feed
 * wired to a provider without video input should fail before the first call,
 * not be silently dropped during it.
 */
export interface RealtimeCapabilities {
  input: ReadonlyArray<RealtimeInputModality>;
  /** Response modalities this provider can produce. One is chosen per session. */
  output: ReadonlyArray<RealtimeOutputModality>;
  tools: {
    /** How a tool change reaches a live session: patched in place, by a
     *  transparent reconnect, or only on the next session. */
    update: "live" | "reconnect" | "next_session";
    /** Tools may run in the background while the conversation continues. */
    nonBlocking: boolean;
    /** The provider can cancel a pending call (`tool.cancelled`). */
    cancellation: boolean;
  };
  instructions: {
    /** `replace` swaps the system prompt; `append` can only add to it. */
    update: "replace" | "append" | "reconnect";
  };
  context: {
    /** Text can enter the conversation without triggering a response. */
    silentInjection: boolean;
    /** An injection with a `key` removes the previous one with that key. */
    supersede: boolean;
    /** The session can be opened with earlier turns (`spec.history`). */
    historySeed: boolean;
  };
  compaction: {
    /** The provider keeps the window bounded itself (sliding window,
     *  truncation). Sessions without Glove-driven compaction rely on it. */
    native: boolean;
    /** How `compact()` applies a summary. `none` means it can't. */
    apply: "in_place" | "reconnect" | "none";
    /** `summarize()` is available: the model summarises its own context. */
    summarize: boolean;
  };
  /** The provider issues resumption handles (`session.resumable`). */
  resumption: boolean;
  /** `turns`: utterances end with a final transcript. `continuous`:
   *  timestamped fragments with no semantic turn boundary. */
  transcripts: "turns" | "continuous";
  /** `host`: the provider can't report when audio finished playing; the host
   *  calls `notifyPlayback`. */
  speechLifecycle: "provider" | "host";
}

/** A tool as the provider sees it. Adapters project `parameters` to whatever
 *  schema dialect the provider accepts. */
export interface RealtimeToolSpec {
  name: string;
  description: string;
  /** JSON Schema. */
  parameters: Record<string, unknown>;
  /**
   * `non_blocking` lets the conversation continue while the tool runs, where
   * the provider supports it (Gemini). Elsewhere it is treated as blocking.
   */
  behavior?: "blocking" | "non_blocking";
}

/** A prior turn, used to seed a fresh provider session. */
export interface RealtimeHistoryItem {
  role: "user" | "assistant" | "system";
  text: string;
}

export interface RealtimeSessionSpec {
  instructions?: string;
  tools?: RealtimeToolSpec[];
  /** Response modality. Default: audio when the provider can produce it. */
  output?: RealtimeOutputModality;
  /** Provider voice name. Fixed for the session on every provider. */
  voice?: string;
  /** Earlier turns to seed the session with. Ignored when resuming. */
  history?: RealtimeHistoryItem[];
  /** A provider resumption handle from `session.resumable`. */
  resumeHandle?: string;
}

/**
 * A synthetic prompt: text that enters the conversation without a person
 * saying it.
 *
 * - `context` — state the model should know but not react to (runtime
 *   snapshots, resolved inbox items). Silent unless `respond` is set.
 * - `instruction` — framework steering ("the caller's playback was cut,
 *   don't resume the sentence"). Carries system authority where the provider
 *   has a system role.
 * - `user` — text in the user's voice: a typed message, a relayed delegation
 *   result the model should speak about.
 */
export interface RealtimeInjection {
  kind: "context" | "instruction" | "user";
  text: string;
  /** Ask the model to respond to it. Default false for context/instruction,
   *  true for user. */
  respond?: boolean;
  /**
   * Supersede the previous injection with the same key, where the provider
   * can remove items (`capabilities.context.supersede`). Elsewhere the new
   * text is appended and should say that it supersedes the old.
   */
  key?: string;
}

/** An image, or one frame of a video stream. */
export interface RealtimeMedia {
  kind: "image" | "video";
  /** e.g. image/jpeg, image/png. Video is sent as a stream of image frames. */
  mimeType: string;
  /** Base64, or raw bytes. */
  data: string | Uint8Array;
}

export interface RealtimeToolResult {
  callId: string;
  name: string;
  /** Already stripped of client-only fields (renderData, summary). */
  output: unknown;
  /** Ask the model to continue speaking after the result. Default true. */
  respond?: boolean;
  /**
   * For non-blocking calls: when the model should take the result in.
   * `interrupt` — now, cutting off speech; `when_idle` — after the current
   * utterance (default); `silent` — absorb it without speaking.
   */
  scheduling?: "interrupt" | "when_idle" | "silent";
}

export interface RealtimeCompaction {
  /** What the conversation so far amounted to. */
  summary: string;
  /** The most recent turns, kept verbatim after the summary. */
  recent?: RealtimeHistoryItem[];
}

export type RealtimeCompactionOutcome = "in_place" | "reconnected" | "unsupported";

/** Token / duration accounting for one response or one usage update. */
export interface RealtimeUsage {
  /** Input tokens this response consumed — the whole context it read. */
  tokensIn: number;
  tokensOut: number;
  /** Input tokens served from the provider's cache. */
  cachedTokensIn?: number;
  /** The provider's per-modality breakdown, where reported. */
  byModality?: {
    in?: Partial<Record<"text" | "audio" | "image" | "video", number>>;
    out?: Partial<Record<"text" | "audio", number>>;
  };
  /** Size of the provider-side context after this response, when known.
   *  This is what Glove-driven compaction is triggered on. */
  contextTokens?: number;
  /** Session duration billing (GPT-Live): cumulative seconds. */
  seconds?: number;
  /** True once the provider has finalised the session's usage. */
  final?: boolean;
}

/**
 * The standardized event stream. Every adapter reports through exactly these
 * shapes, so nothing on the Glove side switches on the provider.
 */
export type RealtimeEvent =
  /** The provider accepted the session setup. */
  | { type: "session.opened"; resumed: boolean }
  /**
   * The provider session ended. `expected` is true after `close()`; anything
   * else is a drop the session may recover from.
   */
  | { type: "session.closed"; expected: boolean; reason?: string }
  /** The provider will end the connection soon (Gemini's goAway). */
  | { type: "session.going_away"; timeLeftMs: number }
  /** A fresh resumption handle — store it to resume after a drop. */
  | { type: "session.resumable"; handle: string }
  | { type: "input.speech_started" }
  | { type: "input.speech_stopped" }
  /** What the user said. `final: false` deltas, then one `final: true`
   *  (turn-based providers). Continuous providers only send deltas. */
  | { type: "input.transcript"; text: string; final: boolean }
  /** Agent speech, transport mode: the host plays this. */
  | { type: "output.audio"; pcm: Int16Array; format: RealtimeAudioFormat }
  | { type: "output.speech_started" }
  | { type: "output.speech_stopped" }
  /** Transcript of the agent's audio: deltas, then the full utterance. */
  | { type: "output.transcript"; text: string; final: boolean }
  /** Text-modality output: deltas, then the full text. */
  | { type: "output.text"; text: string; final: boolean }
  | { type: "response.started"; responseId?: string }
  | {
      type: "response.done";
      responseId?: string;
      status: "completed" | "cancelled" | "interrupted" | "failed" | "incomplete";
      usage?: RealtimeUsage;
    }
  | { type: "tool.call"; callId: string; name: string; arguments: string }
  /** The provider no longer wants these results (the user moved on). */
  | { type: "tool.cancelled"; callIds: string[] }
  /** The agent was cut off. Flush any queued playback. */
  | { type: "interrupted" }
  | { type: "usage"; usage: RealtimeUsage }
  /** Continuous providers: a timestamped transcript fragment. */
  | { type: "transcript.fragment"; role: "user" | "assistant"; text: string; startMs: number; endMs: number }
  | { type: "context.compacted"; mode: "in_place" | "reconnected" }
  | { type: "error"; error: Error; fatal: boolean };

export type RealtimeEventType = RealtimeEvent["type"];
export type RealtimeEventOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>;
export type RealtimeListener = (event: RealtimeEvent) => void;

/**
 * One provider session, owning the provider-side half of an agent.
 *
 * Adapters are transport-mode: the host feeds `sendAudio` and plays
 * `output.audio`. Nothing here opens a microphone — that is the only mode a
 * server room, a phone bridge or a LiveKit agent can use.
 */
export interface RealtimeAdapter {
  /** "openai", "openai-live", "gemini" — for logs and HUDs. */
  readonly provider: string;
  readonly model: string;
  readonly capabilities: RealtimeCapabilities;
  readonly inputFormat: RealtimeAudioFormat;
  readonly outputFormat: RealtimeAudioFormat;
  readonly isOpen: boolean;

  /** Subscribe to the event stream. Returns the unsubscribe function. */
  subscribe(listener: RealtimeListener): () => void;

  /** Open a provider session. Resolves once the provider accepted the setup. */
  open(spec: RealtimeSessionSpec): Promise<void>;
  /** End the session. Emits `session.closed` with `expected: true`. */
  close(): Promise<void>;

  // ── input ─────────────────────────────────────────────────────────────────
  sendAudio(pcm: Int16Array): void;
  /** A typed user turn. Default `respond: true`. */
  sendText(text: string, opts?: { respond?: boolean }): void;
  /** An image, or a video frame. Throws when the modality is unsupported. */
  sendMedia(media: RealtimeMedia): void;

  // ── provider-owned agent concerns ─────────────────────────────────────────
  setTools(tools: RealtimeToolSpec[]): void;
  setInstructions(instructions: string): void;
  inject(injection: RealtimeInjection): void;
  sendToolResult(result: RealtimeToolResult): void;
  /** Ask the model to speak now (after silent injections, a greeting). */
  respond(opts?: { instructions?: string }): void;
  /** Stop the agent's current output. MUST emit `interrupted`. */
  interrupt(): void;

  /** Apply a summary in place of the conversation so far. */
  compact(request: RealtimeCompaction): Promise<RealtimeCompactionOutcome>;
  /**
   * Have the model summarise its own context without that summary entering
   * the conversation. Only where `capabilities.compaction.summarize`.
   */
  summarize?(instructions: string): Promise<string>;

  /** `speechLifecycle: "host"`: report real playback state. */
  notifyPlayback?(speaking: boolean): void;
}
