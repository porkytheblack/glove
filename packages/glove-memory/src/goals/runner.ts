import { z } from "zod";
import { equalGoalData as equal } from "./equal";
import type { Provenance } from "../core/provenance";
import { GoalConflictError, GoalValidationError, type GoalAdapter } from "./adapter";
import {
  defineGoalProgram, GoalScopeSchema, GoalUpdateSchema,
  type GoalDefinition, type GoalInstance, type GoalItemDefinition,
  type GoalItemDisposition, type GoalProgram, type GoalRevision, type GoalScope,
  type GoalSnapshot, type GoalStatus, type GoalUpdateInput,
} from "./types";

const reasonSchema = z.string().trim().min(1).max(4000);
const versionSchema = z.number().int().positive();


export interface GoalRunnerConfig {
  scope: GoalScope | (() => GoalScope);
  actor?: string;
  source?: string;
  /** Application policy. Called BEFORE each commit attempt; must be side-effect-free. Throw to reject. */
  validateChange?: (change: { before: GoalInstance | null; after: GoalSnapshot; kind: GoalRevision["kind"]; reason: string }) => void | Promise<void>;
  /** After a successful durable commit. Failure does not roll back the write. */
  onChange?: (status: GoalStatus) => void | Promise<void>;
}

/** Pure derived view. No active-row bookkeeping to become stale after edits. */
export function projectGoalStatus(instance: GoalInstance): GoalStatus {
  let activeGoal: string | null = null;
  const goals = instance.program.goals.map((definition, index) => {
    const items = definition.items.map((item) => ({ definition: structuredClone(item), state: structuredClone(instance.progress[definition.key]?.[item.key] ?? null) }));
    const settled = items.filter((item) => !item.definition.retired).every((item) => item.state && item.state.disposition !== "pending");
    const status = definition.retired ? "retired" : settled ? "completed" : activeGoal === null ? "active" : "pending";
    if (status === "active") activeGoal = definition.key;
    return { definition: structuredClone(definition), ordinal: index + 1, status, items } as GoalStatus["goals"][number];
  });
  const deferred: GoalStatus["deferred"] = [];
  for (const [goalKey, items] of Object.entries(instance.progress)) {
    for (const [itemKey, state] of Object.entries(items)) {
      if (state.disposition !== "deferred") continue;
      const liveGoal = instance.program.goals.find((goal) => goal.key === goalKey);
      const liveItem = liveGoal?.items.find((item) => item.key === itemKey);
      const historical = findItem(instance, goalKey, itemKey);
      deferred.push({ goalKey, itemKey, label: historical?.item.label ?? itemKey, note: state.note,
        retired: !liveGoal || !!liveGoal.retired || !liveItem || !!liveItem.retired });
    }
  }
  return { scope: structuredClone(instance.scope), version: instance.version, programKey: instance.program.key,
    status: activeGoal === null ? "completed" : "active", activeGoal, goals, deferred };
}

function findItem(instance: GoalInstance, goalKey: string, itemKey: string): { goal: GoalDefinition; item: GoalItemDefinition } | undefined {
  for (const program of [instance.program, ...instance.history.slice().reverse().map((revision) => revision.program)]) {
    const goal = program.goals.find((g) => g.key === goalKey);
    const item = goal?.items.find((i) => i.key === itemKey);
    if (goal && item) return { goal, item };
  }
}

function checkLocks(before: GoalProgram, after: GoalProgram) {
  if (before.key !== after.key) throw new GoalValidationError("Program identity cannot change; start a separate scoped goal set instead");
  for (const goal of before.goals) {
    const next = after.goals.find((g) => g.key === goal.key);
    if (goal.locked && !equal(goal, next)) throw new GoalValidationError(`Goal ${goal.key} is locked`);
    for (const item of goal.items.filter((i) => i.locked)) {
      if (!next || next.retired || !equal(item, next.items.find((i) => i.key === item.key))) {
        throw new GoalValidationError(`Item ${goal.key}/${item.key} is locked`);
      }
    }
  }
}

export class GoalRunner {
  constructor(readonly adapter: GoalAdapter, private readonly config: GoalRunnerConfig) {}
  private scope(): GoalScope {
    return GoalScopeSchema.parse(typeof this.config.scope === "function" ? this.config.scope() : this.config.scope);
  }
  async inspect(): Promise<GoalInstance | null> { return this.adapter.get(this.scope()); }
  async status(): Promise<GoalStatus | null> {
    const instance = await this.inspect();
    return instance ? projectGoalStatus(instance) : null;
  }
  async history(): Promise<GoalRevision[]> { return (await this.inspect())?.history ?? []; }

  /** Idempotent only for an identical program. Never resets existing progress. */
  async start(program: GoalProgram, reason = "Start goal program"): Promise<GoalStatus> {
    const scope = this.scope();
    const valid = defineGoalProgram(program);
    const why = reasonSchema.parse(reason);
    const existing = await this.adapter.get(scope);
    if (existing) {
      if (!equal(existing.program, valid)) throw new GoalValidationError("A different program definition already exists in this scope; inspect and revise it explicitly");
      return projectGoalStatus(existing);
    }
    try {
      return await this.commit(scope, null, { program: valid, progress: {} }, "start", why);
    } catch (error) {
      if (!(error instanceof GoalConflictError)) throw error;
      const winner = await this.adapter.get(scope);
      if (winner && equal(winner.program, valid)) return projectGoalStatus(winner);
      throw error;
    }
  }

  /** Full definition revision. Caller must name the version it reviewed. */
  async revise(program: GoalProgram, options: { ifVersion: number; reason: string }): Promise<GoalStatus> {
    const scope = this.scope();
    const valid = defineGoalProgram(program);
    const reason = reasonSchema.parse(options.reason);
    const version = versionSchema.parse(options.ifVersion);
    const before = await this.requireInstance(scope);
    if (before.version !== version) throw new GoalConflictError(version, before.version);
    checkLocks(before.program, valid);
    if (equal(before.program, valid)) return projectGoalStatus(before);
    return this.commit(scope, before, { program: valid, progress: before.progress }, "revise", reason);
  }

  /**
   * Updates named items in any goal, including future goals. Settled states
   * may be changed explicitly; reopened returns to pending. Unknown keys
   * reject the entire update. Hosts can omit ifVersion for disjoint CAS retry;
   * model tools require it so a stale agent cannot silently overwrite work.
   */
  async update(raw: GoalUpdateInput): Promise<GoalStatus> {
    const input = GoalUpdateSchema.parse(raw);
    const scope = this.scope();
    const changes: Array<[string, GoalItemDisposition]> = [
      ...(input.completed ?? []).map((key) => [key, "done"] as [string, GoalItemDisposition]),
      ...(input.deferred ?? []).map((key) => [key, "deferred"] as [string, GoalItemDisposition]),
      ...(input.declined ?? []).map((key) => [key, "declined"] as [string, GoalItemDisposition]),
      ...(input.reopened ?? []).map((key) => [key, "pending"] as [string, GoalItemDisposition]),
    ];
    let initial: GoalInstance | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await this.requireInstance(scope);
      if (input.ifVersion !== undefined && input.ifVersion !== before.version) throw new GoalConflictError(input.ifVersion, before.version);
      // Retrying is safe only when neither the targeted state nor definitions
      // changed. Different-item progress can merge; same-item races must surface.
      if (initial && (!equal(initial.program, before.program) || changes.some(([key]) =>
        !equal(initial!.progress[input.goalKey]?.[key], before.progress[input.goalKey]?.[key])))) {
        throw new GoalConflictError(initial.version, before.version);
      }
      initial ??= before;
      const progress = structuredClone(before.progress);
      let changed = false;
      for (const [key, disposition] of changes) {
        const found = findItem(before, input.goalKey, key);
        if (!found) throw new GoalValidationError(`Unknown goal item: ${input.goalKey}/${key}`);
        const liveGoal = before.program.goals.find((g) => g.key === input.goalKey);
        const liveItem = liveGoal?.items.find((i) => i.key === key);
        const retired = !liveGoal || liveGoal.retired || !liveItem || liveItem.retired;
        if (retired && disposition !== "done" && disposition !== "declined") throw new GoalValidationError("Restore retired definitions before reopening or deferring them");
        const previous = progress[input.goalKey]?.[key];
        if ((previous?.disposition ?? "pending") === disposition) continue;
        progress[input.goalKey] ??= {};
        progress[input.goalKey][key] = { disposition, done: disposition === "done", note: input.reason, at: new Date().toISOString() };
        changed = true;
      }
      if (!changed) return projectGoalStatus(before);
      try {
        return await this.commit(scope, before, { program: before.program, progress }, "update", input.reason);
      } catch (error) {
        if (!(error instanceof GoalConflictError) || input.ifVersion !== undefined || attempt === 4) throw error;
      }
    }
    throw new GoalValidationError("Goal update retry limit exceeded");
  }

  private async requireInstance(scope: GoalScope): Promise<GoalInstance> {
    const instance = await this.adapter.get(scope);
    if (!instance) throw new GoalValidationError("No goal program in this scope; start one first");
    return instance;
  }
  private async commit(scope: GoalScope, before: GoalInstance | null, snapshot: GoalSnapshot, kind: GoalRevision["kind"], reason: string): Promise<GoalStatus> {
    await this.config.validateChange?.({ before: structuredClone(before), after: structuredClone(snapshot), kind, reason });
    const now = new Date().toISOString();
    const version = (before?.version ?? 0) + 1;
    const provenance: Provenance = { actor: this.config.actor ?? "agent", source: this.config.source ?? `goals:${scope.subject}`, timestamp: now, note: reason };
    const next: GoalInstance = {
      ...structuredClone(snapshot), scope, version, createdAt: before?.createdAt ?? now, updatedAt: now,
      history: [...(before?.history ?? []), { ...structuredClone(snapshot), version, kind, reason, provenance }],
    };
    const saved = await this.adapter.commit(scope, next, { ifVersion: before?.version ?? null });
    const status = projectGoalStatus(saved);
    try { await this.config.onChange?.(structuredClone(status)); }
    catch (error) { throw new GoalPostCommitError(status, error); }
    return status;
  }
}

/** The write succeeded; consumers must not blindly retry as if it rolled back. */
export class GoalPostCommitError extends Error {
  constructor(readonly status: GoalStatus, cause: unknown) {
    super(`Goal version ${status.version} was committed, but onChange failed`, { cause });
    this.name = "GoalPostCommitError";
  }
}
