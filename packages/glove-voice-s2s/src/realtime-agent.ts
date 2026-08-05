// ─────────────────────────────────────────────────────────────────────────────
// RealtimeAgent — running a Glove agent on a speech-to-speech model.
//
// WHY THIS IS A WRAPPER AND NOT A ModelAdapter.
//
// Every other model in glove-core is a function: messages in, messages out,
// and Glove owns the loop — it decides when to call a tool, when to retry,
// when the turn is over. A realtime model cannot be plugged in there, because
// it owns that loop itself. It listens continuously, decides on its own when
// the user stopped talking, emits tool calls mid-utterance, and keeps the
// conversation state on the provider's side. Dressing that up as a
// `ModelAdapter` would be a lie about who is driving, and the seams would
// show the first time a tool call arrived while Glove thought it was idle.
//
// So the loop stays with the provider and the AUTHORING stays with Glove. You
// declare tools, prompt, permissions and store exactly as you always do; this
// class reads that declaration, configures the session with it, and executes
// each tool call back through the same `Tool.run` the cascaded pipeline uses.
// One definition, two runtimes — which is the whole point, because the
// alternative is maintaining a parallel set of hand-written JSON schemas that
// drift from the real tools.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import {
  getToolJsonSchema,
  type IGloveRunnable,
  type ModelAdapter,
  type Tool,
  type ToolResultData,
} from "glove-core";
import { createS2SAdapter, type CreateS2SAdapterArgs } from "./create-adapter";
import type { S2SAdapter, S2SEvents, S2SSessionConfig, S2STool } from "./types";

/**
 * A `ModelAdapter` that CARRIES its S2S configuration, so the agent
 * definition is the single place realtime behaviour is declared.
 */
export interface S2SDrivenModel extends ModelAdapter {
  /** The realtime configuration — `RealtimeAgent` derives the provider
   *  session from this when no explicit `adapter` is passed. */
  s2s: CreateS2SAdapterArgs;
}

/**
 * The model slot for agents whose turns are driven by an S2S provider.
 *
 * A Glove needs a ModelAdapter to build, but a RealtimeAgent-driven agent
 * never runs Glove's own loop — the realtime model IS the model. Two forms:
 *
 * ```ts
 * // placeholder only — you construct/pass the adapter yourself
 * model: s2sDrivenModel("s2s-front")
 *
 * // carry the FULL realtime config on the agent definition — provider,
 * // model, voice, turn-taking, all typed — and RealtimeAgent derives the
 * // adapter from it: new RealtimeAgent({ agent }) with no `adapter`.
 * model: s2sDrivenModel({
 *   label: "s2s-front",
 *   provider: "openai",
 *   voice: "marin",
 *   turnDetection: { type: "semantic_vad", eagerness: "low" },
 * })
 * ```
 *
 * Either way it fails loudly (naming the agent) if anything ever runs
 * `processRequest`, and swapping in a real `createAdapter(...)` to serve
 * TEXT turns from the same agent definition stays a one-line change.
 */
export function s2sDrivenModel(label?: string): ModelAdapter;
export function s2sDrivenModel(config: CreateS2SAdapterArgs & { label?: string }): S2SDrivenModel;
export function s2sDrivenModel(
  arg: string | (CreateS2SAdapterArgs & { label?: string }) = "s2s-driven",
): ModelAdapter | S2SDrivenModel {
  const label = typeof arg === "string" ? arg : (arg.label ?? "s2s-driven");
  const base: ModelAdapter = {
    name: label,
    async prompt(): Promise<never> {
      throw new Error(
        `This agent's turns are driven by an S2S provider through RealtimeAgent — ` +
          `the "${label}" ModelAdapter is a placeholder. Wire a real adapter ` +
          `(createAdapter(...) from glove-core) to serve text turns from the same agent.`,
      );
    },
    setSystemPrompt() {
      /* the realtime session carries the prompt */
    },
  };
  if (typeof arg === "string") return base;
  const { label: _l, ...s2s } = arg;
  return { ...base, s2s };
}

/** Does this agent's model slot carry realtime configuration? */
export function isS2SDrivenModel(model: ModelAdapter): model is S2SDrivenModel {
  const s2s = (model as Partial<S2SDrivenModel>).s2s;
  return typeof s2s === "object" && s2s !== null;
}

export interface RealtimeAgentConfig {
  /** A built Glove. Its prompt and tools configure the session. */
  agent: IGloveRunnable;
  /**
   * The provider session. Optional when the agent was built with
   * `model: s2sDrivenModel({ provider, ... })` — the adapter is then derived
   * from the config carried on the agent's model slot. An explicit adapter
   * always wins.
   */
  adapter?: S2SAdapter;
  /** Provider-specific voice id. */
  voice?: string;
  /**
   * Override the instructions sent to the voice model. Defaults to the
   * agent's system prompt — but a prompt written for a text agent often wants
   * adjusting for speech (no markdown, shorter turns), and this is the seam
   * for that without forking the agent.
   */
  instructions?: string;
  /**
   * Tools to withhold from the voice model, by name.
   *
   * Not every tool belongs in a spoken conversation. A tool that renders UI,
   * or takes thirty seconds, is worse than useless mid-utterance: the model
   * calls it and the room goes silent. Withheld tools stay available to the
   * same agent's text turns.
   *
   * Two kinds of tool should almost always be listed here:
   * - Tools with `requiresPermission` — the voice path executes `Tool.run`
   *   directly, without the Executor, so there is no permission prompt. A
   *   gated tool called from a voice turn runs UNGATED.
   * - Tools that call `display.pushAndWait` — the voice path passes no
   *   `handOver`, so a blocking display call throws instead of rendering.
   */
  excludeTools?: string[];
  /** Notified when a tool call starts and finishes — for HUDs and metrics. */
  onToolCall?: (name: string, phase: "start" | "done" | "error", detail?: unknown) => void;
}

export type RealtimeAgentEvents = {
  /** Final transcript of a user utterance. */
  user_said: [text: string];
  /** Final transcript of an agent utterance. */
  agent_said: [text: string];
  /** Streaming agent transcript, for live captions. */
  agent_delta: [text: string];
  tool_started: [name: string, input: unknown];
  tool_finished: [name: string, output: unknown];
  error: [Error];
};

export class RealtimeAgent extends EventEmitter<RealtimeAgentEvents> {
  private readonly agent: IGloveRunnable;
  /** The provider session, exposed so a transport-mode host can subscribe to
   *  `audio` / speech events without keeping a second reference around. */
  readonly adapter: S2SAdapter;
  private readonly excluded: Set<string>;
  private started = false;
  /** Listeners THIS class attached, so stop() removes only its own — a host's
   *  `audio` / `interrupted` listeners on the adapter must survive a stop. */
  private readonly bound: Array<[keyof S2SEvents, (...args: never[]) => void]> = [];

  constructor(private readonly cfg: RealtimeAgentConfig) {
    super();
    this.agent = cfg.agent;
    if (cfg.adapter) {
      this.adapter = cfg.adapter;
    } else if (cfg.agent.model && isS2SDrivenModel(cfg.agent.model)) {
      this.adapter = createS2SAdapter(cfg.agent.model.s2s);
    } else {
      throw new Error(
        "RealtimeAgent needs a provider session: pass `adapter`, or build the agent with " +
          "model: s2sDrivenModel({ provider, ... }) so the adapter can be derived from it.",
      );
    }
    this.excluded = new Set(cfg.excludeTools ?? []);
  }

  get isConnected(): boolean {
    return this.adapter.isConnected;
  }

  /** The adapter's audio contract, so a host can wire capture correctly. */
  get mode(): "device" | "transport" {
    return this.adapter.mode;
  }

  /**
   * The tools this agent will expose to the voice model, as the provider sees
   * them. Exposed for assertion in tests and for HUDs — a voice agent silently
   * missing a tool is hard to notice from the outside.
   */
  get exposedTools(): S2STool[] {
    return this.agent.tools
      .filter((t) => !this.excluded.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: getToolJsonSchema(t),
      }));
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.listen("tool_call", (call) => void this.runTool(call));
    this.listen("user_transcript", (text, isFinal) => {
      if (isFinal && text) this.emit("user_said", text);
    });
    this.listen("agent_transcript_delta", (text) => this.emit("agent_delta", text));
    this.listen("agent_transcript_done", (text) => {
      if (text) this.emit("agent_said", text);
    });
    this.listen("error", (err) => this.emit("error", err));

    const config: S2SSessionConfig = {
      instructions: this.cfg.instructions ?? this.agent.getSystemPrompt(),
      voice: this.cfg.voice,
      tools: this.exposedTools,
    };
    await this.adapter.connect(config);
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const [event, fn] of this.bound) this.adapter.off(event, fn as never);
    this.bound.length = 0;
    await this.adapter.disconnect();
  }

  private listen<E extends keyof S2SEvents>(
    event: E,
    fn: (...args: S2SEvents[E]) => void,
  ): void {
    this.adapter.on(event, fn as never);
    this.bound.push([event, fn as (...args: never[]) => void]);
  }

  /** Feed microphone PCM. `transport` mode only. */
  sendAudio(pcm: Int16Array): void {
    this.adapter.sendAudio(pcm);
  }

  /**
   * Push text into the live conversation.
   *
   * `respond: true` asks the model to say something about it — the path an
   * async result takes when it finally lands and the caller is owed an answer.
   * `respond: false` is silent context: a correction, an overheard line, a
   * fact that should inform the next reply without triggering one.
   */
  inject(text: string, opts?: { respond?: boolean }): void {
    this.adapter.injectText(text, opts);
  }

  /** Re-send prompt and tools mid-call — after folding a new tool, say. */
  refreshSession(): void {
    this.adapter.updateSession({
      instructions: this.cfg.instructions ?? this.agent.getSystemPrompt(),
      tools: this.exposedTools,
    });
  }

  // ── tool execution ─────────────────────────────────────────────────────────

  /**
   * Run one tool call from the model.
   *
   * The failure path matters more than the happy path here. In a text agent a
   * thrown tool is a retry; in a voice call it is DEAD AIR, and the provider
   * will sit waiting for a result that never comes with the caller listening
   * to silence. So every branch — unknown tool, unparseable arguments, a
   * throw inside the tool — still returns a result to the model. It gets an
   * error it can speak ("I couldn't pull that up") instead of nothing.
   */
  private async runTool(call: { callId: string; name: string; arguments: string }): Promise<void> {
    const tool = this.agent.tools.find((t) => t.name === call.name) as Tool<unknown> | undefined;

    if (!tool || this.excluded.has(call.name)) {
      this.adapter.sendToolResult(call.callId, {
        status: "error",
        data: null,
        message: `Unknown tool: ${call.name}`,
      });
      return;
    }

    let input: unknown;
    try {
      input = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      this.adapter.sendToolResult(call.callId, {
        status: "error",
        data: null,
        message: "Arguments were not valid JSON.",
      });
      return;
    }

    // Validate against the tool's own schema when it has one, so a voice call
    // gets the same input guarantees as a text turn rather than a surprise
    // inside the implementation.
    if (tool.input_schema) {
      const parsed = tool.input_schema.safeParse(input);
      if (!parsed.success) {
        this.adapter.sendToolResult(call.callId, {
          status: "error",
          data: null,
          message: `Invalid arguments: ${parsed.error.message}`,
        });
        return;
      }
      input = parsed.data;
    }

    this.cfg.onToolCall?.(call.name, "start", input);
    this.emit("tool_started", call.name, input);

    try {
      const result = await tool.run(input, undefined, undefined);
      this.cfg.onToolCall?.(call.name, "done", result);
      this.emit("tool_finished", call.name, result);
      // Same contract as the model adapters: `renderData` (and the summary
      // plumbing) is client-only and never reaches a model — tools rely on
      // that to keep sensitive UI data out of the provider.
      const { renderData: _rd, summary: _s, generateSummaryArgs: _gsa, ...wire } =
        result as ToolResultData;
      this.adapter.sendToolResult(call.callId, wire);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.onToolCall?.(call.name, "error", error);
      this.emit("error", error);
      this.adapter.sendToolResult(call.callId, {
        status: "error",
        data: null,
        message: error.message,
      });
    }
  }
}
