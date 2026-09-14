import type { GoalTransitionDispatch } from "./lifecycle";
import type { GoalInstance, GoalScope } from "./types";

export class GoalConflictError extends Error {
  constructor(readonly expected: number | null, readonly actual: number | null) {
    super(`Goal version conflict: expected ${expected}, found ${actual}. Read status and retry.`);
    this.name = "GoalConflictError";
  }
}
export class GoalValidationError extends Error {
  constructor(message: string) { super(message); this.name = "GoalValidationError"; }
}

/**
 * Bring-your-own persistence. One aggregate per EXACT (subject, key, agent).
 *
 * get returns a detached snapshot or null. commit atomically replaces the
 * aggregate iff its stored version equals ifVersion (null means absent).
 * Persist definitions, progress AND the append-only history together, or none
 * of them. Throw GoalConflictError on conflicts; never silently last-write-win.
 * The runner supplies version = (ifVersion ?? 0) + 1 and timestamps/history.
 * Do not truncate history or mutate inputs. Return a detached saved snapshot.
 * For SQL use a unique compound scope and transactional INSERT / UPDATE WHERE
 * version = ?; in distributed stores use their conditional-write primitive.
 * The absent agent must still identify one shared bucket in that constraint.
 * JSON object member order need not be preserved; array order MUST be kept.
 * Tenancy, authentication, encryption, and retention belong to the host.
 */
export interface GoalAdapter {
  identifier: string;
  get(scope: GoalScope): Promise<GoalInstance | null>;
  commit(scope: GoalScope, next: GoalInstance, options: { ifVersion: number | null }): Promise<GoalInstance>;
  /**
   * Atomically claim a persisted transition. Completed receipts never reset;
   * live leases return busy; expired/failed leases can be reclaimed. Increment
   * attempts on each claim, use the storage clock, and reject unknown IDs.
   * Store receipts separately from progress commits so stale aggregate writes
   * cannot erase acknowledgements. All dispatchers for a scope use the same hooks.
   */
  claimTransition(scope: GoalScope, id: string, options: { owner: string; leaseMs: number }): Promise<"claimed" | "completed" | "busy">;
  /** Owner-fenced acknowledgement; false if the lease was reclaimed. */
  settleTransition(scope: GoalScope, id: string, options: { owner: string; state: "completed" | "failed"; error?: string }): Promise<boolean>;
  getTransitionDispatches(scope: GoalScope): Promise<GoalTransitionDispatch[]>;

}
