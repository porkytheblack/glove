import type { GoalTransitionDispatch } from "../goals/lifecycle";
import { equalGoalData } from "../goals/equal";
import { GoalConflictError, GoalValidationError, type GoalAdapter } from "../goals/adapter";
import { GoalScopeSchema, type GoalInstance, type GoalScope } from "../goals/types";

function scopeKey(scope: GoalScope): string {
  const valid = GoalScopeSchema.parse(scope);
  return JSON.stringify([valid.subject, valid.key, valid.agent ?? null]);
}

/** Reference CAS adapter. No await between version check and Map replacement. */
export class InMemoryGoalAdapter implements GoalAdapter {
  readonly identifier: string;
  private readonly dispatches = new Map<string, Map<string, GoalTransitionDispatch>>();
  private readonly instances = new Map<string, GoalInstance>();
  constructor(options: { identifier?: string } = {}) {
    this.identifier = options.identifier ?? "in-memory-goals";
  }
  async get(scope: GoalScope): Promise<GoalInstance | null> {
    const instance = this.instances.get(scopeKey(scope));
    return instance ? structuredClone(instance) : null;
  }
  async commit(scope: GoalScope, next: GoalInstance, options: { ifVersion: number | null }): Promise<GoalInstance> {
    const key = scopeKey(scope);
    const current = this.instances.get(key);
    const actual = current?.version ?? null;
    if (actual !== options.ifVersion) throw new GoalConflictError(options.ifVersion, actual);
    if (scopeKey(next.scope) !== key || next.version !== (actual ?? 0) + 1) {
      throw new GoalValidationError("Commit scope/version does not match the stored aggregate");
    }
    if (next.history.length !== (current?.history.length ?? 0) + 1 ||
        !equalGoalData(next.history.slice(0, -1), current?.history ?? [])) {
      throw new GoalValidationError("Goal history must append exactly one revision");
    }
    this.instances.set(key, structuredClone(next));
    return structuredClone(next);
  }
  async claimTransition(scope: GoalScope, id: string, options: { owner: string; leaseMs: number }): Promise<"claimed" | "completed" | "busy"> {
    const key = scopeKey(scope);
    const instance = this.instances.get(key);
    if (!instance?.history.some((revision) => revision.transitions?.some((event) => event.id === id))) {
      throw new GoalValidationError("Unknown goal transition");
    }
    if (!options.owner || !Number.isFinite(options.leaseMs) || options.leaseMs <= 0) throw new GoalValidationError("Invalid transition lease");
    let receipts = this.dispatches.get(key);
    if (!receipts) { receipts = new Map(); this.dispatches.set(key, receipts); }
    const previous = receipts.get(id);
    if (previous?.state === "completed") return "completed";
    const now = Date.now();
    if (previous?.state === "running" && previous.leaseUntil > now) return "busy";
    receipts.set(id, { transitionId: id, owner: options.owner, state: "running", attempts: (previous?.attempts ?? 0) + 1, leaseUntil: now + options.leaseMs });
    return "claimed";
  }
  async settleTransition(scope: GoalScope, id: string, options: { owner: string; state: "completed" | "failed"; error?: string }): Promise<boolean> {
    const receipt = this.dispatches.get(scopeKey(scope))?.get(id);
    if (!receipt || receipt.state !== "running" || receipt.owner !== options.owner) return false;
    receipt.state = options.state;
    receipt.leaseUntil = 0;
    if (options.error !== undefined) receipt.error = options.error;
    return true;
  }
  async getTransitionDispatches(scope: GoalScope): Promise<GoalTransitionDispatch[]> {
    return structuredClone([...this.dispatches.get(scopeKey(scope))?.values() ?? []]);
  }

}
