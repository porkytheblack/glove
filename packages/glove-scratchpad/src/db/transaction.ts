/**
 * Transaction = preview / staging (emulator-owned; glove-sql has no transactions).
 *
 * A write against a resource is a side-effecting tool call. Inside a transaction
 * the call is NOT fired — it is recorded as a {@link StagedWrite} with the exact
 * resolver + arguments it will invoke. `preview()` exposes the staged effects
 * (the approval surface); COMMIT fires them in order; ROLLBACK discards them — a
 * true dry run. This maps cleanly onto approval-gated outbound.
 */
import type { ResourceContext, SqlScalar } from "./provider";

export interface StagedWrite {
  resource: string;
  op: "insert" | "update" | "delete";
  /** The originating SQL (for the preview / audit trail). */
  sql: string;
  /** What the resolver will receive — surfaced verbatim by {@link Transaction.preview}. */
  detail: {
    rows?: Record<string, unknown>[];
    set?: Record<string, unknown>;
    bindings?: Record<string, SqlScalar[]>;
  };
  /** Fire the underlying resolver. Called only on COMMIT. */
  run: (ctx: ResourceContext) => Promise<unknown>;
}

export interface StagedWriteView {
  resource: string;
  op: "insert" | "update" | "delete";
  sql: string;
  rows?: Record<string, unknown>[];
  set?: Record<string, unknown>;
  bindings?: Record<string, SqlScalar[]>;
}

export class Transaction {
  readonly writes: StagedWrite[] = [];

  stage(write: StagedWrite): void {
    this.writes.push(write);
  }

  preview(): StagedWriteView[] {
    return this.writes.map((w) => ({ resource: w.resource, op: w.op, sql: w.sql, ...w.detail }));
  }
}
