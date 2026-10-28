import type { PreparationReport } from "glove-facts";
import { z } from "zod";
import type { GoalTransition } from "./lifecycle";
import type { Provenance } from "../core/provenance";

// Keys are durable identities, not labels. Exclude prototype keys because
// progress is a JSON object, including when reconstructed by a SQL adapter.
const reservedKeys = new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype"]);
export const GoalKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/)
  .refine((key) => !reservedKeys.has(key), "Reserved key");
export const GoalItemDefinitionSchema = z.object({
  key: GoalKeySchema,
  label: z.string().trim().min(1).max(1000),
  /** Locked obligations cannot be edited, removed, or retired by revisions. */
  locked: z.boolean().optional(),
  retired: z.boolean().optional(),
}).strict();
/**
 * A lazy goal is shown for a fixed number of user turns, then drops off on its
 * own: no tool call settles it. It sits beside the ordered program rather than
 * taking the active slot, so it never blocks the goals after it.
 */
export const GoalLazySchema = z.object({
  /** User turns that start while the goal is shown, counting from when it first appears. */
  turns: z.number().int().min(1).max(100),
}).strict();
export const GoalDefinitionSchema = z.object({
  key: GoalKeySchema,
  title: z.string().trim().min(1).max(1000),
  objective: z.string().trim().min(1).max(4000),
  /** At least one item, except for lazy goals, which may be objective-only. */
  items: z.array(GoalItemDefinitionSchema).max(100),
  lazy: GoalLazySchema.optional(),
  locked: z.boolean().optional(),
  retired: z.boolean().optional(),
}).strict();
export const GoalProgramSchema = z.object({
  key: GoalKeySchema,
  goals: z.array(GoalDefinitionSchema).max(100),
}).strict().superRefine((program, ctx) => {
  const keys = new Set<string>();
  for (const goal of program.goals) {
    if (keys.has(goal.key)) ctx.addIssue({ code: "custom", message: `Duplicate goal key: ${goal.key}` });
    keys.add(goal.key);
    if (!goal.items.length && !goal.lazy) ctx.addIssue({ code: "custom", message: `Goal ${goal.key} needs at least one item` });
    const items = new Set<string>();
    for (const item of goal.items) {
      if (items.has(item.key)) ctx.addIssue({ code: "custom", message: `Duplicate item key: ${goal.key}/${item.key}` });
      items.add(item.key);
      if (item.locked && (item.retired || goal.retired)) ctx.addIssue({ code: "custom", message: "Locked items cannot be retired" });
    }
    if (goal.locked && goal.retired) ctx.addIssue({ code: "custom", message: "Locked goals cannot be retired" });
  }
});
export type GoalLazy = z.infer<typeof GoalLazySchema>;
export type GoalItemDefinition = z.infer<typeof GoalItemDefinitionSchema>;
export type GoalDefinition = z.infer<typeof GoalDefinitionSchema>;
export type GoalProgram = z.infer<typeof GoalProgramSchema>;
export function defineGoalProgram(program: GoalProgram): GoalProgram {
  return GoalProgramSchema.parse(program);
}

/** All three fields are part of the storage identity. Hosts own tenancy/auth. */
export const GoalScopeSchema = z.object({
  subject: z.string().trim().min(1).max(512),
  key: GoalKeySchema,
  agent: z.string().trim().min(1).max(512).optional(),
}).strict();
export type GoalScope = z.infer<typeof GoalScopeSchema>;
export type GoalItemDisposition = "pending" | "done" | "deferred" | "declined";
export interface GoalItemState {
  /** Exact shared evidence claim committed with this state. */
  claimId?: string;
  disposition: GoalItemDisposition;
  /** Deferred/declined settles progression, but does not mean work was done. */
  done: boolean;
  note: string | null;
  at: string;
}
export type GoalProgress = Record<string, Record<string, GoalItemState>>;
/** Per lazy goal key: user turns that started while it was shown. */
export type GoalLazyProgress = Record<string, { seen: number }>;
export interface GoalSnapshot {
  preparation?: PreparationReport;
  program: GoalProgram;
  /** Retained even for removed/retired definitions; keys must not be repurposed. */
  progress: GoalProgress;
  /** Absent until a lazy goal has been shown for a turn. */
  lazy?: GoalLazyProgress;
}
export interface GoalRevision extends GoalSnapshot {
  /** Persisted atomically with progress. Absent on pre-lifecycle records. */
  transitions?: GoalTransition[];
  version: number;
  /** "turn" records a user turn passing while lazy goals were shown. */
  kind: "start" | "revise" | "update" | "turn";
  reason: string;
  provenance: Provenance;
}
export interface GoalInstance extends GoalSnapshot {
  scope: GoalScope;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Complete snapshots, appended atomically with each state change. */
  history: GoalRevision[];
}
export interface GoalView {
  definition: GoalDefinition;
  ordinal: number;
  /** A shown lazy goal is "active" without being activeGoal; one past its turns is "expired". */
  status: "active" | "pending" | "completed" | "expired" | "retired";
  items: Array<{ definition: GoalItemDefinition; state: GoalItemState | null }>;
  /** Lazy goals only. remaining counts turns that will still start with it shown. */
  lazy?: { turns: number; seen: number; remaining: number };
}
export interface GoalStatus {
  preparation?: PreparationReport;
  scope: GoalScope;
  version: number;
  programKey: string;
  /** "active" while a sequential goal is unsettled or a lazy goal is still shown. */
  status: "active" | "completed";
  /** The sequential goal in progress. Lazy goals never take this slot. */
  activeGoal: string | null;
  goals: GoalView[];
  /** Includes outstanding deferrals in removed/retired goals and items. */
  deferred: Array<{ goalKey: string; itemKey: string; label: string; note: string | null; retired: boolean }>;
}
export const GoalUpdateSchema = z.object({
  goalKey: GoalKeySchema,
  completed: z.array(GoalKeySchema).max(100).optional(),
  deferred: z.array(GoalKeySchema).max(100).optional(),
  declined: z.array(GoalKeySchema).max(100).optional(),
  reopened: z.array(GoalKeySchema).max(100).optional(),
  reason: z.string().trim().min(1).max(4000),
  ifVersion: z.number().int().positive().optional(),
}).strict().superRefine((input, ctx) => {
  const all = [...(input.completed ?? []), ...(input.deferred ?? []), ...(input.declined ?? []), ...(input.reopened ?? [])];
  if (!all.length) ctx.addIssue({ code: "custom", message: "Supply at least one item key" });
  if (new Set(all).size !== all.length) ctx.addIssue({ code: "custom", message: "Each item key may appear only once" });
});
export type GoalUpdateInput = z.infer<typeof GoalUpdateSchema>;
