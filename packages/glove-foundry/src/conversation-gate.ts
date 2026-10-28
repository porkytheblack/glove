/**
 * One run at a time per conversation.
 *
 * Every run on a conversation passes through its lane. The first takes the
 * lane; later ones wait in arrival order and start when the run ahead of them
 * has settled and its process has let go. Runs the runtime creates wait
 * parked in the execution queue, so they hold no concurrency slot; runs it did
 * not create (a schedule firing) wait in their process until granted.
 */
interface Slot {
  runId?: string;
  /** Promoted to active before its run id was known: start it once it is. */
  promoted?: boolean;
  /** Start the run. Resolve false when it can no longer start (cancelled while waiting). */
  start?: (runId: string) => Promise<boolean>;
}

interface Lane {
  active?: Slot;
  readonly waiting: Slot[];
  holds: number;
}

export interface ConversationGateHooks {
  /** The conversation has nothing running or waiting. */
  readonly idle: (conversationId: string) => void;
  /** A waiting run could not be started; it is treated as settled. */
  readonly failed?: (conversationId: string, runId: string, cause: unknown) => void;
}

export class ConversationGate {
  private readonly lanes = new Map<string, Lane>();
  private readonly conversationByRun = new Map<string, string>();

  constructor(private readonly hooks: ConversationGateHooks) {}

  /** Something is running, waiting, or held for this conversation. */
  busy(conversationId: string): boolean {
    const lane = this.lanes.get(conversationId);
    return Boolean(lane && (lane.active || lane.waiting.length > 0 || lane.holds > 0));
  }

  /** The run is waiting for its conversation. */
  waiting(runId: string): boolean {
    const conversationId = this.conversationByRun.get(runId);
    const lane = conversationId ? this.lanes.get(conversationId) : undefined;
    return Boolean(lane?.waiting.some((slot) => slot.runId === runId));
  }

  /** The run that holds the conversation, once its id is known. */
  activeRun(conversationId: string): string | undefined {
    return this.lanes.get(conversationId)?.active?.runId;
  }

  /**
   * Create a run for the conversation. `create(parked)` makes it: started
   * at once when the lane is free, parked otherwise; `start` makes a parked
   * run due when its turn comes. `front` puts it ahead of runs already waiting.
   */
  async admit(
    conversationId: string,
    create: (parked: boolean) => Promise<string>,
    start: (runId: string) => Promise<boolean>,
    options: { readonly front?: boolean } = {},
  ): Promise<string> {
    const lane = this.lane(conversationId);
    const slot: Slot = { start };
    const parked = Boolean(lane.active) || lane.waiting.length > 0 || lane.holds > 0;
    if (!parked) lane.active = slot;
    else if (options.front) lane.waiting.unshift(slot);
    else lane.waiting.push(slot);
    let runId: string;
    try {
      runId = await create(parked);
    } catch (cause) {
      this.remove(conversationId, slot);
      throw cause;
    }
    slot.runId = runId;
    this.conversationByRun.set(runId, conversationId);
    if (slot.promoted) this.begin(conversationId, slot);
    return runId;
  }

  /**
   * A run the gate did not create asks for the conversation. Resolves when it
   * holds it. A run that already holds it resolves at once.
   */
  claim(conversationId: string, runId: string): Promise<void> {
    const known = this.conversationByRun.get(runId);
    const lane = this.lane(conversationId);
    if (known === conversationId && lane.active?.runId === runId) return Promise.resolve();
    return new Promise<void>((resolveClaim) => {
      const slot: Slot = {
        runId,
        start: async () => {
          resolveClaim();
          return true;
        },
      };
      this.conversationByRun.set(runId, conversationId);
      if (!this.busy(conversationId)) {
        lane.active = slot;
        resolveClaim();
        return;
      }
      lane.waiting.push(slot);
    });
  }

  /** The run settled and its process let go: the next one may start. */
  settled(runId: string): void {
    const conversationId = this.conversationByRun.get(runId);
    if (!conversationId) return;
    this.conversationByRun.delete(runId);
    const lane = this.lanes.get(conversationId);
    if (!lane) return;
    if (lane.active?.runId === runId) {
      lane.active = undefined;
    } else {
      const index = lane.waiting.findIndex((slot) => slot.runId === runId);
      if (index >= 0) lane.waiting.splice(index, 1);
    }
    this.pump(conversationId);
  }

  /** Keep the conversation from starting its next run until the returned release is called. */
  hold(conversationId: string): () => void {
    const lane = this.lane(conversationId);
    lane.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lane.holds -= 1;
      this.pump(conversationId);
    };
  }

  private lane(conversationId: string): Lane {
    let lane = this.lanes.get(conversationId);
    if (!lane) {
      lane = { waiting: [], holds: 0 };
      this.lanes.set(conversationId, lane);
    }
    return lane;
  }

  private remove(conversationId: string, slot: Slot): void {
    const lane = this.lanes.get(conversationId);
    if (!lane) return;
    if (lane.active === slot) lane.active = undefined;
    else {
      const index = lane.waiting.indexOf(slot);
      if (index >= 0) lane.waiting.splice(index, 1);
    }
    this.pump(conversationId);
  }

  private pump(conversationId: string): void {
    const lane = this.lanes.get(conversationId);
    if (!lane || lane.active || lane.holds > 0) return;
    const next = lane.waiting.shift();
    if (!next) {
      this.lanes.delete(conversationId);
      this.hooks.idle(conversationId);
      return;
    }
    lane.active = next;
    if (next.runId) this.begin(conversationId, next);
    else next.promoted = true;
  }

  private begin(conversationId: string, slot: Slot): void {
    const runId = slot.runId!;
    const start = slot.start;
    if (!start) return;
    void start(runId).then(
      (started) => {
        if (!started) this.settled(runId);
      },
      (cause) => {
        this.hooks.failed?.(conversationId, runId, cause);
        this.settled(runId);
      },
    );
  }
}
