import type { GoalInstance, GoalScope, GoalStatus, GoalView } from "./types";

export type GoalTransitionKind = "enter" | "complete" | "reopen";
export interface GoalTransition {
  id: string;
  kind: GoalTransitionKind;
  goalKey: string;
  version: number;
}
export interface GoalHookContext {
  /** Stable across retries and process restarts. Deduplicate external effects with this key. */
  idempotencyKey: string;
  transition: GoalTransition;
  scope: GoalScope;
  goal: GoalView;
  /** Historical state immediately after the transition, not the latest aggregate. */
  status: GoalStatus;
  reason: string;
}
export interface GoalLifecycleHooks<C extends GoalHookContext = GoalHookContext> {
  onEnter?: (context: C) => void | Promise<void>;
  onComplete?: (context: C) => void | Promise<void>;
  onReopen?: (context: C) => void | Promise<void>;
}
export interface GoalTransitionDispatch {
  transitionId: string;
  owner: string;
  state: "running" | "completed" | "failed";
  attempts: number;
  leaseUntil: number;
  error?: string;
}
export interface GoalHookResumeResult {
  completed: string[];
  /** Another worker owns this transition. Later transitions must wait. */
  blockedBy?: string;
}
export class GoalHookError extends Error {
  constructor(readonly transition: GoalTransition, cause: unknown) {
    super(`Goal ${transition.kind} hook failed for ${transition.goalKey}; resumeHooks() can retry the saved transition`, { cause });
    this.name = "GoalHookError";
  }
}
export function transitionHookName(kind: GoalTransitionKind): keyof GoalLifecycleHooks {
  return kind === "enter" ? "onEnter" : kind === "complete" ? "onComplete" : "onReopen";
}

/** Completion/reopening are handled before entering the next active goal. */
export function goalTransitions(before: GoalStatus | null, after: GoalStatus): GoalTransition[] {
  const result: GoalTransition[] = [];
  const add = (kind: GoalTransitionKind, goalKey: string) => result.push({
    id: JSON.stringify([after.scope.subject, after.scope.key, after.scope.agent ?? null, after.version, goalKey, kind]),
    kind, goalKey, version: after.version,
  });
  for (const goal of after.goals) {
    const previous = before?.goals.find((g) => g.definition.key === goal.definition.key);
    if (goal.status === "completed" && previous?.status !== "completed") add("complete", goal.definition.key);
    if (previous?.status === "completed" && (goal.status === "active" || goal.status === "pending")) add("reopen", goal.definition.key);
  }
  if (after.activeGoal && after.activeGoal !== before?.activeGoal) add("enter", after.activeGoal);
  return result;
}

/** Reconstruct the state a hook observed without relying on current code definitions. */
export function instanceAtRevision(instance: GoalInstance, index: number): GoalInstance {
  const revision = instance.history[index];
  return { ...instance, program: revision.program, progress: revision.progress, preparation: revision.preparation, version: revision.version,
    updatedAt: revision.provenance.timestamp, history: instance.history.slice(0, index + 1) };
}
