import type { z } from "zod";
import { FormDefinitionError } from "../core/errors";
import { describeType } from "./describe-type";
import type {
  CheckpointDef,
  FormDef,
  FormExecutor,
  FormWhen,
} from "./types";

export interface CompiledField<V = any> {
  id: string;
  stepId: string;
  label: string;
  /** `ask` plus `hint`, joined — what the agent reads as `description`. */
  description?: string;
  /** Rendered from the schema by `describeType`. */
  type: string;
  /** Derived: false iff the schema accepts `undefined`. Never declared. */
  required: boolean;
  schema: z.ZodTypeAny;
  when?: FormWhen<V>;
  onFill?: FormExecutor<V>;
  /** Position across the whole form, not within the step. */
  order: number;
}

export interface CompiledStep<V = any> {
  id: string;
  title: string;
  ask?: string;
  preview?: string;
  /** 1-based. */
  index: number;
  when?: FormWhen<V>;
  fieldIds: string[];
  onComplete?: FormExecutor<V>;
}

export interface CompiledCheckpoint<V = any> extends CheckpointDef<V> {
  index: number;
}

/**
 * Flattened field / step index built once at registration and cached. The
 * agent never sees this — it reads `projectView` output.
 */
export interface CompiledForm<V = any> {
  def: FormDef<V>;
  id: string;
  version: number;
  name: string;
  description: string;
  conduct?: string;
  /** Declaration order across the whole form. */
  fields: CompiledField<V>[];
  fieldById: Map<string, CompiledField<V>>;
  /**
   * Normalised id *and* label → field id. Models reach for `full_name`,
   * `Full name` and `fullName` interchangeably; all three land on the same
   * field rather than costing a round trip. Built at compile time so the
   * lookup is free.
   */
  aliasIndex: Map<string, string>;
  steps: CompiledStep<V>[];
  stepById: Map<string, CompiledStep<V>>;
  checkpoints: CompiledCheckpoint<V>[];
  checkpointById: Map<string, CompiledCheckpoint<V>>;
  onComplete?: FormExecutor<V>;
  migrate?: FormDef<V>["migrate"];
}

/**
 * Flatten a def into the index the engine runs against. Rejects collisions
 * here rather than at the first commit — a form with two fields called
 * `email` has no defensible behaviour, and registration is where the
 * developer is looking.
 *
 * Field ids are unique across the *whole form*, not per step. The flat
 * namespace is what lets `values` and every gate closure stay simple, and
 * what lets `glove_form_fill` take any field id without a step qualifier.
 */
export function compileForm<V extends Record<string, unknown>>(
  def: FormDef<V, any>,
): CompiledForm<V> {
  if (!def.id) {
    throw new FormDefinitionError("A form definition needs an id.");
  }
  if (!Number.isInteger(def.version)) {
    throw new FormDefinitionError(
      `Form "${def.id}" needs an integer version — instances pin it at start.`,
    );
  }

  const fields: CompiledField<V>[] = [];
  const fieldById = new Map<string, CompiledField<V>>();
  const steps: CompiledStep<V>[] = [];
  const stepById = new Map<string, CompiledStep<V>>();

  const duplicateSteps: string[] = [];
  const duplicateFields: string[] = [];

  def.steps.forEach((step, i) => {
    if (stepById.has(step.id)) {
      duplicateSteps.push(step.id);
      return;
    }
    const fieldIds: string[] = [];
    for (const field of step.fields) {
      if (fieldById.has(field.id)) {
        duplicateFields.push(field.id);
        continue;
      }
      const compiled: CompiledField<V> = {
        id: field.id,
        stepId: step.id,
        label: field.label,
        description: joinDescription(field.ask, field.hint),
        type: safeDescribe(field.schema),
        required: !acceptsUndefined(field.schema),
        schema: field.schema,
        when: field.when as FormWhen<V> | undefined,
        onFill: field.onFill as FormExecutor<V> | undefined,
        order: fields.length,
      };
      fields.push(compiled);
      fieldById.set(field.id, compiled);
      fieldIds.push(field.id);
    }
    const compiledStep: CompiledStep<V> = {
      id: step.id,
      title: step.title,
      ask: step.ask,
      preview: step.preview,
      index: i + 1,
      when: step.when as FormWhen<V> | undefined,
      fieldIds,
      onComplete: step.onComplete as FormExecutor<V> | undefined,
    };
    steps.push(compiledStep);
    stepById.set(step.id, compiledStep);
  });

  if (duplicateFields.length > 0) {
    throw new FormDefinitionError(
      `Form "${def.id}" declares duplicate field ids: ${unique(duplicateFields).join(", ")}. Field ids are unique across the whole form, not per step.`,
      unique(duplicateFields),
    );
  }
  if (duplicateSteps.length > 0) {
    throw new FormDefinitionError(
      `Form "${def.id}" declares duplicate step ids: ${unique(duplicateSteps).join(", ")}.`,
      unique(duplicateSteps),
    );
  }

  // Two fields whose ids or labels normalise the same would make alias
  // resolution ambiguous, and silently writing to the wrong one is worse than
  // any round trip it would have saved.
  const aliasIndex = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const field of fields) {
    for (const candidate of [field.id, field.label]) {
      // Including the field's *own* normalised id matters: `Email` and
      // `email` differ, and skipping the self-entry as redundant is exactly
      // what makes the commonest case — a capitalised id — miss.
      const key = normaliseAlias(candidate);
      if (!key) continue;
      const existing = aliasIndex.get(key);
      if (existing && existing !== field.id) {
        ambiguous.push(`${existing}/${field.id} both normalise to "${key}"`);
        continue;
      }
      aliasIndex.set(key, field.id);
    }
  }
  if (ambiguous.length > 0) {
    throw new FormDefinitionError(
      `Form "${def.id}" has fields that can't be told apart once case and punctuation are ignored: ${ambiguous.join("; ")}.`,
      unique(ambiguous),
    );
  }

  const checkpoints: CompiledCheckpoint<V>[] = [];
  const checkpointById = new Map<string, CompiledCheckpoint<V>>();
  const duplicateCheckpoints: string[] = [];
  def.checkpoints.forEach((cp, i) => {
    if (checkpointById.has(cp.id)) {
      duplicateCheckpoints.push(cp.id);
      return;
    }
    const compiled: CompiledCheckpoint<V> = { ...cp, index: i };
    checkpoints.push(compiled);
    checkpointById.set(cp.id, compiled);
  });
  if (duplicateCheckpoints.length > 0) {
    throw new FormDefinitionError(
      `Form "${def.id}" declares duplicate checkpoint ids: ${unique(duplicateCheckpoints).join(", ")}.`,
      unique(duplicateCheckpoints),
    );
  }

  if (fields.length === 0) {
    throw new FormDefinitionError(`Form "${def.id}" declares no fields.`, [def.id]);
  }

  return {
    def,
    id: def.id,
    version: def.version,
    name: def.name,
    description: def.description,
    conduct: def.conduct,
    fields,
    fieldById,
    aliasIndex,
    steps,
    stepById,
    checkpoints,
    checkpointById,
    onComplete: def.onComplete,
    migrate: def.migrate,
  };
}

/**
 * §1.1 — optionality comes from zod, not a flag. A field is optional iff its
 * schema accepts `undefined`, which is the same predicate the inferred values
 * type is built from, so the two can never disagree.
 */
export function acceptsUndefined(schema: z.ZodTypeAny): boolean {
  try {
    return schema.safeParse(undefined).success;
  } catch {
    return false;
  }
}

function safeDescribe(schema: z.ZodTypeAny): string {
  try {
    return describeType(schema);
  } catch {
    return "value";
  }
}

function joinDescription(ask?: string, hint?: string): string | undefined {
  if (ask && hint) return `${ask} ${hint}`;
  return ask ?? hint;
}

/** Case and punctuation carry no meaning in a field id; everything else does. */
export function normaliseAlias(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
