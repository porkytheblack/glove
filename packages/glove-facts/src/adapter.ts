import { scopeKey, type FactScope, type FactState } from "./types";

export interface FactTransaction {
  read(): Promise<FactState>;
  /** Each save is durable independently; exceptions do NOT roll back earlier saves. */
  save(next: FactState): Promise<void>;
}
/**
 * BYO persistence. Serialize ALL writes and preparation commits within one scope,
 * across workers, until run settles. Release on process death; a TTL without
 * fencing is insufficient. Reads and saves are detached, saves atomically replace
 * the aggregate at version + 1. Do not call this adapter recursively from run.
 * Consumer commits execute under this lock; external effects execute afterwards.
 */
export interface FactAdapter {
  identifier: string;
  withScope<T>(scope: FactScope, run: (transaction: FactTransaction) => Promise<T>): Promise<T>;
}
export class InMemoryFactAdapter implements FactAdapter {
  readonly identifier = "in-memory-facts";
  private states = new Map<string, FactState>();
  private queues = new Map<string, Promise<void>>();
  async withScope<T>(scope: FactScope, run: (transaction: FactTransaction) => Promise<T>): Promise<T> {
    const key = scopeKey(scope);
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(key, next);
    await previous;
    let active = true;
    const read = () => this.states.get(key) ?? { version: 0, facts: [], claims: [], operations: {} };
    try {
      return await run({
        read: async () => { if (!active) throw new Error("Expired fact transaction"); return structuredClone(read()); },
        save: async state => {
          if (!active) throw new Error("Expired fact transaction");
          if (state.version !== read().version + 1) throw new Error("Fact version conflict");
          this.states.set(key, structuredClone(state));
        },
      });
    } finally {
      active = false;
      release();
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
}
