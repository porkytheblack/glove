import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  DispatchState,
  FormInstance,
  FormInstanceCommit,
  FormInstanceInput,
  FormInstanceStatus,
} from "./types";

export interface FormInstanceQuery {
  /** Exact match. The runner's primary lookup — worth an index. */
  subject?: string;
  defId?: string;
  status?: FormInstanceStatus;
  /** Cap on rows returned. Absent means all. */
  limit?: number;
}

/**
 * Storage-agnostic contract for form instances.
 *
 * **Instances are the only thing the adapter stores.** Definitions are code —
 * zod schemas, gate closures and executors don't serialise, and there is no
 * JSON compile target to store instead. No def table, no schema versioning, no
 * migration primitives beyond the version number an instance pins at start.
 *
 * ## What this contract asks of you
 *
 * Store and retrieve. The engine holds all the semantics — liveness,
 * applicability, rising edges, completion — and recomputes them from what you
 * hand back. An adapter that persists `FormInstance` faithfully and honours
 * the four invariants below is a correct adapter, whatever it is built on.
 *
 * 1. **`entries` appends, never replaces.** `commitInstance` receives a
 *    `FormEntryCommit` per field, not a `FieldHistory`. Its `append` goes on
 *    the end of that field's existing `revisions`; its `cursor` moves the
 *    pointer. Overwriting a field's log — or dropping revisions the cursor
 *    isn't pointing at — destroys answers the design guarantees are kept.
 *    `applyEntryCommit` in `./history` does exactly this and is exported so
 *    you don't have to reimplement it.
 * 2. **`version` is compare-and-set.** `commitInstance` must reject when the
 *    stored version isn't `ifVersion`, by throwing `FormConflictError`, and
 *    must increment `version` on every write that lands. The runner retries a
 *    conflict a few times; it relies on losing, not on winning.
 * 3. **A commit is all-or-nothing.** Entries, occurrence counters, dispatch
 *    log and status either all land or none do. This is what makes
 *    commit-then-run dispatch safe: an answer is durable before any executor
 *    sees it, so a crash mid-executor replays the hook instead of losing the
 *    answer.
 * 4. **Reads hand back snapshots.** The engine treats a returned
 *    `FormInstance` as its own. If your store can return live references —
 *    an in-process Map, a cache — clone on the way out.
 *
 * ## What is yours to decide
 *
 * Everything else, deliberately:
 *
 * - **Storage engine and schema.** One JSON blob per instance, a row per
 *   revision, an event log — the contract doesn't care.
 * - **Indexing.** `findInstances` is queried by `subject` far more than
 *   anything else; index to taste.
 * - **Retention.** Nothing prunes `entries`, `dispatches` or completed
 *   instances. If you need a retention policy, that's a decision about your
 *   data, not about forms.
 * - **How you achieve atomicity and CAS** — a transaction, an optimistic
 *   `WHERE version = ?`, a document-level compare — only the observable
 *   behaviour in (2) and (3) is specified.
 * - **Whether `recordDispatch` is durable or best-effort.** See its note.
 * - **Provenance.** Every write carries it. Keep as much history as you want,
 *   or only the latest; the engine never reads it back.
 * - **Multi-tenancy, encryption, soft deletes, auditing.** Not modelled here.
 *
 * `InMemoryFormAdapter` is the reference implementation and is deliberately
 * short — it is a reasonable thing to read end to end before writing your own.
 */
export interface FormAdapter {
  /** Stable name for this adapter instance. Diagnostics only. */
  identifier: string;
  /**
   * The shared ontology object. Forms don't read it today — it is here so a
   * form adapter can sit alongside the other four subsystems on one schema,
   * and so executors bridging into entity/episodic have it to hand.
   */
  schema: MemorySchema;

  /**
   * Create and persist a new instance.
   *
   * Assign the id. Set `version` to 1, `createdAt`/`updatedAt` to now, and
   * `occurrences`/`dispatches` to empty. `input.entries` is normally absent;
   * when present (a seeded or migrated instance) persist it as given and set
   * `revisionSeq` to the highest `seq` it contains, so later revisions keep
   * ordering.
   */
  createInstance(
    input: FormInstanceInput,
    provenance: Provenance,
  ): Promise<FormInstance>;

  /** `null` when there is no such instance — not a throw. */
  getInstance(id: string): Promise<FormInstance | null>;

  /**
   * Filter by whichever fields the query supplies; ignore the absent ones.
   *
   * Ordering is not specified — the runner sorts by `updatedAt` itself. If you
   * apply `limit`, apply it last, and prefer returning the most recently
   * updated rows: the runner's usual question is "what is this subject on
   * right now?".
   */
  findInstances(q: FormInstanceQuery): Promise<FormInstance[]>;

  /**
   * The one write path for instance state. Atomic, compare-and-set.
   *
   * Field by field:
   * - `entries` — per-field `{ append?, cursor? }`. Append first, then move
   *   the cursor, then clamp it to `[-1, revisions.length - 1]`. A field
   *   absent from the commit is untouched.
   * - `occurrences`, `dispatches` — merge key-by-key over what's stored.
   * - `revisionSeq` — replaces. The engine has already allocated the `seq`
   *   values on the appended revisions; this is the high-water mark.
   * - `status`, `defVersion`, `closedReason`, `completedAt` — replace when
   *   present.
   * - `blockedOn`, `openStepOverride` — replace when present; `null` clears.
   *
   * Always bump `version` and `updatedAt`. Throw `FormConflictError(ifVersion,
   * stored)` when the versions disagree, and `MemoryNotFoundError` when the
   * instance is gone.
   */
  commitInstance(
    id: string,
    commit: FormInstanceCommit,
    opts: { ifVersion: number },
    provenance: Provenance,
  ): Promise<FormInstance>;

  /**
   * Record an executor attempt against its idempotency key.
   *
   * Deliberately outside the compare-and-set envelope, and deliberately not
   * required to be transactional with anything: this is an at-least-once
   * bookkeeping trail, and the worst a lost update costs is one duplicate
   * executor run — the exact thing the idempotency key exists to absorb.
   * Making it durable is fine; making a commit fail because of it is not.
   */
  recordDispatch(
    id: string,
    idempotencyKey: string,
    state: DispatchState,
    provenance: Provenance,
  ): Promise<void>;

  /**
   * Unblock an instance parked on a blocking checkpoint, when the resolution
   * arrives from outside the executor that parked it — a mesh reply, a host
   * callback, or a process that restarted while `awaiting`.
   *
   * Clear `blockedOn` if it names this checkpoint, move `awaiting` back to
   * `active`, and record the outcome in the dispatch log. Leave
   * `outcome.values` alone: the runner writes them through `commitInstance`
   * so they go through validation and rising-edge detection like any other
   * answer.
   */
  resolveCheckpoint(
    id: string,
    checkpointId: string,
    outcome: { ok: boolean; values?: Record<string, unknown>; error?: string },
    provenance: Provenance,
  ): Promise<FormInstance>;
}
