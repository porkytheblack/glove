/**
 * Addressed events on a voice call: told at a pause in speech, from facts
 * read just before telling, as product context rather than as the caller,
 * with a durable receipt so that no restart says one twice.
 *
 * Each event moves through a receipt (see event-receipts.ts):
 *
 *   queued ──prepare──▶ suppressed                       (nothing due: silent)
 *     │
 *     └─▶ dispatching ──inject──▶ accepted ──▶ transcript written ──▶ ack
 *            │
 *            └─ (crash here: the outcome is unknown; never replayed)
 *
 *   queued at call end ──afterCall──▶ redirecting ──▶ redirected ──▶ ack
 *
 * The receipt is written before every step that has an effect, so recovery
 * knows which steps happened. "accepted" means the provider's transport took
 * the text locally: not that anyone heard it.
 */
import type { AgentEvent, IGloveRunnable, Message } from "glove-core";
import type { AgentHandlerContext } from "./definition.js";
import type { FoundryEventPreparation, FoundryHandledEvent } from "./event-delivery.js";
import {
  eventReceiptStore,
  eventTranscriptMessageId,
  lateChatEffectId,
  type EventReceiptStore,
  type FoundryEventReceipt,
} from "./event-receipts.js";

export interface VoiceEventContext {
  readonly runId: string;
  /** This call: with the run id, the generation a dispatch belongs to. */
  readonly callId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  /** The event's journal id: the same on every redelivery. */
  readonly eventRecordId: string;
  readonly signal: AbortSignal;
}

export interface VoiceCallEvents {
  /** Which addressed events (agent messages and transmissions) this call tells. Others are left to the run. */
  readonly accept: (event: AgentEvent) => boolean;
  /**
   * Read current facts just before telling, once the call has paused. Return
   * `{ say }` with what to tell now or `{ suppress }` when nothing is due any
   * more (cancelled, moved, too late). Throwing tells nothing and keeps the
   * event for a later pause. Default: say the event's text.
   */
  readonly prepare?: (event: AgentEvent, context: VoiceEventContext) => FoundryEventPreparation | Promise<FoundryEventPreparation>;
  /** The transcript line for a told event. Default: `[event from <source>] <text>`. */
  readonly transcript?: (event: AgentEvent, said: string) => string;
  /**
   * Tell an event some other way (a chat message, say) when its call ended
   * before it was ever attempted, or when it arrives with no call open. Runs
   * only for events never dispatched to the call, and under an `effectId`
   * derived from the event that is the same on every retry: make the effect
   * idempotent on it. Without this, such events stay pending for the
   * conversation's next run.
   */
  readonly afterCall?: (event: AgentEvent, context: VoiceEventContext & { readonly effectId: string }) => Promise<void>;
  /**
   * An event whose dispatch began on another run or call and whose outcome
   * is unknown (the process died mid-dispatch). Return "accepted" or
   * "suppressed" when the product can tell, from a provider receipt for
   * instance. Anything else keeps it held: it is never spoken again or sent
   * to chat automatically.
   */
  readonly resolveUncertain?: (receipt: FoundryEventReceipt, context: VoiceEventContext) => Promise<"accepted" | "suppressed" | undefined>;
  /** Ask the model to say something about a told event. Default true. */
  readonly respond?: boolean;
}

interface QueuedEvent {
  readonly handled: FoundryHandledEvent;
  receipt: FoundryEventReceipt;
  attempts: number;
  notBefore: number;
}

/** How long an injected event waits for the agent to start answering before the next may go. */
const RESPONSE_WAIT_MS = 3_000;

export function defaultEventTranscript(event: AgentEvent, said: string): string {
  return `[event from ${event.source}] ${said}`;
}

function eventText(event: AgentEvent): string {
  if (typeof event.content === "string") return event.content;
  return event.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface VoiceEventDeliveryOptions {
  readonly events: VoiceCallEvents;
  readonly agent: IGloveRunnable;
  readonly context: AgentHandlerContext;
  readonly callId: string;
  /** Whether told events are written to the conversation's store. */
  readonly keepTranscript: boolean;
  /** Present on a live call: whether the call may speak now. */
  readonly live?: {
    readonly quiet: () => boolean;
    readonly inject: (text: string, respond: boolean) => void;
  };
}

/** One call's (or one off-call run's) handling of addressed events. */
export class VoiceEventDelivery {
  readonly receipts: EventReceiptStore;
  private readonly queue: QueuedEvent[] = [];
  private pumping?: Promise<void>;
  private retry?: ReturnType<typeof setTimeout>;
  private awaitingResponse?: ReturnType<typeof setTimeout>;
  private ended = false;
  /** Events told on this call. */
  told = 0;

  constructor(private readonly options: VoiceEventDeliveryOptions) {
    this.receipts = eventReceiptStore(options.context.data);
  }

  private get generation(): string {
    return `${this.options.context.runId}/${this.options.callId}`;
  }

  private contextFor(handled: FoundryHandledEvent): VoiceEventContext {
    const { context, callId } = this.options;
    return {
      runId: context.runId, callId, agentId: context.agentId, conversationId: context.conversationId,
      workspaceId: context.workspaceId, eventRecordId: handled.id, signal: context.signal,
    };
  }

  private emit(type: string, data: Record<string, unknown>): void {
    this.options.context.emit({ type: `foundry.voice.event.${type}`, data });
  }

  private async put(receipt: FoundryEventReceipt, patch: Partial<FoundryEventReceipt>): Promise<FoundryEventReceipt> {
    const next = { ...receipt, ...patch, updatedAt: new Date().toISOString() };
    await this.receipts.put(next);
    return next;
  }

  /** The `onEvent` handler: decide from the event's receipt what, if anything, is left to do. */
  async handle(handled: FoundryHandledEvent): Promise<void> {
    let receipt = await this.receipts.get(handled.id);
    if (!receipt) {
      const now = new Date().toISOString();
      const fresh: FoundryEventReceipt = {
        id: handled.id, eventId: handled.event.id, agentId: this.options.context.agentId,
        conversationId: this.options.context.conversationId, workspaceId: this.options.context.workspaceId,
        status: "queued", generation: this.generation, runId: this.options.context.runId, createdAt: now, updatedAt: now,
      };
      receipt = (await this.receipts.claim(fresh)) ? fresh : await this.receipts.get(handled.id);
      if (!receipt) return;
    }
    switch (receipt.status) {
      case "accepted":
        // Said before (perhaps by a process that died before acknowledging): never again.
        await this.repairTranscript(handled, receipt);
        handled.ack();
        return;
      case "suppressed":
      case "redirected":
        handled.ack();
        return;
      case "redirecting":
        // A late-chat effect began: finish that same effect, never voice.
        await this.redirect(handled, receipt);
        return;
      case "dispatching":
        if (receipt.generation === this.generation) return;
        await this.uncertain(handled, receipt);
        return;
      case "queued":
        if (!this.options.live || this.ended) {
          await this.offCall(handled, receipt);
          return;
        }
        this.queue.push({ handled, receipt, attempts: 0, notBefore: 0 });
        this.emit("queued", { id: handled.id });
        this.pump();
    }
  }

  /** No call to tell it on: hand it to the late-chat policy, or keep it pending. */
  private async offCall(handled: FoundryHandledEvent, receipt: FoundryEventReceipt): Promise<void> {
    if (this.options.events.afterCall) await this.redirect(handled, receipt);
    else this.emit("retained", { id: handled.id, status: receipt.status });
  }

  private async redirect(handled: FoundryHandledEvent, receipt: FoundryEventReceipt): Promise<void> {
    const afterCall = this.options.events.afterCall;
    if (!afterCall) { this.emit("retained", { id: handled.id, status: receipt.status }); return; }
    const effectId = receipt.effectId ?? lateChatEffectId(receipt.id);
    // Recorded before the effect runs: a crash from here on retries this same effect.
    if (receipt.status !== "redirecting") receipt = await this.put(receipt, { status: "redirecting", effectId, generation: this.generation, runId: this.options.context.runId });
    try {
      await afterCall(handled.event, { ...this.contextFor(handled), effectId });
    } catch (cause) {
      this.emit("redirect.failed", { id: handled.id, effectId, message: message(cause) });
      return;
    }
    await this.put(receipt, { status: "redirected", settledAt: new Date().toISOString() });
    handled.ack();
    this.emit("redirected", { id: handled.id, effectId });
  }

  private async uncertain(handled: FoundryHandledEvent, receipt: FoundryEventReceipt): Promise<void> {
    let resolution: "accepted" | "suppressed" | undefined;
    try {
      resolution = await this.options.events.resolveUncertain?.(receipt, this.contextFor(handled));
    } catch (cause) {
      this.emit("uncertain.failed", { id: handled.id, message: message(cause) });
    }
    if (resolution === "accepted") {
      const accepted = await this.put(receipt, { status: "accepted", acceptedAt: new Date().toISOString() });
      await this.repairTranscript(handled, accepted);
      handled.ack();
    } else if (resolution === "suppressed") {
      await this.put(receipt, { status: "suppressed", reason: "resolved after an uncertain dispatch", settledAt: new Date().toISOString() });
      handled.ack();
    } else {
      // Possibly said: never said again, never sent to chat instead.
      this.emit("uncertain", { id: handled.id, generation: receipt.generation });
    }
  }

  /** The provider took it but the transcript line may be missing: write it once, saying nothing. */
  private async repairTranscript(handled: FoundryHandledEvent, receipt: FoundryEventReceipt): Promise<void> {
    if (!this.options.keepTranscript || receipt.transcriptMessageId || receipt.text === undefined) return;
    await this.writeTranscript(handled, receipt, receipt.text);
    this.emit("transcript.repaired", { id: handled.id });
  }

  private async writeTranscript(handled: FoundryHandledEvent, receipt: FoundryEventReceipt, said: string): Promise<void> {
    if (!this.options.keepTranscript) return;
    const store = this.options.agent.store;
    const id = eventTranscriptMessageId(receipt.id);
    const existing = await store.getMessages();
    if (!existing.some((item) => item.id === id)) {
      const line: Message = {
        id, sender: "user", framework_context: "event",
        text: (this.options.events.transcript ?? defaultEventTranscript)(handled.event, said),
      };
      await store.appendMessages([line]);
    }
    await this.put(receipt, { transcriptMessageId: id });
  }

  /** Speech paused (or something changed): tell what is due, one event at a time. */
  pump(): void {
    if (this.pumping || this.ended || !this.options.live) return;
    this.pumping = this.drain()
      .catch((cause) => this.emit("failed", { message: message(cause) }))
      .finally(() => { this.pumping = undefined; });
  }

  private quiet(): boolean {
    return !this.ended && !this.awaitingResponse && this.options.live!.quiet();
  }

  /** The agent started answering a told event: the next may go at the next pause. */
  responding(): void {
    if (this.awaitingResponse) clearTimeout(this.awaitingResponse);
    this.awaitingResponse = undefined;
  }

  private scheduleRetry(at: number): void {
    if (this.retry || this.ended) return;
    this.retry = setTimeout(() => { this.retry = undefined; this.pump(); }, Math.max(50, at - Date.now()));
    this.retry.unref?.();
  }

  private async drain(): Promise<void> {
    const live = this.options.live!;
    while (this.queue.length && this.quiet()) {
      const now = Date.now();
      const item = this.queue.find((candidate) => candidate.notBefore <= now);
      if (!item) {
        this.scheduleRetry(Math.min(...this.queue.map((candidate) => candidate.notBefore)));
        return;
      }
      const { handled } = item;
      let prepared: FoundryEventPreparation;
      try {
        const prepare = this.options.events.prepare;
        prepared = prepare ? await prepare(handled.event, this.contextFor(handled)) : { say: eventText(handled.event) };
      } catch (cause) {
        // Withheld and kept; others go ahead of it.
        item.attempts++;
        item.notBefore = Date.now() + Math.min(1_000 * 2 ** (item.attempts - 1), 60_000);
        this.emit("prepare.failed", { id: handled.id, attempts: item.attempts, message: message(cause) });
        continue;
      }
      if ("suppress" in prepared) {
        this.queue.splice(this.queue.indexOf(item), 1);
        item.receipt = await this.put(item.receipt, { status: "suppressed", reason: prepared.suppress, settledAt: new Date().toISOString() });
        handled.ack();
        this.emit("suppressed", { id: handled.id, reason: prepared.suppress });
        continue;
      }
      // The call may have ended or got busy while the facts were read: the
      // next pause prepares it again.
      if (!this.quiet()) return;
      const text = prepared.say;
      // The boundary: recorded before the provider is asked, so a crash after
      // this point is never replayed.
      item.receipt = await this.put(item.receipt, {
        status: "dispatching", generation: this.generation, runId: this.options.context.runId,
        text, dispatchedAt: new Date().toISOString(),
      });
      if (!this.quiet()) {
        // Provably not sent: back to queued.
        item.receipt = await this.put(item.receipt, { status: "queued" });
        return;
      }
      this.queue.splice(this.queue.indexOf(item), 1);
      try {
        live.inject(text, this.options.events.respond !== false);
      } catch (cause) {
        // The provider may have taken part of it: held as uncertain.
        this.emit("uncertain", { id: handled.id, generation: this.generation, message: message(cause) });
        continue;
      }
      this.awaitingResponse = setTimeout(() => { this.awaitingResponse = undefined; this.pump(); }, RESPONSE_WAIT_MS);
      this.awaitingResponse.unref?.();
      item.receipt = await this.put(item.receipt, { status: "accepted", acceptedAt: new Date().toISOString() });
      this.emit("accepted", { id: handled.id, heard: "unknown" });
      await this.writeTranscript(handled, item.receipt, text);
      this.told++;
      handled.ack();
    }
  }

  /**
   * The call is over. Waits for a telling in progress; then events never
   * attempted go to the late-chat policy, or stay pending with a queued
   * receipt as proof that nothing was said.
   */
  async finish(): Promise<void> {
    this.ended = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.awaitingResponse) clearTimeout(this.awaitingResponse);
    this.retry = undefined;
    this.awaitingResponse = undefined;
    await this.pumping;
    for (const item of this.queue.splice(0)) await this.offCall(item.handled, item.receipt);
  }
}
