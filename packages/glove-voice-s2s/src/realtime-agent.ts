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
import { getToolJsonSchema, type IGloveRunnable, type Tool } from "glove-core";
import type { S2SAdapter, S2SSessionConfig, S2STool } from "./types";

export interface RealtimeAgentConfig {
  /** A built Glove. Its prompt and tools configure the session. */
  agent: IGloveRunnable;
  /** The provider session. */
  adapter: S2SAdapter;
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
  private readonly adapter: S2SAdapter;
  private readonly excluded: Set<string>;
  private started = false;

  constructor(private readonly cfg: RealtimeAgentConfig) {
    super();
    this.agent = cfg.agent;
    this.adapter = cfg.adapter;
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

    this.adapter.on("tool_call", (call) => void this.runTool(call));
    this.adapter.on("user_transcript", (text, isFinal) => {
      if (isFinal && text) this.emit("user_said", text);
    });
    this.adapter.on("agent_transcript_delta", (text) => this.emit("agent_delta", text));
    this.adapter.on("agent_transcript_done", (text) => {
      if (text) this.emit("agent_said", text);
    });
    this.adapter.on("error", (err) => this.emit("error", err));

    const config: S2SSessionConfig = {
      instructions: this.cfg.instructions ?? this.agent.getSystemPrompt(),
      voice: this.cfg.voice,
      tools: this.exposedTools,
    };
    await this.adapter.connect(config);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.adapter.removeAllListeners();
    await this.adapter.disconnect();
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
        error: `Unknown tool: ${call.name}`,
      });
      return;
    }

    let input: unknown;
    try {
      input = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      this.adapter.sendToolResult(call.callId, {
        status: "error",
        error: "Arguments were not valid JSON.",
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
          error: `Invalid arguments: ${parsed.error.message}`,
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
      this.adapter.sendToolResult(call.callId, result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.cfg.onToolCall?.(call.name, "error", error);
      this.emit("error", error);
      this.adapter.sendToolResult(call.callId, { status: "error", error: error.message });
    }
  }
}
