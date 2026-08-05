import type { z } from "zod";
import type { DisplayManagerAdapter } from "glove-core";
import type { Provenance } from "../core/provenance";
import type { FormMemoryBridge } from "./bridge";

// ─── Gates ────────────────────────────────────────────────────────────────

/**
 * Read-only view of the instance a gate closure is allowed to consult.
 *
 * `S` is the union of step ids declared *so far* on the builder, so a gate
 * written on step three can only name steps one and two. Before any step is
 * declared the union is `never`, which would make `stepComplete` uncallable —
 * so the empty case widens back to `string`.
 */
export interface FormState<S extends string = string> {
  stepComplete(id: [S] extends [never] ? string : S): boolean;
  checkpointFired(id: string): boolean;
  complete: boolean;
}

/**
 * Applicability predicate. Sync, pure, cheap — the engine re-runs every gate
 * on every commit rather than tracking dependencies. A gate must never write,
 * await, or read the clock; the same values must always produce the same
 * answer.
 */
export type FormWhen<V, S extends string = string> = (
  values: Partial<V>,
  state: FormState<S>,
) => boolean;

// ─── Executors ────────────────────────────────────────────────────────────

/**
 * What an executor can hand back to the engine.
 *
 * - `patch` — derived values the executor computed. Committed as ordinary
 *   entries, so they re-run the gates and can themselves trigger hooks.
 * - `fail` — a blocking checkpoint rejecting. Recorded, and surfaced to the
 *   agent as a tool result it can act on. The instance unblocks either way.
 * - `jump` — force a step open. Escape hatch; ordering is otherwise derived.
 * - `complete` — force the instance complete regardless of pending fields.
 */
export type FormEffect<V> =
  | { patch: Partial<V> }
  | { fail: string }
  | { jump: string }
  | { complete: true };

export interface FormExecutorContext<V> {
  /** Live, valid values only. Held entries are never visible here. */
  values: V;
  instance: FormInstance;
  /** Prefixed hook id — `field:email`, `step:identity`, `checkpoint:conflict-check`, `form`. */
  hookId: string;
  /**
   * Stable across retries — `${instanceId}:${hookId}:${occurrence}`. Dispatch
   * is at-least-once; executors must be idempotent on this key.
   */
  idempotencyKey: string;
  /**
   * Bridges to the other memory subsystems. Always present; individual
   * methods throw if the subsystem they need wasn't wired into the runner.
   */
  memory: FormMemoryBridge;
  display?: DisplayManagerAdapter;
  signal?: AbortSignal;
}

/**
 * An executor may return one effect, several, or none. Several is what a
 * routing trigger needs — stamp a derived value *and* send the conversation
 * somewhere — and a single effect stays the common case.
 */
export type FormExecutorResult<V> = FormEffect<V> | FormEffect<V>[] | void;

export type FormExecutor<V> = (
  ctx: FormExecutorContext<V>,
) => Promise<FormExecutorResult<V>> | FormExecutorResult<V>;

// ─── Definition ───────────────────────────────────────────────────────────

export interface FieldConfig<T extends z.ZodTypeAny, V> {
  /**
   * The field's type, constraint, validator, and description, all at once.
   * Optionality is derived from it: a field is optional iff the schema
   * accepts `undefined`. There is deliberately no `required` flag to
   * disagree with.
   */
  schema: T;
  label: string;
  /** What a good answer looks like. Surfaced to the agent as `description`. */
  ask?: string;
  /** Extra constraint note, appended to `ask` in the projection. */
  hint?: string;
  /** Applicability. Absent means always applicable. */
  when?: FormWhen<V>;
  /** Fires when this field's entry crosses into the live set. */
  onFill?: FormExecutor<V>;
}

export interface StepConfig<V, S extends string = string> {
  title: string;
  /** Conversational instruction for the step as a whole. */
  ask?: string;
  /** One line naming what the step collects — the tier-0 `later:` hint. */
  preview?: string;
  /**
   * Ask-order gate. A step whose `when` is false is not opened — but its
   * fields stay writable, because writes are never gated (§2).
   */
  when?: FormWhen<V, S>;
}

export interface CheckpointConfig<V, S extends string = string> {
  /** Fires on the rising edge — the first commit where this holds. */
  when: FormWhen<V, S>;
  /** When true the instance goes `awaiting` while `run` is in flight. */
  blocking?: boolean;
  /** Shown in tier 0 while blocked. */
  waitMessage?: string;
  run: FormExecutor<V>;
}

export interface FieldDef<V = any> {
  id: string;
  schema: z.ZodTypeAny;
  label: string;
  ask?: string;
  hint?: string;
  when?: FormWhen<V>;
  onFill?: FormExecutor<V>;
}

export interface StepDef<V = any> {
  id: string;
  title: string;
  ask?: string;
  preview?: string;
  when?: FormWhen<V>;
  fields: FieldDef<V>[];
  onComplete?: FormExecutor<V>;
}

export interface CheckpointDef<V = any> {
  id: string;
  when: FormWhen<V>;
  blocking: boolean;
  waitMessage?: string;
  run: FormExecutor<V>;
}

/** Builder output. Plain data plus closures — never serialised, never stored. */
export interface FormDef<V = any, S extends string = string> {
  id: string;
  version: number;
  name: string;
  description: string;
  /** How to run the conversation. Injected with tier 0 while an instance is open. */
  conduct?: string;
  steps: StepDef<V>[];
  checkpoints: CheckpointDef<V>[];
  onComplete?: FormExecutor<V>;
  /** Carry values forward from an older instance instead of going stale. */
  migrate?: (old: unknown, fromVersion: number) => Partial<V>;
  /** Phantom — carries the step-id union so `FormSteps<D>` can read it. */
  readonly __steps?: S;
}

export type FormValues<B> = B extends { __values?: infer V } ? V : never;

// ─── Instances ────────────────────────────────────────────────────────────

/**
 * One answer, at one moment. Immutable once appended.
 *
 * A retraction is a revision too — `retracted: true` with no value — so
 * "the user took that back" and "the user changed it" are the same mechanism
 * and undo/redo need only move a cursor.
 */
export interface FormEntry {
  /** As supplied. Parsing happens on read so a def change re-judges old answers. */
  value: unknown;
  at: string;
  provenance: Provenance;
  /** Set when the entry last failed its field's schema. Kept, not discarded. */
  error?: string;
  /** This revision withdraws the answer rather than supplying one. */
  retracted?: boolean;
  /** Instance-wide monotonic order, so "undo the last thing" is unambiguous. */
  seq: number;
}

/**
 * Every answer ever given for one field, and which of them is in force.
 *
 * §5.1 says nothing is ever deleted. With one entry per field that was only
 * true of applicability changes — a revision overwrote its predecessor, and an
 * agentic eval caught models destroying good answers by writing `""` to
 * retract them. `revisions` is append-only; `cursor` is the only thing that
 * moves, which is what makes undo and redo pure pointer arithmetic over a log
 * that never loses anything.
 */
export interface FieldHistory {
  /** Oldest first. Append-only — nothing is ever removed or rewritten. */
  revisions: FormEntry[];
  /**
   * Index of the revision in force. `-1` means none — either the field was
   * never answered, or every revision has been undone.
   */
  cursor: number;
}

export interface DispatchState {
  hookId: string;
  status: "running" | "ok" | "failed";
  attempts: number;
  at: string;
  error?: string;
}

export type FormInstanceStatus =
  | "active"
  | "awaiting"
  | "complete"
  | "abandoned"
  | "stale";

export interface FormInstance {
  id: string;
  defId: string;
  /** Pinned at start. A mismatch against the registered def triggers §5.2. */
  defVersion: number;
  /** Conversation id / user id / matter id. */
  subject: string;
  status: FormInstanceStatus;
  /** The only answer storage: every answer ever given, keyed by field. */
  entries: Record<string, FieldHistory>;
  /** Source of `FormEntry.seq`. Monotonic across the whole instance. */
  revisionSeq: number;
  /** Rising-edge counters per hook id — the idempotency key's third segment. */
  occurrences: Record<string, number>;
  /** Keyed by idempotency key. */
  dispatches: Record<string, DispatchState>;
  /** Checkpoint id the instance is blocked on. */
  blockedOn?: string;
  /**
   * Step forced open by a `{ jump }` effect. Not in the design doc — `jump`
   * needs somewhere to land, and open-step selection is otherwise derived.
   *
   * Cleared by the next write that lands in that step, so a jump steers the
   * conversation once rather than pinning it there.
   */
  openStepOverride?: string;
  /** Reason recorded by `abandon`. */
  closedReason?: string;
  /** Optimistic concurrency. */
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface FormInstanceInput {
  defId: string;
  defVersion: number;
  subject: string;
  entries?: Record<string, FieldHistory>;
  status?: FormInstanceStatus;
}

/**
 * How one field's history changes in a commit. Revisions only ever append;
 * `cursor` is how undo, redo and retract express themselves.
 */
export interface FormEntryCommit {
  /** Appended in order, after the existing revisions. */
  append?: FormEntry[];
  /**
   * Absolute cursor to set once the appends have landed. Omit to point at the
   * last revision (the normal case for a write).
   */
  cursor?: number;
}

/**
 * One atomic write. Every field is optional; `entries`, `occurrences` and
 * `dispatches` merge key-by-key over what's stored, everything else replaces.
 * `null` on `blockedOn` / `openStepOverride` clears them.
 */
export interface FormInstanceCommit {
  entries?: Record<string, FormEntryCommit>;
  /** Replaces the instance counter after `entries` appends have taken their seqs. */
  revisionSeq?: number;
  occurrences?: Record<string, number>;
  dispatches?: Record<string, DispatchState>;
  status?: FormInstanceStatus;
  blockedOn?: string | null;
  openStepOverride?: string | null;
  closedReason?: string;
  defVersion?: number;
  completedAt?: string;
}

// ─── Projection ───────────────────────────────────────────────────────────

/** The entire agent-facing contract for a field. */
export interface FormFieldView {
  id: string;
  label: string;
  /** `ask` on the def, plus `hint` when both are set. */
  description?: string;
  /** Derived from the zod schema — "email address", "one of: a | b", "integer >= 1". */
  type: string;
  required: boolean;
  status: "empty" | "filled" | "invalid" | "held";
  /** Present when filled or held. */
  value?: unknown;
  /** Present when invalid. */
  error?: string;
  /** Steer toward this now. */
  ask: boolean;
}

export interface FormStepSummary {
  id: string;
  title: string;
  /** 1-based position in the def. */
  index: number;
  preview?: string;
  /** Applicable required fields in this step. */
  required: number;
  /** Applicable required fields that are valid. */
  filled: number;
  complete: boolean;
  /** False when the step's ask-order gate doesn't hold yet. */
  open: boolean;
}

export interface FormFailure {
  hookId: string;
  message: string;
  at: string;
}

export type FormViewScope =
  | { scope: "step"; id?: string }
  | { scope: "field"; id: string }
  | { scope: "outline" };

/** Flat field rows plus just enough framing to place them. */
export interface FormView {
  instanceId: string;
  defId: string;
  defVersion: number;
  name: string;
  status: FormInstanceStatus;
  conduct?: string;
  scope: "step" | "field" | "outline";
  step?: { id: string; title: string; index: number; of: number; ask?: string };
  fields: FormFieldView[];
  /** Outline scope only. */
  steps?: FormStepSummary[];
  /**
   * A trigger sent the conversation back to a step that was already finished.
   * Its answers are shown as `filled` *and* `ask: true` — go through them
   * again rather than treating them as settled.
   */
  revisiting?: boolean;
  complete: boolean;
  blockedOn?: string;
  waitMessage?: string;
  /** Blocking-checkpoint rejections the agent hasn't acted on yet. */
  failures?: FormFailure[];
  /**
   * What undo and redo would do right now. One line at the view level rather
   * than a flag on every field row — the agent needs to know the move exists,
   * not to audit each field's depth, and per-row flags would be re-sent on
   * every call for the sake of a rarely-used verb.
   */
  undo?: FormUndoTarget;
  redo?: FormUndoTarget;
}

export interface FormUndoTarget {
  field: string;
  label: string;
  /** What the field would read after the move. Absent when it would go empty. */
  becomes?: unknown;
}

/** One field's answer history, oldest first, as the agent sees it. */
export interface FormFieldHistoryView {
  field: string;
  label: string;
  revisions: Array<{
    value?: unknown;
    at: string;
    retracted?: boolean;
    invalid?: boolean;
    /** True for the revision currently in force. */
    inForce: boolean;
  }>;
}

/**
 * A field id the form doesn't declare. `didYouMean` is what makes the miss
 * self-correcting: without it the model has nothing to go on but another
 * guess, and a wasted round trip is the most common friction on this surface.
 */
export interface FormUnknownField {
  field: string;
  didYouMean: string[];
}

/** One `ZodIssue`, flattened for a tool result. */
export interface FormFieldIssue {
  field: string;
  message: string;
  hint?: string;
}
