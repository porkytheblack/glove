import { FormConflictError, MemoryNotFoundError, MemoryWriteError } from "../core/errors";
import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type { FormAdapter, FormInstanceQuery } from "../forms/adapter";
import type {
  DispatchState,
  FormInstance,
  FormInstanceCommit,
  FormInstanceInput,
} from "../forms/types";

/**
 * Reference in-process form adapter. Instances in a Map keyed by id; the
 * whole record is cloned on the way out so callers can't mutate storage by
 * holding on to what they read.
 */
export class InMemoryFormAdapter implements FormAdapter {
  identifier: string;
  schema: MemorySchema;

  private readonly instances = new Map<string, FormInstance>();
  private nextId = 1;

  constructor(opts: { schema: MemorySchema; identifier?: string }) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `in-memory-forms-${Date.now()}`;
  }

  async createInstance(
    input: FormInstanceInput,
    provenance: Provenance,
  ): Promise<FormInstance> {
    requireProvenance(provenance);
    const now = new Date().toISOString();
    const id = this.genId();
    const instance: FormInstance = {
      id,
      defId: input.defId,
      defVersion: input.defVersion,
      subject: input.subject,
      status: input.status ?? "active",
      entries: { ...(input.entries ?? {}) },
      occurrences: {},
      dispatches: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.instances.set(id, instance);
    return clone(instance);
  }

  async getInstance(id: string): Promise<FormInstance | null> {
    const found = this.instances.get(id);
    return found ? clone(found) : null;
  }

  async findInstances(q: FormInstanceQuery): Promise<FormInstance[]> {
    const out: FormInstance[] = [];
    for (const instance of this.instances.values()) {
      if (q.subject !== undefined && instance.subject !== q.subject) continue;
      if (q.defId !== undefined && instance.defId !== q.defId) continue;
      if (q.status !== undefined && instance.status !== q.status) continue;
      out.push(clone(instance));
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return q.limit ? out.slice(0, q.limit) : out;
  }

  /**
   * The atomic write. `entries`, `occurrences` and `dispatches` merge
   * key-by-key; everything else replaces, and `null` clears. Nothing is ever
   * removed from `entries` — an answer the user gave is kept whether or not
   * it currently counts.
   */
  async commitInstance(
    id: string,
    commit: FormInstanceCommit,
    opts: { ifVersion: number },
    provenance: Provenance,
  ): Promise<FormInstance> {
    requireProvenance(provenance);
    const instance = this.instances.get(id);
    if (!instance) throw new MemoryNotFoundError(`No form instance "${id}".`);
    if (instance.version !== opts.ifVersion) {
      throw new FormConflictError(opts.ifVersion, instance.version);
    }

    const next: FormInstance = {
      ...instance,
      entries: { ...instance.entries, ...(commit.entries ?? {}) },
      occurrences: { ...instance.occurrences, ...(commit.occurrences ?? {}) },
      dispatches: { ...instance.dispatches, ...(commit.dispatches ?? {}) },
      version: instance.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (commit.status !== undefined) next.status = commit.status;
    if (commit.defVersion !== undefined) next.defVersion = commit.defVersion;
    if (commit.closedReason !== undefined) next.closedReason = commit.closedReason;
    if (commit.completedAt !== undefined) next.completedAt = commit.completedAt;
    if (commit.blockedOn !== undefined) {
      if (commit.blockedOn === null) delete next.blockedOn;
      else next.blockedOn = commit.blockedOn;
    }
    if (commit.openStepOverride !== undefined) {
      if (commit.openStepOverride === null) delete next.openStepOverride;
      else next.openStepOverride = commit.openStepOverride;
    }

    this.instances.set(id, next);
    return clone(next);
  }

  async recordDispatch(
    id: string,
    idempotencyKey: string,
    state: DispatchState,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const instance = this.instances.get(id);
    if (!instance) throw new MemoryNotFoundError(`No form instance "${id}".`);
    // Deliberately outside the CAS envelope: the dispatch log is an
    // at-least-once bookkeeping trail, and a lost update on it would cost a
    // duplicate executor run — the exact thing idempotency keys exist for.
    instance.dispatches = { ...instance.dispatches, [idempotencyKey]: { ...state } };
    instance.updatedAt = new Date().toISOString();
  }

  async resolveCheckpoint(
    id: string,
    checkpointId: string,
    outcome: { ok: boolean; values?: Record<string, unknown>; error?: string },
    provenance: Provenance,
  ): Promise<FormInstance> {
    requireProvenance(provenance);
    const instance = this.instances.get(id);
    if (!instance) throw new MemoryNotFoundError(`No form instance "${id}".`);

    const next: FormInstance = {
      ...clone(instance),
      status: instance.status === "awaiting" ? "active" : instance.status,
      version: instance.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (next.blockedOn === checkpointId) delete next.blockedOn;

    const key = `${id}:checkpoint:${checkpointId}:resolved`;
    next.dispatches = {
      ...next.dispatches,
      [key]: {
        hookId: `checkpoint:${checkpointId}`,
        status: outcome.ok ? "ok" : "failed",
        attempts: (next.dispatches[key]?.attempts ?? 0) + 1,
        at: new Date().toISOString(),
        error: outcome.ok ? undefined : (outcome.error ?? "checkpoint rejected"),
      },
    };

    this.instances.set(id, next);
    return clone(next);
  }

  private genId(): string {
    const id = `form_${this.nextId.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.nextId++;
    return id;
  }
}

function clone(instance: FormInstance): FormInstance {
  return {
    ...instance,
    entries: { ...instance.entries },
    occurrences: { ...instance.occurrences },
    dispatches: { ...instance.dispatches },
  };
}

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (
    !p ||
    typeof p !== "object" ||
    typeof p.source !== "string" ||
    typeof p.actor !== "string" ||
    typeof p.timestamp !== "string"
  ) {
    throw new MemoryWriteError(
      "provenance_required",
      "A provenance record is required on every write.",
    );
  }
}
