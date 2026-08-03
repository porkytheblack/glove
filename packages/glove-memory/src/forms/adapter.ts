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
  subject?: string;
  defId?: string;
  status?: FormInstanceStatus;
  limit?: number;
}

/**
 * Storage-agnostic contract for form instances.
 *
 * **Instances are the only thing the adapter stores.** Definitions are code —
 * zod schemas, gate closures and executors don't serialise, and there is no
 * JSON compile target to store instead. That is what makes this contract
 * small: no def table, no schema versioning, no migration primitives beyond
 * the version number an instance pins at start.
 */
export interface FormAdapter {
  identifier: string;
  schema: MemorySchema;

  createInstance(
    input: FormInstanceInput,
    provenance: Provenance,
  ): Promise<FormInstance>;

  getInstance(id: string): Promise<FormInstance | null>;

  findInstances(q: FormInstanceQuery): Promise<FormInstance[]>;

  /**
   * One atomic write — entries, rising-edge counters, dispatch log, status.
   * Throws `FormConflictError` when the stored version isn't `ifVersion`.
   *
   * Dispatch is commit-then-run: values and the fired log land together
   * before any executor sees them, so a crash mid-executor replays the hook
   * rather than losing the answer.
   */
  commitInstance(
    id: string,
    commit: FormInstanceCommit,
    opts: { ifVersion: number },
    provenance: Provenance,
  ): Promise<FormInstance>;

  /** Record an executor attempt against its idempotency key. */
  recordDispatch(
    id: string,
    idempotencyKey: string,
    state: DispatchState,
    provenance: Provenance,
  ): Promise<void>;

  /**
   * Unblock an instance parked on a blocking checkpoint. Called by the host
   * or a mesh reply when the checkpoint resolves out of band — a process
   * restart while `awaiting`, or an executor that hands off instead of
   * returning.
   */
  resolveCheckpoint(
    id: string,
    checkpointId: string,
    outcome: { ok: boolean; values?: Record<string, unknown>; error?: string },
    provenance: Provenance,
  ): Promise<FormInstance>;
}
