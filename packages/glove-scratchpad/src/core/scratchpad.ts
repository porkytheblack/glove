/**
 * The Scratchpad — the durable store + manipulation surface (§6, §9).
 *
 * The membrane between the stochastic control unit (subagents) and the
 * deterministic datapath (SQL over the store). Management of durable state is
 * owned here, never by the models (§8): storing is a side effect of ingest, key
 * allocation / normalization / lifecycle are the store's job.
 *
 * Invariants (Appendix B):
 *   - A key resolves to `{value, schema, preview, provenance}`, never a bare blob.
 *   - Agents pass references, schemas, and unevaluated queries — not payloads.
 *   - No transparent materialization: values enter context only via an explicit,
 *     budgeted `materialize` call.
 *   - The contract is a defined Postgres subset; the backend is swappable.
 */
import type {
  Descriptor,
  Provenance,
  Reference,
  ScratchpadBackend,
  Stub,
  TableDescriptor,
} from "./types";
import { quoteIdent, uniqueRef } from "./keys";
import { planNormalization, RID, PARENT, IDX, type NormTable } from "./normalize";
import {
  readRawColumns,
  readRowCount,
  readPreview,
  toColumnDescriptors,
} from "./descriptor";
import type { ColumnType } from "./types";
import type { ScratchpadEvent, ScratchpadOp, ScratchpadSubscriber } from "./events";

const META_RECORDS = "_scratchpad_records";
const META_TABLES = "_scratchpad_tables";

/** Postgres max bind params per statement; we chunk inserts well under it. */
const MAX_PARAMS = 60000;

const _enc = new TextEncoder();
/** Serialised byte size of a value — the basis for token-consumption estimates. */
function bytesOf(v: unknown): number {
  return _enc.encode(typeof v === "string" ? v : JSON.stringify(v ?? "")).length;
}

export interface IngestOptions {
  /** Readable base name for the reference. Defaults to `"rec"`. */
  name?: string;
  provenance?: Partial<Provenance> & { source?: string };
  /** Rows in the descriptor preview. Default 5. */
  previewRows?: number;
}

export interface QueryOptions {
  /**
   * When set, the query result is persisted as a new record under this name
   * (via `CREATE TABLE AS`) and a {@link Stub} is returned instead of rows —
   * the "narrow → store → narrow again" loop (§6.4).
   */
  store?: string;
  /** Max rows returned in read mode. Default 50. */
  limit?: number;
  provenance?: Partial<Provenance>;
  previewRows?: number;
}

export interface QueryRows {
  rows: Record<string, unknown>[];
  /** True when more rows existed than the limit returned. */
  truncated: boolean;
}

export interface MaterializeOptions {
  ref?: Reference;
  /** A read-only SELECT/CTE. Mutually exclusive with `ref`. */
  sql?: string;
  limit?: number;
  offset?: number;
}

export interface MaterializeResult {
  rows: Record<string, unknown>[];
  returned: number;
  truncated: boolean;
}

function columnTypeToPg(t: ColumnType): string {
  switch (t) {
    case "bigint":
      return "bigint";
    case "double":
      return "double precision";
    case "boolean":
      return "boolean";
    case "jsonb":
      return "jsonb";
    case "timestamptz":
      return "timestamptz";
    default:
      return "text";
  }
}

/** Reject anything that isn't a single read-only statement (SELECT / WITH …). */
function assertReadOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (/;/.test(trimmed)) {
    throw new Error("Only a single statement is allowed.");
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    throw new Error(
      "Only read-only SELECT / WITH queries are allowed here. Use `store` to persist a derived record.",
    );
  }
  // A leading `WITH` can still hide a data-modifying CTE — Postgres permits
  // `WITH gone AS (DELETE … RETURNING *) SELECT * FROM gone`, which would mutate
  // the store through a path documented as read-only. Strip string and quoted
  // identifiers, then reject any write keyword that remains as a bare token.
  const stripped = trimmed
    .replace(/'(?:[^']|'')*'/g, "''") // string literals
    .replace(/"(?:[^"]|"")*"/g, '""'); // quoted identifiers
  if (/\b(insert|update|delete|drop|create|alter|truncate|merge|grant|revoke)\b/i.test(stripped)) {
    throw new Error(
      "Data-modifying statements (including data-modifying CTEs) are not allowed here. Use `store` to persist a derived record.",
    );
  }
  return trimmed;
}

export class Scratchpad {
  private subscribers: ScratchpadSubscriber[] = [];

  private constructor(public readonly backend: ScratchpadBackend) {}

  /** Open a scratchpad over a backend, ensuring meta tables exist. */
  static async create(backend: ScratchpadBackend): Promise<Scratchpad> {
    const sp = new Scratchpad(backend);
    await sp.ensureMeta();
    return sp;
  }

  // ── observability ─────────────────────────────────────────────────────────

  /**
   * Subscribe to the scratchpad's {@link ScratchpadEvent} stream — one event per
   * ingest / query / materialize / drop / snapshot (and `error`). Returns an
   * unsubscribe function. Subscribers are runtime-only (never serialised); after
   * a {@link Scratchpad.restore} you re-subscribe.
   */
  subscribe(subscriber: ScratchpadSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const i = this.subscribers.indexOf(subscriber);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  }

  /** Emit to every subscriber; a misbehaving subscriber must not break the store. */
  private async emit(event: ScratchpadEvent): Promise<void> {
    for (const sub of this.subscribers) {
      try {
        await sub.record(event);
      } catch {
        /* swallow — observability must never break the datapath */
      }
    }
  }

  /** Emit an `error` event for `op`, then rethrow the original error. */
  private async fail(op: ScratchpadOp, err: unknown, ctx?: { sql?: string; ref?: string }): Promise<never> {
    await this.emit({
      type: "error",
      op,
      message: err instanceof Error ? err.message : String(err),
      sql: ctx?.sql,
      ref: ctx?.ref,
    });
    throw err;
  }

  private async ensureMeta(): Promise<void> {
    await this.backend.exec(`
      CREATE TABLE IF NOT EXISTS ${quoteIdent(META_RECORDS)} (
        ref text PRIMARY KEY,
        kind text NOT NULL,
        provenance jsonb NOT NULL,
        raw_bytes bigint,
        text_length bigint,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ${quoteIdent(META_TABLES)} (
        table_name text PRIMARY KEY,
        ref text NOT NULL,
        role text NOT NULL,
        parent_field text,
        ord int NOT NULL DEFAULT 0
      );
    `);
  }

  /** All references currently registered — used to allocate collision-free keys. */
  async refs(): Promise<string[]> {
    const res = await this.backend.query(
      `SELECT ref FROM ${quoteIdent(META_RECORDS)} ORDER BY created_at`,
    );
    return res.rows.map((r) => String(r.ref));
  }

  /**
   * Every name a new allocation must avoid: registered refs **and** the physical
   * table names normalization derives (`${ref}__field` children). Allocating
   * against `refs()` alone lets a later `name: "doc__authors"` pass the
   * uniqueness check and then fail at `CREATE TABLE` because that child table
   * already exists.
   */
  private async reservedNames(): Promise<Set<string>> {
    const [recs, tbls] = await Promise.all([
      this.backend.query(`SELECT ref FROM ${quoteIdent(META_RECORDS)}`),
      this.backend.query(`SELECT table_name FROM ${quoteIdent(META_TABLES)}`),
    ]);
    const set = new Set<string>();
    for (const r of recs.rows) set.add(String(r.ref));
    for (const r of tbls.rows) set.add(String(r.table_name));
    return set;
  }

  /**
   * Best-effort rollback for a half-written record. The backend has no
   * cross-statement transaction, so if metadata registration fails after some
   * physical tables were created, drop them and remove any partial meta rows so
   * `refs()` and snapshots stay consistent and the name can be reused.
   */
  private async cleanupPartial(ref: string, tables: string[]): Promise<void> {
    for (const name of [...tables].reverse()) {
      try {
        await this.backend.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)} CASCADE;`);
      } catch {
        /* best effort */
      }
    }
    try {
      await this.backend.query(`DELETE FROM ${quoteIdent(META_TABLES)} WHERE ref = $1`, [ref]);
      await this.backend.query(`DELETE FROM ${quoteIdent(META_RECORDS)} WHERE ref = $1`, [ref]);
    } catch {
      /* best effort */
    }
  }

  // ── ingest (store-and-truncate write side) ────────────────────────────────

  /**
   * Normalize a JSON value into the store and return a {@link Stub}. The full
   * payload lands in the store; only the descriptor + reference cross back.
   */
  async ingest(value: unknown, opts: IngestOptions = {}): Promise<Stub> {
    const t0 = Date.now();
    let ref: string | undefined;
    const created: string[] = [];
    try {
      const taken = await this.reservedNames();
      ref = uniqueRef(opts.name ?? "rec", taken);
      const plan = planNormalization(value, ref);

      // 1. DDL + DML for each table (root first so child FKs resolve). Track
      //    created tables so a later failure can be rolled back (no transaction).
      for (const table of plan.tables) {
        await this.backend.exec(this.buildCreateTable(table, plan.rootTable));
        created.push(table.table);
        await this.insertRows(table);
      }

      // 2. Register in the meta tables so describe() and snapshots are complete.
      const provenance: Provenance = {
        source: opts.provenance?.source ?? "ingest",
        actor: opts.provenance?.actor,
        timestamp: opts.provenance?.timestamp ?? new Date().toISOString(),
        note: opts.provenance?.note,
      };
      await this.backend.query(
        `INSERT INTO ${quoteIdent(META_RECORDS)} (ref, kind, provenance, raw_bytes, text_length)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [ref, plan.kind, JSON.stringify(provenance), plan.rawBytes, plan.textLength ?? null],
      );
      for (let i = 0; i < plan.tables.length; i++) {
        const t = plan.tables[i];
        await this.backend.query(
          `INSERT INTO ${quoteIdent(META_TABLES)} (table_name, ref, role, parent_field, ord)
           VALUES ($1, $2, $3, $4, $5)`,
          [t.table, ref, t.role, t.parentField ?? null, i],
        );
      }

      const descriptor = await this.describe(ref, opts.previewRows ?? 5);
      const stub: Stub = { ref, descriptor, readMore: this.readMore(descriptor) };
      await this.emit({
        type: "ingest",
        ref,
        rowCount: descriptor.rowCount,
        bytes: descriptor.rawBytes ?? 0,
        stubBytes: bytesOf(stub),
        source: provenance.source,
        actor: provenance.actor,
        durationMs: Date.now() - t0,
      });
      return stub;
    } catch (err) {
      if (ref) await this.cleanupPartial(ref, created);
      return this.fail("ingest", err);
    }
  }

  private buildCreateTable(table: NormTable, rootTable: string): string {
    const cols: string[] = [`${quoteIdent(RID)} bigint PRIMARY KEY`];
    if (table.isChild) {
      cols.push(
        `${quoteIdent(PARENT)} bigint REFERENCES ${quoteIdent(rootTable)}(${quoteIdent(RID)})`,
      );
    }
    if (table.hasIdx) cols.push(`${quoteIdent(IDX)} bigint`);
    for (const c of table.columns) {
      cols.push(`${quoteIdent(c.name)} ${columnTypeToPg(c.type)}`);
    }
    return `CREATE TABLE ${quoteIdent(table.table)} (\n  ${cols.join(",\n  ")}\n);`;
  }

  private async insertRows(table: NormTable): Promise<void> {
    if (table.rows.length === 0) return;
    const colNames: string[] = [RID];
    if (table.isChild) colNames.push(PARENT);
    if (table.hasIdx) colNames.push(IDX);
    for (const c of table.columns) colNames.push(c.name);

    const jsonb = new Set(table.jsonbCols);
    const colCount = colNames.length;
    const perChunk = Math.max(1, Math.floor(MAX_PARAMS / colCount));

    for (let start = 0; start < table.rows.length; start += perChunk) {
      const chunk = table.rows.slice(start, start + perChunk);
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (const row of chunk) {
        const placeholders: string[] = [];
        for (const name of colNames) {
          params.push(row[name] ?? null);
          const ph = `$${params.length}`;
          placeholders.push(jsonb.has(name) ? `${ph}::jsonb` : ph);
        }
        tuples.push(`(${placeholders.join(", ")})`);
      }
      const colList = colNames.map(quoteIdent).join(", ");
      await this.backend.query(
        `INSERT INTO ${quoteIdent(table.table)} (${colList}) VALUES ${tuples.join(", ")}`,
        params,
      );
    }
  }

  // ── describe (the metadata surface) ───────────────────────────────────────

  /** Resolve a reference to its {@link Descriptor} — schema, preview, provenance. */
  async describe(ref: Reference, previewRows = 5): Promise<Descriptor> {
    const recRes = await this.backend.query(
      `SELECT kind, provenance, raw_bytes, text_length FROM ${quoteIdent(META_RECORDS)} WHERE ref = $1`,
      [ref],
    );
    const rec = recRes.rows[0];

    const tblRes = await this.backend.query(
      `SELECT table_name, role, parent_field FROM ${quoteIdent(META_TABLES)} WHERE ref = $1 ORDER BY ord`,
      [ref],
    );
    const tableRows =
      tblRes.rows.length > 0
        ? tblRes.rows
        : [{ table_name: ref, role: "root", parent_field: null }]; // raw / derived table

    const tables: TableDescriptor[] = [];
    let rootDesc: TableDescriptor | undefined;
    for (const tr of tableRows) {
      const tableName = String(tr.table_name);
      const raw = await readRawColumns(this.backend, tableName);
      const columns = toColumnDescriptors(raw);
      const rowCount = await readRowCount(this.backend, tableName);
      const td: TableDescriptor = {
        table: tableName,
        role: tr.role === "child" ? "child" : "root",
        columns,
        rowCount,
        parent:
          tr.role === "child"
            ? { table: ref, field: String(tr.parent_field ?? "") }
            : undefined,
      };
      tables.push(td);
      if (td.role === "root") rootDesc = td;
    }
    if (!rootDesc) rootDesc = tables[0];

    const rootRaw = await readRawColumns(this.backend, rootDesc.table);
    const preview = await readPreview(this.backend, rootDesc.table, rootRaw, previewRows);

    const kind = (rec?.kind as Descriptor["kind"]) ?? "table";
    const provenance: Provenance = rec
      ? (rec.provenance as Provenance)
      : { source: "unknown" };

    return {
      ref,
      kind,
      columns: rootDesc.columns,
      rowCount: rootDesc.rowCount,
      tables,
      preview,
      provenance,
      rawBytes: rec?.raw_bytes != null ? Number(rec.raw_bytes) : undefined,
      textLength: rec?.text_length != null ? Number(rec.text_length) : undefined,
    };
  }

  private readMore(d: Descriptor): string {
    const childNote =
      d.tables.length > 1
        ? ` Child tables (${d.tables
            .filter((t) => t.role === "child")
            .map((t) => t.table)
            .join(", ")}) join on ${PARENT} = parent ${RID}, ordered by ${IDX}.`
        : "";
    return (
      `Reference "${d.ref}" (${d.kind}, ${d.rowCount} row(s)). ` +
      `Narrow with scratchpad_query (SELECT … FROM ${quoteIdent(d.ref)}); ` +
      `read values with scratchpad_materialize({ ref: "${d.ref}" }).` +
      childNote
    );
  }

  // ── query (the deterministic ALU) ─────────────────────────────────────────

  /**
   * Run a Postgres-dialect query against the store. With `store`, persists the
   * result as a new record and returns a {@link Stub}; otherwise returns bounded
   * rows. Either way, no payload is materialised into model context unless the
   * caller reads the returned rows.
   */
  async query(sql: string, opts: QueryOptions = {}): Promise<Stub | QueryRows> {
    const t0 = Date.now();
    try {
      if (opts.store !== undefined) {
        // Validate before persisting: store mode runs the SQL through
        // `CREATE TABLE AS`, so it must clear the same read-only / single-statement
        // guard as read mode — otherwise `query("SELECT 1; DROP TABLE rec", { store })`
        // would reach the backend verbatim.
        const select = assertReadOnly(sql);
        const taken = await this.reservedNames();
        const ref = uniqueRef(opts.store, taken);
        const created: string[] = [];
        try {
          await this.backend.exec(`CREATE TABLE ${quoteIdent(ref)} AS ${select};`);
          created.push(ref);

          const provenance: Provenance = {
            source: opts.provenance?.source ?? "query",
            actor: opts.provenance?.actor,
            timestamp: opts.provenance?.timestamp ?? new Date().toISOString(),
            note: opts.provenance?.note ?? select,
          };
          await this.backend.query(
            `INSERT INTO ${quoteIdent(META_RECORDS)} (ref, kind, provenance) VALUES ($1, 'table', $2::jsonb)`,
            [ref, JSON.stringify(provenance)],
          );
          await this.backend.query(
            `INSERT INTO ${quoteIdent(META_TABLES)} (table_name, ref, role, ord) VALUES ($1, $1, 'root', 0)`,
            [ref],
          );
        } catch (e) {
          await this.cleanupPartial(ref, created);
          throw e;
        }
        const descriptor = await this.describe(ref, opts.previewRows ?? 5);
        const stub: Stub = { ref, descriptor, readMore: this.readMore(descriptor) };
        await this.emit({
          type: "query",
          sql: select,
          stored: ref,
          rows: descriptor.rowCount,
          bytes: bytesOf(stub),
          truncated: false,
          durationMs: Date.now() - t0,
        });
        return stub;
      }

      const select = assertReadOnly(sql);
      const limit = opts.limit ?? 50;
      const res = await this.backend.query(
        `SELECT * FROM (${select}) AS _q LIMIT ${limit + 1}`,
      );
      const truncated = res.rows.length > limit;
      const rows = truncated ? res.rows.slice(0, limit) : res.rows;
      await this.emit({ type: "query", sql: select, rows: rows.length, bytes: bytesOf(rows), truncated, durationMs: Date.now() - t0 });
      return { rows, truncated };
    } catch (err) {
      return this.fail("query", err, { sql });
    }
  }

  // ── materialize (the last mile) ───────────────────────────────────────────

  /**
   * The explicit, budgeted load (§9 "no transparent materialization"). The only
   * path that puts real values into context. Bounded by `limit`.
   */
  async materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
    const t0 = Date.now();
    try {
      const limit = opts.limit ?? 50;
      const offset = Math.max(0, opts.offset ?? 0);
      let inner: string;
      if (opts.sql) {
        inner = assertReadOnly(opts.sql);
      } else if (opts.ref) {
        inner = `SELECT * FROM ${quoteIdent(opts.ref)}`;
      } else {
        throw new Error("materialize requires either `ref` or `sql`.");
      }
      const res = await this.backend.query(
        `SELECT * FROM (${inner}) AS _q LIMIT ${limit + 1} OFFSET ${offset}`,
      );
      const truncated = res.rows.length > limit;
      const rows = truncated ? res.rows.slice(0, limit) : res.rows;
      await this.emit({
        type: "materialize",
        ref: opts.ref,
        sql: opts.sql,
        returned: rows.length,
        bytes: bytesOf(rows),
        truncated,
        durationMs: Date.now() - t0,
      });
      return { rows, returned: rows.length, truncated };
    } catch (err) {
      return this.fail("materialize", err, { sql: opts.sql, ref: opts.ref });
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** Descriptors for every record in the store (no previews, for cheap listing). */
  async list(): Promise<Array<Pick<Descriptor, "ref" | "kind" | "rowCount" | "columns" | "provenance" | "rawBytes">>> {
    const refs = await this.refs();
    const out = [];
    for (const ref of refs) {
      const d = await this.describe(ref, 0);
      out.push({
        ref: d.ref,
        kind: d.kind,
        rowCount: d.rowCount,
        columns: d.columns,
        provenance: d.provenance,
        rawBytes: d.rawBytes,
      });
    }
    return out;
  }

  /** Drop a record and all its tables. */
  async drop(ref: Reference): Promise<void> {
    const t0 = Date.now();
    try {
      const tblRes = await this.backend.query(
        `SELECT table_name FROM ${quoteIdent(META_TABLES)} WHERE ref = $1`,
        [ref],
      );
      const names =
        tblRes.rows.length > 0 ? tblRes.rows.map((r) => String(r.table_name)) : [ref];
      // Drop children first (CASCADE covers FK either way).
      for (const name of names.reverse()) {
        await this.backend.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)} CASCADE;`);
      }
      await this.backend.query(`DELETE FROM ${quoteIdent(META_TABLES)} WHERE ref = $1`, [ref]);
      await this.backend.query(`DELETE FROM ${quoteIdent(META_RECORDS)} WHERE ref = $1`, [ref]);
      await this.emit({ type: "drop", ref, durationMs: Date.now() - t0 });
    } catch (err) {
      await this.fail("drop", err, { ref });
    }
  }

  /** Serialise the whole scratchpad to bytes — computation as a value (§10). */
  async snapshot(): Promise<Uint8Array> {
    const t0 = Date.now();
    try {
      const bytes = await this.backend.dump();
      await this.emit({ type: "snapshot", bytes: bytes.byteLength, durationMs: Date.now() - t0 });
      return bytes;
    } catch (err) {
      return this.fail("snapshot", err);
    }
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}
