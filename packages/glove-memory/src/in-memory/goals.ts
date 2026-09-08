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
}
