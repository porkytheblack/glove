import { z } from "zod";
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
export const GoalDefinitionSchema = z.object({
  key: GoalKeySchema,
  title: z.string().trim().min(1).max(1000),
  objective: z.string().trim().min(1).max(4000),
  items: z.array(GoalItemDefinitionSchema).min(1).max(100),
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
    const items = new Set<string>();
    for (const item of goal.items) {
      if (items.has(item.key)) ctx.addIssue({ code: "custom", message: `Duplicate item key: ${goal.key}/${item.key}` });
      items.add(item.key);
      if (item.locked && (item.retired || goal.retired)) ctx.addIssue({ code: "custom", message: "Locked items cannot be retired" });
    }
    if (goal.locked && goal.retired) ctx.addIssue({ code: "custom", message: "Locked goals cannot be retired" });
  }
});
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
  disposition: GoalItemDisposition;
  /** Deferred/declined settles progression, but does not mean work was done. */
  done: boolean;
  note: string | null;
  at: string;
}
export type GoalProgress = Record<string, Record<string, GoalItemState>>;
export interface GoalSnapshot {
  program: GoalProgram;
  /** Retained even for removed/retired definitions; keys must not be repurposed. */
  progress: GoalProgress;
}
export interface GoalRevision extends GoalSnapshot {
  version: number;
  kind: "start" | "revise" | "update";
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
  status: "active" | "pending" | "completed" | "retired";
  items: Array<{ definition: GoalItemDefinition; state: GoalItemState | null }>;
}
export interface GoalStatus {
  scope: GoalScope;
  version: number;
  programKey: string;
  status: "active" | "completed";
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
