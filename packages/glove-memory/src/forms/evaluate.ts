import type { CompiledForm } from "./compile";
import type { FormFieldView, FormInstance, FormState } from "./types";

export interface FieldEvaluation {
  id: string;
  /** The field's gate holds under the settled live set. */
  applicable: boolean;
  hasEntry: boolean;
  /** Entry exists, is applicable, and parses. */
  valid: boolean;
  /** Parsed output. Present when valid. */
  value?: unknown;
  /** As stored. Present whenever an entry exists. */
  raw?: unknown;
  error?: string;
  status: FormFieldView["status"];
}

export interface FormEvaluation<V = any> {
  /** Live entries that parse — what counts for completion and what executors see. */
  values: Partial<V>;
  /** Entries whose field isn't applicable right now. Kept, doesn't count. */
  held: Record<string, unknown>;
  fields: Map<string, FieldEvaluation>;
  /** Field ids that are live *and* valid — the set `onFill` transitions read. */
  live: Set<string>;
  stepComplete: Record<string, boolean>;
  /** The step's ask-order gate holds. */
  stepOpen: Record<string, boolean>;
  openStepId?: string;
  complete: boolean;
  /** Checkpoints whose `when` currently holds. */
  checkpointActive: Record<string, boolean>;
  /** Repartition passes taken. One in the common case. */
  passes: number;
  /**
   * Gates that threw or a repartition that never settled. Reads tolerate
   * these (the field is treated as applicable); commits raise them.
   */
  defects: string[];
}

/**
 * Recompute the live set and everything derived from it (§5.1).
 *
 * Not a data move — no writes to `entries`, just a recomputed projection,
 * and it starts fresh from "assume every entry is live" on every call. That
 * restart is what makes a correction recoverable: flip `incidentType` back to
 * `vehicle` and `vehicleCount`'s original answer is live again.
 *
 *   1. Assume every entry is live.
 *   2. Evaluate each field's `when` against the current live projection.
 *   3. Drop any entry whose `when` returned false.
 *   4. Repeat from 2 until the live set stops shrinking.
 *
 * Shrink-only, so the pass count is bounded by the field count and it always
 * terminates. The tradeoff is documented in §2.1: a gate written as a
 * *negation* of another field's presence (`(v) => !v.x`) can settle somewhere
 * a from-empty evaluation would have scored differently. Such gates are
 * discouraged.
 */
export function evaluateForm<V extends Record<string, unknown>>(
  compiled: CompiledForm<V>,
  instance: FormInstance,
): FormEvaluation<V> {
  // Parse once. Schemas are pure, and every pass asks the same question.
  const parsed = new Map<string, { ok: boolean; value?: unknown; error?: string }>();
  for (const field of compiled.fields) {
    const entry = instance.entries[field.id];
    if (entry === undefined) continue;
    const result = field.schema.safeParse(entry.value);
    parsed.set(
      field.id,
      result.success
        ? { ok: true, value: result.data }
        : { ok: false, error: formatZodError(result.error) },
    );
  }

  const defects: string[] = [];
  let excluded = new Set<string>();
  let pass = runPass(compiled, instance, parsed, excluded, defects);
  let passes = 1;
  const cap = compiled.fields.length + 1;

  for (;;) {
    const next = new Set(excluded);
    for (const field of compiled.fields) {
      if (instance.entries[field.id] === undefined) continue;
      if (next.has(field.id)) continue;
      if (!pass.isApplicable(field.id)) next.add(field.id);
    }
    if (next.size === excluded.size) break;
    excluded = next;
    pass = runPass(compiled, instance, parsed, excluded, defects);
    passes++;
    if (passes > cap) {
      defects.push(
        `repartition did not settle after ${cap} passes (${compiled.fields.length} fields)`,
      );
      break;
    }
  }

  // ─── Materialise ────────────────────────────────────────────────────────

  const fields = new Map<string, FieldEvaluation>();
  const values: Record<string, unknown> = {};
  const held: Record<string, unknown> = {};
  const live = new Set<string>();

  for (const field of compiled.fields) {
    const entry = instance.entries[field.id];
    const hasEntry = entry !== undefined;
    const applicable = pass.isApplicable(field.id);
    const p = parsed.get(field.id);
    const valid = hasEntry && applicable && p?.ok === true;

    let status: FormFieldView["status"];
    if (!hasEntry) status = "empty";
    else if (!applicable) status = "held";
    else if (!p?.ok) status = "invalid";
    else status = "filled";

    if (valid) {
      values[field.id] = p!.value;
      live.add(field.id);
    } else if (hasEntry && !applicable) {
      held[field.id] = entry!.value;
    }

    fields.set(field.id, {
      id: field.id,
      applicable,
      hasEntry,
      valid,
      value: p?.ok ? p.value : undefined,
      raw: hasEntry ? entry!.value : undefined,
      error: p && !p.ok ? p.error : undefined,
      status,
    });
  }

  const stepComplete: Record<string, boolean> = {};
  const stepOpen: Record<string, boolean> = {};
  for (const step of compiled.steps) {
    stepComplete[step.id] = pass.isStepComplete(step.id);
    stepOpen[step.id] = pass.isStepOpen(step.id);
  }

  const checkpointActive: Record<string, boolean> = {};
  for (const cp of compiled.checkpoints) {
    checkpointActive[cp.id] = pass.gate(cp.id, cp.when);
  }

  return {
    values: values as Partial<V>,
    held,
    fields,
    live,
    stepComplete,
    stepOpen,
    openStepId: pickOpenStep(compiled, instance, stepComplete, stepOpen),
    complete: pass.isComplete(),
    checkpointActive,
    passes,
    defects,
  };
}

/**
 * Ask order is derived, not stored: the first incomplete step whose gate
 * holds. A `{ jump }` effect is the one thing that overrides it, and only
 * while the jumped-to step is still incomplete.
 *
 * If no step qualifies — every gate that holds is complete, and the ones that
 * remain are gated off — fall back to the first incomplete step regardless of
 * its gate. A form that isn't complete but has nothing to ask is a stuck
 * conversation, and a mis-written gate shouldn't be able to produce one.
 */
function pickOpenStep(
  compiled: CompiledForm<any>,
  instance: FormInstance,
  stepComplete: Record<string, boolean>,
  stepOpen: Record<string, boolean>,
): string | undefined {
  const override = instance.openStepOverride;
  if (override && compiled.stepById.has(override) && !stepComplete[override]) {
    return override;
  }
  for (const step of compiled.steps) {
    if (stepOpen[step.id] && !stepComplete[step.id]) return step.id;
  }
  for (const step of compiled.steps) {
    if (!stepComplete[step.id]) return step.id;
  }
  return undefined;
}

// ─── One pass ─────────────────────────────────────────────────────────────

interface Pass {
  values: Record<string, unknown>;
  isApplicable(fieldId: string): boolean;
  isStepComplete(stepId: string): boolean;
  isStepOpen(stepId: string): boolean;
  isComplete(): boolean;
  gate(id: string, when: (v: any, s: FormState) => boolean): boolean;
}

function runPass(
  compiled: CompiledForm<any>,
  instance: FormInstance,
  parsed: Map<string, { ok: boolean; value?: unknown; error?: string }>,
  excluded: Set<string>,
  defects: string[],
): Pass {
  const values: Record<string, unknown> = {};
  for (const field of compiled.fields) {
    if (excluded.has(field.id)) continue;
    const p = parsed.get(field.id);
    if (p?.ok) values[field.id] = p.value;
  }

  const applicableMemo = new Map<string, boolean>();
  const stepMemo = new Map<string, boolean>();
  const inFlight = new Set<string>();

  const isValid = (fieldId: string): boolean =>
    !excluded.has(fieldId) && parsed.get(fieldId)?.ok === true;

  function guard<T>(key: string, fallback: T, compute: () => T): T {
    // A gate that reads `stepComplete`, which reads applicability, which
    // reads the same gate. Not a definition error — the optimistic answer is
    // exactly the one the "assume every entry is live" start already made.
    if (inFlight.has(key)) return fallback;
    inFlight.add(key);
    try {
      return compute();
    } finally {
      inFlight.delete(key);
    }
  }

  const pass: Pass = {
    values,

    gate(id, when) {
      return guard(`gate:${id}`, true, () => {
        try {
          return Boolean(when(values, state));
        } catch (e) {
          defects.push(`gate "${id}" threw: ${e instanceof Error ? e.message : String(e)}`);
          return true;
        }
      });
    },

    isApplicable(fieldId) {
      const memo = applicableMemo.get(fieldId);
      if (memo !== undefined) return memo;
      if (excluded.has(fieldId)) {
        applicableMemo.set(fieldId, false);
        return false;
      }
      const field = compiled.fieldById.get(fieldId);
      if (!field) return false;
      if (!field.when) {
        applicableMemo.set(fieldId, true);
        return true;
      }
      const result = pass.gate(fieldId, field.when);
      // Only memoise a settled answer — a re-entrant call returns the
      // optimistic fallback, which mustn't be cached over the real one.
      if (!inFlight.has(`gate:${fieldId}`)) applicableMemo.set(fieldId, result);
      return result;
    },

    isStepComplete(stepId) {
      const memo = stepMemo.get(stepId);
      if (memo !== undefined) return memo;
      const step = compiled.stepById.get(stepId);
      if (!step) return false;
      const result = guard(`step:${stepId}`, false, () => {
        for (const fieldId of step.fieldIds) {
          const field = compiled.fieldById.get(fieldId);
          if (!field?.required) continue;
          if (!pass.isApplicable(fieldId)) continue;
          if (!isValid(fieldId)) return false;
        }
        return true;
      });
      if (!inFlight.has(`step:${stepId}`)) stepMemo.set(stepId, result);
      return result;
    },

    isStepOpen(stepId) {
      const step = compiled.stepById.get(stepId);
      if (!step) return false;
      if (!step.when) return true;
      return pass.gate(`step-gate:${stepId}`, step.when);
    },

    isComplete() {
      return guard("form:complete", false, () => {
        for (const field of compiled.fields) {
          if (!field.required) continue;
          if (!pass.isApplicable(field.id)) continue;
          if (!isValid(field.id)) return false;
        }
        return true;
      });
    },
  };

  const state: FormState = {
    stepComplete: (id: string) => pass.isStepComplete(id),
    checkpointFired: (id: string) => (instance.occurrences[`checkpoint:${id}`] ?? 0) > 0,
    get complete() {
      return pass.isComplete();
    },
  } as FormState;

  return pass;
}

/** One line per issue, path-qualified. Zod's own message, not a rewrite of it. */
export function formatZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
