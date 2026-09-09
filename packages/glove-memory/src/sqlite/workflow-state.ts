import { z } from "zod";
import { FactInputSchema, FactRefSchema, FactScopeSchema, type FactState } from "glove-facts";
import { GoalProgramSchema, GoalScopeSchema } from "../goals/types";
import type { GoalMemoryState } from "../in-memory/goals";
import type { FormMemoryState } from "../in-memory/forms";
import { ProvenanceSchema } from "../core/provenance";

const key = z.string().min(1);
const version = z.number().int().nonnegative();
const record = z.record(z.string(), z.unknown());
// Validate storage structure without stripping audit fields or old schema values.
function preserving<T>(schema: z.ZodType): z.ZodType<T> {
  return z.custom<T>(value => schema.safeParse(value).success, "Invalid persisted workflow state");
}
const goalSnapshot = z.object({ program: GoalProgramSchema,
  progress: z.record(z.string(), z.record(z.string(), z.object({
    disposition: z.enum(["pending", "done", "deferred", "declined"]), done: z.boolean(), note: z.string().nullable(), at: z.string(),
  }).passthrough())),
}).passthrough();
export const goalState = preserving<GoalMemoryState>(z.object({
  instances: z.array(z.tuple([key, goalSnapshot.extend({ scope: GoalScopeSchema, version: version.min(1),
    createdAt: z.string(), updatedAt: z.string(), history: z.array(goalSnapshot.extend({ version: version.min(1), kind: z.enum(["start", "revise", "update"]), reason: z.string(), provenance: ProvenanceSchema })),
  })])),
  dispatches: z.array(z.tuple([key, z.array(z.tuple([key, z.object({ transitionId: key, owner: key,
    state: z.enum(["running", "completed", "failed"]), attempts: version.min(1), leaseUntil: z.number().finite(),
  }).passthrough()]))])),
}).strict().refine(s => new Set(s.instances.map(([k]) => k)).size === s.instances.length &&
  s.instances.every(([k, v]) => k === JSON.stringify([v.scope.subject, v.scope.key, v.scope.agent ?? null]))));

export const formState = preserving<FormMemoryState>(z.object({ nextId: version.min(1), instances: z.array(z.object({
  id: key, defId: key, defVersion: version.min(1), subject: key,
  status: z.enum(["active", "awaiting", "complete", "abandoned", "stale"]),
  entries: z.record(z.string(), z.object({ revisions: z.array(z.object({ seq: version, value: z.unknown(), at: z.string(), provenance: ProvenanceSchema }).passthrough()), cursor: z.number().int().min(-1) }).refine(h => h.cursor < h.revisions.length)),
  revisionSeq: version, occurrences: z.record(z.string(), version),
  dispatches: z.record(z.string(), z.object({ hookId: key, status: z.enum(["running", "ok", "failed"]), attempts: version, at: z.string(), effects: z.array(record).optional() }).passthrough()),
  version: version.min(1), createdAt: z.string(), updatedAt: z.string(),
  pendingHooks: z.record(z.string(), z.object({ id: key, defVersion: version.min(1),
    hooks: z.array(z.object({ hookId: key, kind: z.enum(["field", "step", "checkpoint", "form"]), id: key, blocking: z.boolean(), occurrence: version })),
    values: record, live: z.array(z.string()), stepComplete: z.record(z.string(), z.boolean()), complete: z.boolean(),
    priorOccurrences: z.record(z.string(), version), newFields: z.array(z.string()), provenance: ProvenanceSchema,
  }).passthrough()).optional(),
}).passthrough()) }).strict().refine(s => new Set(s.instances.map(f => f.id)).size === s.instances.length));

export const factState = preserving<FactState>(z.object({ version,
  facts: z.array(FactInputSchema.extend({ id: key, revision: version.min(1), scope: FactScopeSchema,
    verification: z.enum(["unverified", "verified", "ambiguous", "conflicted"]), urgent: z.boolean(),
    observedAt: z.string(), supersedes: FactRefSchema.optional(),
  })),
  claims: z.array(z.object({ id: key, consumer: key, requirement: key, criteria: z.string(), refs: z.array(FactRefSchema),
    derivation: z.enum(["explicit", "synthesized"]), strength: z.enum(["sufficient", "confirmation", "missing", "conflict"]),
    explanation: z.string(), state: z.enum(["proposed", "accepted"]),
  }).passthrough()),
  operations: z.record(z.string(), z.object({ fingerprint: z.string(), ref: FactRefSchema })),
}).strict());
