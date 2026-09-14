import { z } from "zod";
import type { FactAdapter } from "./adapter";
import { canonical, FactInputSchema, FactRefSchema, FactScopeSchema, type Fact, type FactInput, type FactRef, type FactScope, type FactState } from "./types";

export class FactCaptureError extends Error {
  constructor(readonly fact: Fact, cause: unknown) { super("Fact saved, but urgent delivery failed; retry with the same operationId", { cause }); }
}
export class FactStore {
  constructor(readonly adapter: FactAdapter, readonly config: {
    scope: FactScope | (() => FactScope);
    /** Capacity rejects explicitly; no silent dropping or eviction. Default unlimited. */
    maxRevisions?: number;
    /** Immediate capture-time delivery. Deduplicate downstream by fact id/revision. */
    onUrgent?: (fact: Fact) => void | Promise<void>;
  }) { if (config.maxRevisions !== undefined) z.number().int().positive().parse(config.maxRevisions); }
  scope(): FactScope { return FactScopeSchema.parse(typeof this.config.scope === "function" ? this.config.scope() : this.config.scope); }
  async inspect(): Promise<FactState> { return this.adapter.withScope(this.scope(), tx => tx.read()); }
  async list(options: { history?: boolean; unclaimedBy?: string; urgent?: boolean } = {}): Promise<Fact[]> {
    const state = await this.inspect();
    return (options.history ? state.facts : currentFacts(state)).filter(f =>
      (!options.urgent || f.urgent) && (!options.unclaimedBy || !state.claims.some(c => c.consumer === options.unclaimedBy && c.state === "accepted" && c.refs.some(r => r.id === f.id && r.revision === f.revision))));
  }
  async record(input: FactInput, options: { operationId: string; supersedes?: FactRef }): Promise<Fact> {
    const valid = FactInputSchema.parse(input);
    const operationId = z.string().trim().min(1).max(2000).parse(options.operationId);
    const supersedes = options.supersedes ? FactRefSchema.parse({ id: options.supersedes.id, revision: options.supersedes.revision }) : undefined;
    const fingerprint = canonical({ valid, supersedes });
    const scope = this.scope();
    const fact = await this.adapter.withScope(scope, async tx => {
      const state = await tx.read();
      const prior = Object.hasOwn(state.operations, operationId) ? state.operations[operationId] : undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error("Fact operationId reused with different input");
        return state.facts.find(f => f.id === prior.ref.id && f.revision === prior.ref.revision)!;
      }
      if (this.config.maxRevisions !== undefined && state.facts.length >= this.config.maxRevisions) throw new Error("Fact capacity reached; nothing was saved");
      if (supersedes && !currentFacts(state).some(f => f.id === supersedes.id && f.revision === supersedes.revision)) throw new Error("Correction references an unknown or stale fact revision");
      const next: Fact = { ...valid, scope, id: supersedes?.id ?? crypto.randomUUID(), revision: (supersedes?.revision ?? 0) + 1, observedAt: new Date().toISOString(), ...(supersedes ? { supersedes } : {}) };
      const operations = { ...state.operations, [operationId]: { fingerprint, ref: { id: next.id, revision: next.revision } } };
      await tx.save({ ...state, version: state.version + 1, facts: [...state.facts, next], operations });
      return structuredClone(next);
    });
    if (fact.urgent && this.config.onUrgent) {
      try { await this.config.onUrgent(structuredClone(fact)); } catch (error) { throw new FactCaptureError(fact, error); }
    }
    return fact;
  }
}
export function currentFacts(state: FactState): Fact[] {
  const latest = new Map<string, Fact>();
  for (const fact of state.facts) if ((latest.get(fact.id)?.revision ?? 0) < fact.revision) latest.set(fact.id, fact);
  return [...latest.values()];
}
