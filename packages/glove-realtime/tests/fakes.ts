// Test doubles: a scriptable socket for adapter wire tests, and a recording
// adapter for session tests.

import type {
  RealtimeAdapter,
  RealtimeCapabilities,
  RealtimeCompaction,
  RealtimeCompactionOutcome,
  RealtimeEvent,
  RealtimeInjection,
  RealtimeListener,
  RealtimeMedia,
  RealtimeSessionSpec,
  RealtimeToolResult,
  RealtimeToolSpec,
} from "../src/types";
import type { WebSocketLike } from "../src/wire";

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, Array<(ev: any) => void>>();

  constructor(
    readonly url: string,
    /** Reply to what the adapter sends — the fake provider. */
    private readonly respond?: (message: any, socket: FakeSocket) => void,
    readonly extra?: unknown,
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.fire("open", {});
    });
  }

  addEventListener(type: string, fn: (ev: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string | ArrayBufferLike): void {
    const message = JSON.parse(String(data));
    this.sent.push(message);
    this.respond?.(message, this);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed = { code, reason };
    queueMicrotask(() => this.fire("close", { code, reason }));
  }

  /** The provider closes the socket. */
  drop(code = 1011, reason = "server went away"): void {
    this.readyState = 3;
    this.fire("close", { code, reason });
  }

  receive(message: unknown, binary = false): void {
    const text = JSON.stringify(message);
    this.fire("message", { data: binary ? new TextEncoder().encode(text).buffer : text });
  }

  fire(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  ofType(type: string): any[] {
    return this.sent.filter((m) => m.type === type);
  }
}

const FULL: RealtimeCapabilities = {
  input: ["audio", "text", "image", "video"],
  output: ["audio", "text"],
  tools: { update: "live", nonBlocking: true, cancellation: true },
  instructions: { update: "replace" },
  context: { silentInjection: true, supersede: true, historySeed: true },
  compaction: { native: true, apply: "in_place", summarize: true },
  resumption: true,
  transcripts: "turns",
  speechLifecycle: "provider",
};

/** Records every call; `fire()` plays provider events into the session. */
export class FakeAdapter implements RealtimeAdapter {
  readonly provider = "fake";
  readonly model = "fake-1";
  readonly inputFormat = { sampleRate: 16_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  readonly outputFormat = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  capabilities: RealtimeCapabilities;
  isOpen = false;
  opens: RealtimeSessionSpec[] = [];
  closes = 0;
  injected: RealtimeInjection[] = [];
  results: RealtimeToolResult[] = [];
  toolUpdates: RealtimeToolSpec[][] = [];
  instructionUpdates: string[] = [];
  texts: Array<{ text: string; respond?: boolean }> = [];
  media: RealtimeMedia[] = [];
  compactions: RealtimeCompaction[] = [];
  summaries: string[] = [];
  summary = "the caller wants a refund for order 42";
  /** Make the next open() calls fail. */
  failOpens = 0;
  private listeners = new Set<RealtimeListener>();

  constructor(caps: Partial<RealtimeCapabilities> = {}) {
    this.capabilities = { ...FULL, ...caps };
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  fire(event: RealtimeEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  async open(spec: RealtimeSessionSpec): Promise<void> {
    this.opens.push(spec);
    if (this.failOpens > 0) {
      this.failOpens--;
      throw new Error("open failed");
    }
    this.isOpen = true;
    this.fire({ type: "session.opened", resumed: Boolean(spec.resumeHandle) });
  }

  async close(): Promise<void> {
    this.closes++;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.fire({ type: "session.closed", expected: true });
  }

  sendAudio(): void {}
  sendText(text: string, opts?: { respond?: boolean }): void { this.texts.push({ text, ...opts }); }
  sendMedia(media: RealtimeMedia): void { this.media.push(media); }
  setTools(tools: RealtimeToolSpec[]): void { this.toolUpdates.push(tools); }
  setInstructions(text: string): void { this.instructionUpdates.push(text); }
  inject(injection: RealtimeInjection): void { this.injected.push(injection); }
  sendToolResult(result: RealtimeToolResult): void { this.results.push(result); }
  respond(): void {}
  interrupt(): void { this.fire({ type: "interrupted" }); }

  async compact(request: RealtimeCompaction): Promise<RealtimeCompactionOutcome> {
    this.compactions.push(request);
    return this.capabilities.compaction.apply === "none" ? "unsupported" : "in_place";
  }

  async summarize(instructions: string): Promise<string> {
    this.summaries.push(instructions);
    return this.summary;
  }
}
