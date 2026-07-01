/**
 * The database emulator — a SQL interpreter over live resources.
 *
 * `execute(sql)` is the centerpiece:
 *
 *   parse → security-gate → collect relations → push WHERE equalities down as
 *   arguments → resolve each resource EXACTLY ONCE (per the volatility model) →
 *   materialize the rows into the transient engine → run the synchronous query →
 *   tear the ephemeral tables down.
 *
 * Resolving up front (rather than via an async hook in FROM-resolution) is what
 * reconciles async resolvers with glove-sql's synchronous evaluator AND
 * guarantees an effectful resource is never invoked N times by the planner.
 *
 * Discovery is `information_schema` (resources are advertised via the engine's
 * `catalogProvider`); writes can be staged in a transaction and previewed before
 * COMMIT; `explain()` reports which tools a query will hit without running them.
 */
import {
  MemoryBackend,
  parse,
  collectRelations,
  collectCteNames,
  extractEqualityBindings,
  type Stmt,
  type Expr,
  type SqlBackend,
} from "glove-sql";
import { quoteIdent } from "../core/keys";
import { Catalog } from "./catalog";
import { materializeTable, toRows } from "./materialize";
import { Transaction, type StagedWrite, type StagedWriteView } from "./transaction";
import {
  bindingsKey,
  makeBindings,
  type ResourceContext,
  type ResourceTable,
  type SqlScalar,
  type Volatility,
} from "./provider";

export interface DatabasePolicy {
  /** Master switch for INSERT/UPDATE/DELETE. Default false (read-only). */
  writes?: boolean;
}

export interface DatabaseOptions {
  /** Bring your own backend (e.g. PgliteBackend). Default: a fresh MemoryBackend. */
  backend?: SqlBackend;
  policy?: DatabasePolicy;
  /** Default actor stamped into resolver context. */
  actor?: string;
}

export interface ExecuteOptions {
  /** Values for `$1`, `$2`, … placeholders. */
  params?: unknown[];
  signal?: AbortSignal;
  actor?: string;
  /** Row cap returned to the caller (the engine still computes the full result). Default 50. */
  limit?: number;
  /** Per-call override allowing an immediate (non-transactional) write. */
  allowWrites?: boolean;
}

export interface TouchedRelation {
  name: string;
  source: "virtual" | "stored";
  access: "read" | "write";
  op?: "select" | "insert" | "update" | "delete";
  volatility?: Volatility;
  bindings: Record<string, SqlScalar[]>;
  invocations: number;
  warnings?: string[];
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  truncated: boolean;
  /** Which relations the statement touched (tools hit, with volatility + access). */
  touched: TouchedRelation[];
  /** Present after COMMIT — how many staged writes fired. */
  committed?: number;
  /** Present when a write was staged in an open transaction. */
  staged?: StagedWriteView[];
  /** Human-facing note ("BEGIN", "staged", "ROLLBACK: N discarded", …). */
  message?: string;
}

export interface ExplainResult {
  statementKind: string;
  readOnly: boolean;
  relations: TouchedRelation[];
  /** Staged writes pending in the open transaction, if any. */
  staged?: StagedWriteView[];
}

const emptyResult = (): ExecuteResult => ({ rows: [], fields: [], truncated: false, touched: [] });

function mapToObj(eq: ReadonlyMap<string, SqlScalar[]>): Record<string, SqlScalar[]> {
  return Object.fromEntries(eq);
}

function scalarEq(a: SqlScalar, b: SqlScalar): boolean {
  return a === b;
}

/** Evaluate a literal/param expression to a scalar — INSERT/UPDATE values only. */
function evalLiteral(e: Expr, params: unknown[]): SqlScalar {
  switch (e.k) {
    case "num":
      return e.v;
    case "str":
      return e.v;
    case "bool":
      return e.v;
    case "null":
      return null;
    case "param":
      return (params[e.i - 1] ?? null) as SqlScalar;
    case "cast":
      return evalLiteral(e.e, params);
    case "unary":
      if (e.op === "-") {
        const v = evalLiteral(e.e, params);
        return typeof v === "number" ? -v : v;
      }
      if (e.op === "+") return evalLiteral(e.e, params);
      break;
  }
  throw new Error(
    "glove-scratchpad: INSERT/UPDATE values must be literals or parameters (no expressions) when writing to a resource.",
  );
}

/** Split a SQL string into top-level statement texts, respecting quotes. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      cur += c;
      i++;
      while (i < sql.length) {
        cur += sql[i];
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Strip `INSERT INTO <table> [(cols)]` so the remainder is the source query. */
function insertSourceText(text: string): string {
  const m = text.match(/^\s*insert\s+into\s+("(?:[^"]|"")*"|[A-Za-z_][\w$]*)\s*(\([^)]*\))?\s*/i);
  if (!m) throw new Error("glove-scratchpad: could not parse the INSERT … SELECT source query.");
  return text.slice(m[0].length);
}

export class Database {
  private policy: Required<DatabasePolicy>;
  private actor?: string;
  private txn: Transaction | null = null;
  /** IMMUTABLE resolver results, cached for the database's lifetime. */
  private immutableCache = new Map<string, Record<string, unknown>[]>();

  private constructor(
    readonly backend: SqlBackend,
    readonly catalog: Catalog,
    policy: Required<DatabasePolicy>,
    actor?: string,
  ) {
    this.policy = policy;
    this.actor = actor;
  }

  static async create(opts: DatabaseOptions = {}): Promise<Database> {
    const catalog = new Catalog();
    const backend =
      opts.backend ?? (await MemoryBackend.create({ catalogProvider: () => catalog.catalogTables() }));
    return new Database(backend, catalog, { writes: opts.policy?.writes ?? false }, opts.actor);
  }

  /** Register a resource table. Chainable. */
  register(resource: ResourceTable): this {
    this.catalog.register(resource);
    return this;
  }

  registerAll(resources: ResourceTable[]): this {
    for (const r of resources) this.catalog.register(r);
    return this;
  }

  inTransaction(): boolean {
    return this.txn !== null;
  }

  /** The writes staged in the open transaction (the approval surface). */
  preview(): StagedWriteView[] {
    return this.txn?.preview() ?? [];
  }

  async close(): Promise<void> {
    await this.backend.close();
  }

  // ── execute ───────────────────────────────────────────────────────────────

  async execute(sql: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
    const texts = splitSql(sql);
    if (texts.length === 0) return emptyResult();
    const parsed = texts.map((text) => {
      const stmts = parse(text);
      if (stmts.length !== 1) throw new Error("glove-scratchpad: each statement must parse to exactly one statement.");
      return { text, stmt: stmts[0] };
    });
    if (parsed.length > 1 && parsed[0].stmt.k !== "begin" && !this.txn) {
      throw new Error(
        "glove-scratchpad: only a single statement is allowed, except a BEGIN … COMMIT/ROLLBACK transaction script.",
      );
    }
    const ctx: ResourceContext = {
      signal: opts.signal,
      cache: new Map(),
      actor: opts.actor ?? this.actor,
    };
    let last = emptyResult();
    for (const { text, stmt } of parsed) last = await this.runStatement(stmt, text, opts, ctx);
    return last;
  }

  private async runStatement(
    stmt: Stmt,
    text: string,
    opts: ExecuteOptions,
    ctx: ResourceContext,
  ): Promise<ExecuteResult> {
    switch (stmt.k) {
      case "begin":
        if (this.txn) throw new Error("glove-scratchpad: a transaction is already open — COMMIT or ROLLBACK first.");
        this.txn = new Transaction();
        return { ...emptyResult(), message: "BEGIN" };
      case "commit": {
        if (!this.txn) throw new Error("glove-scratchpad: COMMIT without an open transaction.");
        const writes = this.txn.writes;
        this.txn = null; // clear first so a mid-commit failure doesn't leave it open
        let committed = 0;
        for (const w of writes) {
          await w.run(ctx);
          committed++;
        }
        return { ...emptyResult(), committed, message: `COMMIT: ${committed} write(s) fired` };
      }
      case "rollback": {
        if (!this.txn) throw new Error("glove-scratchpad: ROLLBACK without an open transaction.");
        const n = this.txn.writes.length;
        this.txn = null;
        return { ...emptyResult(), message: `ROLLBACK: ${n} staged write(s) discarded` };
      }
      case "explain":
        return this.explainAsResult(stmt.statement, opts);
      case "select":
        return this.runRead(stmt, text, opts, ctx);
      case "insert":
      case "delete":
      case "update":
        return this.runWrite(stmt, text, opts, ctx);
      case "createTable":
      case "dropTable":
        throw new Error(
          `glove-scratchpad: ${stmt.k === "createTable" ? "CREATE" : "DROP"} TABLE is not permitted — the database manages its own tables.`,
        );
    }
  }

  // ── read path ───────────────────────────────────────────────────────────────

  private async runRead(
    stmt: Stmt,
    text: string,
    opts: ExecuteOptions,
    ctx: ResourceContext,
  ): Promise<ExecuteResult> {
    const params = opts.params ?? [];
    const touched: TouchedRelation[] = [];
    const ephemerals: string[] = [];
    try {
      await this.resolveReads(stmt, params, ctx, touched, ephemerals);
      const limit = opts.limit ?? 50;
      const res = await this.backend.query(`SELECT * FROM (${text}) AS _q LIMIT ${limit + 1}`, params);
      const truncated = res.rows.length > limit;
      const rows = truncated ? res.rows.slice(0, limit) : res.rows;
      return { rows, fields: res.fields.map((f) => ({ name: f.name })), truncated, touched };
    } finally {
      await this.teardown(ephemerals);
    }
  }

  /** Resolve every virtual read relation in `stmt`, materializing its rows. */
  private async resolveReads(
    stmt: Stmt,
    params: unknown[],
    ctx: ResourceContext,
    touched: TouchedRelation[],
    ephemerals: string[],
  ): Promise<void> {
    const cteNames = collectCteNames(stmt);
    const reads = collectRelations(stmt).filter(
      (r) => r.role === "read" && !cteNames.has(r.name) && this.catalog.has(r.name),
    );
    const byName = new Map<string, string[]>();
    for (const r of reads) {
      const arr = byName.get(r.name) ?? [];
      arr.push(r.alias);
      byName.set(r.name, arr);
    }
    await Promise.all(
      [...byName.entries()].map(async ([name, aliases]) => {
        const resource = this.catalog.get(name)!;
        if (!resource.select) {
          throw new Error(`glove-scratchpad: relation "${name}" is not readable (no SELECT capability).`);
        }
        const eq = this.bindingsFor(stmt, aliases, resource, params);
        const missing = resource.columns.filter((c) => c.requiredKey && !eq.has(c.name)).map((c) => c.name);
        if (missing.length > 0) {
          throw new Error(
            `glove-scratchpad: relation "${name}" requires an equality on ${missing
              .map((m) => `"${m}"`)
              .join(", ")} (e.g. WHERE ${missing[0]} = …).`,
          );
        }
        const rows = await this.resolveRows(resource, eq, ctx);
        // Echo single-valued pushed-down arguments into the rows that don't
        // already carry them, so a `WHERE key = v` predicate (which is BOTH an
        // argument AND, to the engine, a residual filter) still matches. Values
        // the resolver returned are left untouched.
        const stamped = this.stampBindings(rows, eq);
        // Track the table for teardown BEFORE materializing: if the CREATE
        // succeeds but the bulk INSERT throws (a bad row coercion), the table
        // still exists and must be dropped — otherwise it leaks and the next
        // statement's CREATE fails with "relation already exists".
        ephemerals.push(name);
        await materializeTable(this.backend, name, resource.columns, stamped);
        touched.push({
          name,
          source: "virtual",
          access: "read",
          op: "select",
          volatility: resource.volatility,
          bindings: mapToObj(eq),
          invocations: 1,
        });
      }),
    );
  }

  /** Merge pushed-down equality bindings across a resource's aliases, filtered to declared columns. */
  private bindingsFor(
    stmt: Stmt,
    aliases: string[],
    resource: ResourceTable,
    params: unknown[],
  ): Map<string, SqlScalar[]> {
    const declared = new Set(resource.columns.map((c) => c.name));
    const eq = new Map<string, SqlScalar[]>();
    for (const alias of aliases) {
      for (const [col, vals] of extractEqualityBindings(stmt, alias, params)) {
        if (!declared.has(col)) continue;
        const cur = eq.get(col) ?? [];
        for (const v of vals) if (!cur.some((x) => scalarEq(x, v))) cur.push(v);
        eq.set(col, cur);
      }
    }
    return eq;
  }

  /** Fill single-valued bound columns into rows that don't already carry them. */
  private stampBindings(
    rows: Record<string, unknown>[],
    eq: ReadonlyMap<string, SqlScalar[]>,
  ): Record<string, unknown>[] {
    const single = [...eq.entries()].filter(([, v]) => v.length === 1);
    if (single.length === 0) return rows;
    return rows.map((row) => {
      const r = { ...row };
      for (const [col, vals] of single) {
        if (r[col] === undefined || r[col] === null) r[col] = vals[0];
      }
      return r;
    });
  }

  /** Invoke a resource's `select`, honoring the volatility cache. */
  private async resolveRows(
    resource: ResourceTable,
    eq: Map<string, SqlScalar[]>,
    ctx: ResourceContext,
  ): Promise<Record<string, unknown>[]> {
    const key = `${resource.name}::${bindingsKey(eq)}`;
    if (resource.volatility === "immutable" && this.immutableCache.has(key)) {
      return this.immutableCache.get(key)!;
    }
    if (resource.volatility === "stable" && ctx.cache.has(key)) {
      return ctx.cache.get(key) as Record<string, unknown>[];
    }
    const data = await resource.select!(makeBindings(eq), ctx);
    const rows = toRows(data);
    if (resource.volatility === "immutable") this.immutableCache.set(key, rows);
    if (resource.volatility === "stable") ctx.cache.set(key, rows);
    return rows;
  }

  // ── write path ────────────────────────────────────────────────────────────

  private async runWrite(
    stmt: Stmt,
    text: string,
    opts: ExecuteOptions,
    ctx: ResourceContext,
  ): Promise<ExecuteResult> {
    if (stmt.k !== "insert" && stmt.k !== "update" && stmt.k !== "delete") return emptyResult();
    const target = stmt.table;
    const resource = this.catalog.get(target);
    if (!resource) {
      throw new Error(`glove-scratchpad: relation "${target}" is not a writable resource.`);
    }
    const writesEnabled = opts.allowWrites ?? this.policy.writes;
    if (!writesEnabled) {
      throw new Error(
        `glove-scratchpad: writes are disabled for this database. Enable them or wrap the write in BEGIN … COMMIT.`,
      );
    }
    const params = opts.params ?? [];

    let staged: StagedWrite;
    const ephemerals: string[] = [];
    try {
      if (stmt.k === "insert") {
        if (!resource.insert) throw new Error(`glove-scratchpad: relation "${target}" is not insertable.`);
        const rows = await this.insertRows(stmt, text, resource, params, ctx, ephemerals);
        staged = {
          resource: target,
          op: "insert",
          sql: text,
          detail: { rows },
          run: (c) => resource.insert!(rows, c),
        };
      } else if (stmt.k === "update") {
        if (!resource.update) throw new Error(`glove-scratchpad: relation "${target}" is not updatable.`);
        const eq = this.bindingsFor(stmt, [target], resource, params);
        const set: Record<string, unknown> = {};
        for (const { col, value } of stmt.set) set[col] = evalLiteral(value, params);
        staged = {
          resource: target,
          op: "update",
          sql: text,
          detail: { set, bindings: mapToObj(eq) },
          run: (c) => resource.update!(set, makeBindings(eq), c),
        };
      } else {
        if (!resource.delete) throw new Error(`glove-scratchpad: relation "${target}" is not deletable.`);
        const eq = this.bindingsFor(stmt, [target], resource, params);
        staged = {
          resource: target,
          op: "delete",
          sql: text,
          detail: { bindings: mapToObj(eq) },
          run: (c) => resource.delete!(makeBindings(eq), c),
        };
      }
    } finally {
      await this.teardown(ephemerals);
    }

    const touched: TouchedRelation[] = [
      {
        name: target,
        source: "virtual",
        access: "write",
        op: staged.op,
        volatility: resource.volatility,
        bindings: staged.detail.bindings ?? {},
        invocations: this.txn ? 0 : 1,
      },
    ];

    if (this.txn) {
      this.txn.stage(staged);
      return { ...emptyResult(), touched, staged: this.txn.preview(), message: `staged ${staged.op} on "${target}"` };
    }
    await staged.run(ctx);
    return { ...emptyResult(), touched, message: `${staged.op} on "${target}" fired` };
  }

  /** Build the rows for an INSERT, resolving an `INSERT … SELECT` source if present. */
  private async insertRows(
    stmt: Extract<Stmt, { k: "insert" }>,
    text: string,
    resource: ResourceTable,
    params: unknown[],
    ctx: ResourceContext,
    ephemerals: string[],
  ): Promise<Record<string, unknown>[]> {
    const targetCols = stmt.columns ?? resource.columns.map((c) => c.name);
    if (stmt.asSelect) {
      // Resolve the source query's resources, run it against the engine, and map
      // its output columns onto the target columns — composition with NO
      // intermediate rows crossing into model context.
      const touched: TouchedRelation[] = [];
      await this.resolveReads(stmt, params, ctx, touched, ephemerals);
      const src = await this.backend.query(insertSourceText(text), params);
      const outCols = src.fields.map((f) => f.name);
      if (outCols.length !== targetCols.length) {
        throw new Error(`glove-scratchpad: INSERT column/value count mismatch on "${stmt.table}".`);
      }
      return src.rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (let i = 0; i < targetCols.length; i++) o[targetCols[i]] = r[outCols[i]];
        return o;
      });
    }
    return stmt.rows.map((exprs) => {
      if (exprs.length !== targetCols.length) {
        throw new Error(`glove-scratchpad: INSERT column/value count mismatch on "${stmt.table}".`);
      }
      const o: Record<string, unknown> = {};
      for (let i = 0; i < targetCols.length; i++) o[targetCols[i]] = evalLiteral(exprs[i], params);
      return o;
    });
  }

  // ── explain ─────────────────────────────────────────────────────────────────

  /** Report which relations a statement touches — WITHOUT invoking any resolver. */
  async explain(sql: string, opts: ExecuteOptions = {}): Promise<ExplainResult> {
    const [stmt] = parse(sql);
    const inner = stmt.k === "explain" ? stmt.statement : stmt;
    return this.explainStatement(inner, opts);
  }

  private explainStatement(stmt: Stmt, opts: ExecuteOptions): ExplainResult {
    const params = opts.params ?? [];
    const relations: TouchedRelation[] = [];
    const cteNames = collectCteNames(stmt);
    for (const r of collectRelations(stmt)) {
      if (r.role === "read") {
        if (cteNames.has(r.name)) continue;
        const resource = this.catalog.get(r.name);
        if (!resource) {
          relations.push({ name: r.name, source: "stored", access: "read", bindings: {}, invocations: 0 });
          continue;
        }
        const eq = this.bindingsFor(stmt, [r.alias], resource, params);
        const missing = resource.columns.filter((c) => c.requiredKey && !eq.has(c.name)).map((c) => c.name);
        const warnings = missing.length
          ? [`missing required key(s): ${missing.map((m) => `"${m}"`).join(", ")}`]
          : undefined;
        relations.push({
          name: r.name,
          source: "virtual",
          access: "read",
          op: "select",
          volatility: resource.volatility,
          bindings: mapToObj(eq),
          invocations: 1,
          warnings,
        });
      } else {
        const resource = this.catalog.get(r.name);
        const eq = resource ? this.bindingsFor(stmt, [r.alias], resource, params) : new Map();
        relations.push({
          name: r.name,
          source: resource ? "virtual" : "stored",
          access: "write",
          op: r.role,
          volatility: resource?.volatility,
          bindings: mapToObj(eq),
          invocations: 1,
        });
      }
    }
    return {
      statementKind: stmt.k,
      readOnly: stmt.k === "select",
      relations,
      staged: this.txn ? this.txn.preview() : undefined,
    };
  }

  private explainAsResult(stmt: Stmt, opts: ExecuteOptions): ExecuteResult {
    const plan = this.explainStatement(stmt, opts);
    const rows = plan.relations.map((r) => ({
      relation: r.name,
      source: r.source,
      access: r.access,
      op: r.op ?? null,
      volatility: r.volatility ?? null,
      invocations: r.invocations,
      bindings: JSON.stringify(r.bindings),
      warnings: r.warnings ? r.warnings.join("; ") : null,
    }));
    return {
      rows,
      fields: [
        { name: "relation" },
        { name: "source" },
        { name: "access" },
        { name: "op" },
        { name: "volatility" },
        { name: "invocations" },
        { name: "bindings" },
        { name: "warnings" },
      ],
      truncated: false,
      touched: plan.relations,
    };
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  private async teardown(ephemerals: string[]): Promise<void> {
    for (const name of [...ephemerals].reverse()) {
      try {
        await this.backend.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)} CASCADE;`);
      } catch {
        /* best effort — never let teardown mask the real result/error */
      }
    }
  }
}
