/**
 * The host: deploys definitions, migrates their data, runs their methods,
 * keeps their event logs and runs their outputs on a cadence. Each app is
 * single-threaded — calls to one app run one at a time, in arrival order —
 * which is the Durable Object rule, and what makes an action's view of its own
 * rows consistent on every backend without locks.
 *
 * `AppHost` is the interface the tools, the working-environment module, the
 * Foundry layer and the HTTP server all take, so an app hosted on Kuiper and
 * one in the agent's own process are used the same way.
 */

import { JsError, JsSession, type ToolFn } from "glove-js";
import { parseInterval, statements, validateDefinition } from "./define";
import { MiniAppError } from "./errors";
import { applyOps, autoKey, deriveAdditiveOps, diffSchemas } from "./schema";
import { bindValues, checkStatement, compileNamed, SqlCheckError, type CompiledSql } from "./sql";
import { SYSTEM_TABLES, type AppStorage, type Backend, type Row, type StructuralOp } from "./backends/backend";
import type {
  AppDefinition,
  AppDescription,
  AppEvent,
  AppSummary,
  CallResult,
  ColumnType,
  DeployResult,
  Delivery,
  Grant,
  MethodDef,
  MethodKind,
  Migration,
  MigrationOp,
  OutputResult,
  ParamDef,
  Principal,
  Schema,
} from "./types";

export interface Caller {
  /** Who is acting. The owner of an app may do anything to it; others need a grant. */
  as: Principal;
  signal?: AbortSignal;
}

export interface DeployOptions extends Caller {
  /** Required when the schema change is not purely additive. */
  migration?: Migration;
  /** Run the migration and roll it back: reports what would happen. */
  dryRun?: boolean;
}

export interface AppHost {
  /** Apps the caller owns or holds a grant on. */
  list(opts: Caller): Promise<AppSummary[]>;
  describe(app: string, opts: Caller): Promise<AppDescription>;
  /** Create an app, or upgrade one the caller owns. */
  deploy(definition: AppDefinition, opts: DeployOptions): Promise<DeployResult>;
  call<T = unknown>(app: string, method: string, args: Record<string, unknown> | undefined, opts: Caller): Promise<CallResult<T>>;
  /** The event log, oldest first. */
  events(app: string, opts: Caller & { after?: number; limit?: number }): Promise<AppEvent[]>;
  /** Run one output now. */
  output(app: string, name: string, opts: Caller): Promise<OutputResult>;
  /** Replace the grant for `grant.to`. Owner only. Returns every grant on the app. */
  grant(app: string, grant: Grant, opts: Caller): Promise<Grant[]>;
  revoke(app: string, to: Principal, opts: Caller): Promise<Grant[]>;
  /** Delete the app and its data. Owner only. */
  remove(app: string, opts: Caller): Promise<void>;
  /** Run every output that is due. The host process calls this on a timer. */
  tick(opts?: { now?: Date }): Promise<OutputResult[]>;
  close(): Promise<void>;
}

export interface AppHostOptions {
  backend: Backend;
  /** Default `() => new Date()`. Every call reads it once: `:now` and `ctx.now`. */
  clock?: () => Date;
  /** Interpreter fuel per js method call — the gas limit. Default 100 000. */
  fuel?: number;
  /** How many subscription hops an event may cause. Default 3. */
  subscriptionDepth?: number;
  /** Each event, after the action that emitted it commits. */
  onEvent?: (event: AppEvent) => void | Promise<void>;
  /** Each output `tick()` produces. */
  onOutput?: (output: OutputResult) => void | Promise<void>;
}

interface LoadedApp {
  name: string;
  owner: Principal;
  version: number;
  def: AppDefinition;
  grants: Grant[];
  createdAt: string;
  updatedAt: string;
  storage: AppStorage;
  /** Column name → type across the app's tables; "mixed" when two tables disagree. */
  columns: Map<string, ColumnType | "mixed">;
  compiled: Map<string, CompiledSql>;
}

const REGISTRY: Schema = {
  apps: {
    columns: {
      name: { type: "text", primaryKey: true },
      owner: { type: "text" },
      description: { type: "text" },
      version: { type: "integer" },
      grants: { type: "text" },
      created_at: { type: "text" },
      updated_at: { type: "text" },
    },
  },
  versions: {
    columns: {
      id: { type: "integer", primaryKey: true },
      app: { type: "text" },
      version: { type: "integer" },
      definition: { type: "text" },
      migration: { type: "text", nullable: true },
      deployed_by: { type: "text" },
      deployed_at: { type: "text" },
    },
    indexes: [["app", "version"]],
  },
};

const createOps = (schema: Schema): StructuralOp[] =>
  Object.entries(schema).map(([table, def]) => ({ op: "create_table", table, def }));

/** Raised inside a transaction to roll a dry run back. */
class DryRun extends Error {}

export async function createAppHost(options: AppHostOptions): Promise<AppHost> {
  const host = new LocalAppHost(options);
  await host.init();
  return host;
}

class LocalAppHost implements AppHost {
  private readonly backend: Backend;
  private readonly clock: () => Date;
  private readonly fuel: number;
  private readonly maxDepth: number;
  private readonly ph: (n: number) => string;
  private system!: AppStorage;
  private apps = new Map<string, LoadedApp>();
  /** `<app>.<event>` → the subscribed apps' actions. */
  private subscribers = new Map<string, Array<{ app: string; run: string }>>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly options: AppHostOptions) {
    this.backend = options.backend;
    this.clock = options.clock ?? (() => new Date());
    this.fuel = options.fuel ?? 100_000;
    this.maxDepth = options.subscriptionDepth ?? 3;
    this.ph = options.backend.placeholder ?? ((n) => `$${n}`);
  }

  // ── startup ────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.system = await this.backend.open("_system");
    if (!(await this.tableExists(this.system, "apps"))) {
      await this.system.transaction(() => this.system.migrate(createOps(REGISTRY), {}, { reserved: true }));
    }
    for (const row of await this.system.query(`SELECT * FROM "apps"`)) {
      const name = String(row.name);
      const [v] = await this.system.query(
        `SELECT "definition" FROM "versions" WHERE "app" = ${this.ph(1)} AND "version" = ${this.ph(2)}`,
        [name, Number(row.version)],
      );
      if (!v) continue;
      this.apps.set(name, await this.load({
        name,
        owner: String(row.owner),
        version: Number(row.version),
        def: JSON.parse(String(v.definition)),
        grants: JSON.parse(String(row.grants)),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    }
    this.indexSubscriptions();
  }

  /** Probe rather than ask a catalog: SQLite has no information_schema. */
  private async tableExists(storage: AppStorage, table: string): Promise<boolean> {
    try {
      await storage.query(`SELECT 1 FROM "${table}" LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }

  private async load(a: Omit<LoadedApp, "storage" | "columns" | "compiled">): Promise<LoadedApp> {
    return { ...a, storage: await this.backend.open(a.name), columns: columnIndex(a.def.schema), compiled: new Map() };
  }

  private indexSubscriptions(): void {
    this.subscribers.clear();
    for (const a of this.apps.values()) {
      for (const s of a.def.subscriptions ?? []) {
        const list = this.subscribers.get(s.on) ?? [];
        list.push({ app: a.name, run: s.run });
        this.subscribers.set(s.on, list);
      }
    }
  }

  // ── access ─────────────────────────────────────────────────────────────────

  private get(app: string): LoadedApp {
    const a = this.apps.get(app);
    if (!a) throw new MiniAppError("not_found", `there is no app "${app}"`);
    return a;
  }

  private grantFor(a: LoadedApp, who: Principal): Grant | undefined {
    return a.grants.find((g) => g.to === who) ?? a.grants.find((g) => g.to === "*");
  }

  private visible(a: LoadedApp, who: Principal): boolean {
    return a.owner === who || this.grantFor(a, who) !== undefined;
  }

  private mayCall(a: LoadedApp, who: Principal, method: string): boolean {
    if (a.owner === who) return true;
    const g = this.grantFor(a, who);
    return !!g && (g.methods === "*" || g.methods.includes(method));
  }

  private owned(app: string, who: Principal, doing: string): LoadedApp {
    const a = this.get(app);
    if (a.owner !== who) throw new MiniAppError("forbidden", `only the owner of "${app}" (${a.owner}) can ${doing}`);
    return a;
  }

  /** One app at a time: each call waits for the one before it on the same app. */
  private serial<T>(app: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(app) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.chains.set(app, next.catch(() => {}));
    return next;
  }

  // ── reading ────────────────────────────────────────────────────────────────

  async list({ as }: Caller): Promise<AppSummary[]> {
    return [...this.apps.values()]
      .filter((a) => this.visible(a, as))
      .map((a) => ({
        name: a.name,
        description: a.def.description,
        owner: a.owner,
        access: a.owner === as ? "owner" : "granted",
        version: a.version,
        methods: Object.entries(a.def.methods)
          .filter(([m]) => this.mayCall(a, as, m))
          .map(([name, m]) => ({ name, kind: m.kind, description: m.description })),
        outputs: Object.keys(a.def.outputs ?? {}),
        updatedAt: a.updatedAt,
      }));
  }

  async describe(app: string, { as }: Caller): Promise<AppDescription> {
    const a = this.get(app);
    if (!this.visible(a, as)) throw new MiniAppError("not_found", `there is no app "${app}"`);
    const owner = a.owner === as;
    return {
      name: a.name,
      description: a.def.description,
      owner: a.owner,
      access: owner ? "owner" : "granted",
      version: a.version,
      updatedAt: a.updatedAt,
      schema: a.def.schema,
      methods: Object.entries(a.def.methods)
        .filter(([m]) => this.mayCall(a, as, m))
        .map(([name, m]) => ({ name, kind: m.kind, description: m.description, params: m.params ?? {} })),
      outputs: Object.entries(a.def.outputs ?? {}).map(([name, o]) => ({
        name,
        description: o.description,
        ...(o.every ? { every: o.every } : {}),
      })),
      subscriptions: a.def.subscriptions ?? [],
      ...(owner ? { grants: a.grants, definition: a.def } : {}),
    };
  }

  async events(app: string, { as, after = 0, limit = 100 }: Caller & { after?: number; limit?: number }): Promise<AppEvent[]> {
    const a = this.get(app);
    if (a.owner !== as && !this.grantFor(a, as)?.events) {
      throw new MiniAppError("forbidden", `reading the events of "${app}" needs an events grant from ${a.owner}`);
    }
    // LIMIT is written in, not bound: glove-sql takes only a literal there.
    const n = Math.min(Math.max(1, Math.trunc(Number(limit) || 100)), 1000);
    const rows = await this.serial(app, () =>
      a.storage.query(`SELECT * FROM "_events" WHERE "seq" > ${this.ph(1)} ORDER BY "seq" LIMIT ${n}`, [Number(after) || 0]),
    );
    return rows.map((r) => toEvent(a.name, r));
  }

  // ── deploying ──────────────────────────────────────────────────────────────

  async deploy(def: AppDefinition, opts: DeployOptions): Promise<DeployResult> {
    validateDefinition(def);
    const definition = structuredClone(def);
    return this.serial(def.name, async () => {
      const existing = this.apps.get(def.name);
      if (existing && existing.owner !== opts.as) {
        throw new MiniAppError("forbidden", `"${def.name}" belongs to ${existing.owner}; pick another name`);
      }
      const warnings = this.subscriptionWarnings(definition, opts.as);
      const from: Schema = existing?.def.schema ?? {};
      let ops: MigrationOp[];
      if (!existing) {
        if (opts.migration) throw new MiniAppError("invalid", `"${def.name}" is new, so there is nothing to migrate; deploy it without a migration`);
        ops = createOps(definition.schema);
      } else if (opts.migration) {
        let result: Schema;
        try {
          result = applyOps(from, opts.migration.ops);
        } catch (err) {
          throw new MiniAppError("invalid", (err as Error).message);
        }
        const diff = diffSchemas(result, definition.schema);
        if (diff.length) {
          throw new MiniAppError("invalid", "the migration does not produce the schema in the definition", diff);
        }
        ops = opts.migration.ops;
      } else {
        const derived = deriveAdditiveOps(from, definition.schema);
        if (!derived) {
          throw new MiniAppError(
            "invalid",
            `the schema change to "${def.name}" is not only additions, so it needs a migration: ` +
              `say which columns were renamed or dropped with ops such as rename_column and drop_column`,
            diffSchemas(from, definition.schema),
          );
        }
        ops = derived;
      }

      // Data steps are agent-written SQL like any method's: check each against
      // the schema as it stands at that point in the migration.
      let at = from;
      try {
        for (const [i, op] of ops.entries()) {
          if (op.op === "sql") checkStatement(op.sql, "action", at, `migration op ${i + 1} (sql)`);
          else at = applyOps(at, [op]);
        }
      } catch (err) {
        throw new MiniAppError("invalid", (err as Error).message);
      }

      const now = this.clock().toISOString();
      const version = (existing?.version ?? 0) + 1;
      const storage = existing?.storage ?? (await this.backend.open(def.name));
      const columns = columnIndex(definition.schema);
      try {
        await storage.transaction(async () => {
          if (!existing) await storage.migrate(createOps(SYSTEM_TABLES), {}, { reserved: true });
          let schema = from;
          let batch: StructuralOp[] = [];
          const flush = async () => {
            if (!batch.length) return;
            await storage.migrate(batch, schema);
            schema = applyOps(schema, batch);
            batch = [];
          };
          for (const op of ops) {
            if (op.op !== "sql") {
              batch.push(op);
              continue;
            }
            await flush();
            const c = compileNamed(op.sql, this.ph);
            await storage.query(c.text, bindValues(c, { caller: opts.as, now }, "migration sql step"));
          }
          await flush();
          if (!existing) {
            for (const [table, rows] of Object.entries(definition.seed ?? {})) {
              for (const row of rows) await this.insertRow(storage, table, row);
            }
          }
          if (!this.backend.capabilities.constraints) {
            await checkConstraints(storage, definition.schema, Object.keys(definition.schema));
          }
          await storage.syncKeys?.(definition.schema);
          await this.setMeta(storage, "version", String(version));
          if (!existing) {
            for (const name of Object.keys(definition.outputs ?? {})) await this.setMeta(storage, `output:${name}`, now);
          }
          await this.appendEvent(storage, version, "_deployed", { version, ops: ops.length }, opts.as, now);
          if (opts.dryRun) throw new DryRun();
        });
      } catch (err) {
        if (err instanceof DryRun) {
          if (!existing) await this.backend.drop(def.name);
          return { app: def.name, version, created: !existing, migration: ops, dryRun: true, warnings };
        }
        if (!existing) await this.backend.drop(def.name).catch(() => {});
        throw asFailure(err, `deploying "${def.name}"`, true);
      }

      const grants = existing?.grants ?? [];
      await this.system.transaction(async () => {
        if (existing) {
          await this.system.query(
            `UPDATE "apps" SET "version" = ${this.ph(1)}, "description" = ${this.ph(2)}, "updated_at" = ${this.ph(3)} WHERE "name" = ${this.ph(4)}`,
            [version, definition.description, now, def.name],
          );
        } else {
          await this.system.query(
            `INSERT INTO "apps" ("name", "owner", "description", "version", "grants", "created_at", "updated_at") VALUES (${[1, 2, 3, 4, 5, 6, 7].map(this.ph).join(", ")})`,
            [def.name, opts.as, definition.description, version, JSON.stringify(grants), now, now],
          );
        }
        await this.system.query(
          `INSERT INTO "versions" ("app", "version", "definition", "migration", "deployed_by", "deployed_at") VALUES (${[1, 2, 3, 4, 5, 6].map(this.ph).join(", ")})`,
          [def.name, version, JSON.stringify(definition), existing ? JSON.stringify({ ops }) : null, opts.as, now],
        );
      });
      this.apps.set(def.name, {
        name: def.name,
        owner: existing?.owner ?? opts.as,
        version,
        def: definition,
        grants,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        storage,
        columns,
        compiled: new Map(),
      });
      this.indexSubscriptions();
      return { app: def.name, version, created: !existing, migration: ops, dryRun: false, warnings };
    });
  }

  private subscriptionWarnings(def: AppDefinition, as: Principal): string[] {
    const out: string[] = [];
    for (const s of def.subscriptions ?? []) {
      const [source] = s.on.split(".");
      const src = this.apps.get(source);
      if (!src) out.push(`${s.on}: there is no app "${source}" yet; the subscription waits for it`);
      else if (src.owner !== as && !this.grantFor(src, as)?.events) {
        out.push(`${s.on}: ${src.owner} has not granted you its events, so nothing will arrive until they do`);
      }
    }
    return out;
  }

  private async insertRow(storage: AppStorage, table: string, row: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(row);
    if (!cols.length) return;
    await storage.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => this.ph(i + 1)).join(", ")})`,
      cols.map((c) => row[c]),
    );
  }

  private async setMeta(storage: AppStorage, key: string, value: string): Promise<void> {
    await storage.query(
      `INSERT INTO "_meta" ("key", "value") VALUES (${this.ph(1)}, ${this.ph(2)}) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
      [key, value],
    );
  }

  private async getMeta(storage: AppStorage, key: string): Promise<string | undefined> {
    const [row] = await storage.query(`SELECT "value" FROM "_meta" WHERE "key" = ${this.ph(1)}`, [key]);
    return row ? String(row.value) : undefined;
  }

  private async appendEvent(storage: AppStorage, version: number, event: string, data: unknown, caller: Principal, at: string): Promise<Row> {
    const [row] = await storage.query(
      `INSERT INTO "_events" ("version", "event", "data", "caller", "at") VALUES (${[1, 2, 3, 4, 5].map(this.ph).join(", ")}) RETURNING *`,
      [version, event, data === undefined ? null : JSON.stringify(data), caller, at],
    );
    return row;
  }

  // ── access changes ─────────────────────────────────────────────────────────

  async grant(app: string, grant: Grant, { as }: Caller): Promise<Grant[]> {
    const a = this.owned(app, as, "grant access");
    if (!grant?.to || typeof grant.to !== "string") throw new MiniAppError("invalid", "a grant names a principal in `to`");
    if (grant.to === a.owner) throw new MiniAppError("invalid", `${a.owner} owns "${app}" already`);
    const methods = grant.methods ?? [];
    if (methods !== "*") {
      if (!Array.isArray(methods)) throw new MiniAppError("invalid", `methods is a list of method names, or "*"`);
      for (const m of methods) if (!a.def.methods[m]) throw new MiniAppError("invalid", `"${app}" has no method "${m}"`);
    }
    const next = [...a.grants.filter((g) => g.to !== grant.to), { to: grant.to, methods, ...(grant.events ? { events: true } : {}) }];
    return this.saveGrants(a, next);
  }

  async revoke(app: string, to: Principal, { as }: Caller): Promise<Grant[]> {
    const a = this.owned(app, as, "revoke access");
    return this.saveGrants(a, a.grants.filter((g) => g.to !== to));
  }

  private async saveGrants(a: LoadedApp, grants: Grant[]): Promise<Grant[]> {
    await this.system.query(`UPDATE "apps" SET "grants" = ${this.ph(1)} WHERE "name" = ${this.ph(2)}`, [JSON.stringify(grants), a.name]);
    a.grants = grants;
    return grants;
  }

  async remove(app: string, { as }: Caller): Promise<void> {
    this.owned(app, as, "remove it");
    await this.serial(app, async () => {
      await this.system.transaction(async () => {
        await this.system.query(`DELETE FROM "versions" WHERE "app" = ${this.ph(1)}`, [app]);
        await this.system.query(`DELETE FROM "apps" WHERE "name" = ${this.ph(1)}`, [app]);
      });
      await this.backend.drop(app);
      this.apps.delete(app);
      this.indexSubscriptions();
    });
  }

  // ── calling ────────────────────────────────────────────────────────────────

  async call<T = unknown>(app: string, method: string, args: Record<string, unknown> | undefined, opts: Caller): Promise<CallResult<T>> {
    return this.callAt(app, method, args, opts, 0) as Promise<CallResult<T>>;
  }

  private async callAt(app: string, method: string, args: Record<string, unknown> | undefined, opts: Caller, depth: number, internal = false): Promise<CallResult> {
    // Resolved again once it is this call's turn: a deploy queued ahead of
    // it may have changed the method, or the access to it.
    const resolve = () => {
      const a = this.get(app);
      if (!internal && !this.visible(a, opts.as)) throw new MiniAppError("not_found", `there is no app "${app}"`);
      const m = a.def.methods[method];
      if (!m) {
        throw new MiniAppError("not_found", `"${app}" has no method "${method}" (methods: ${Object.keys(a.def.methods).join(", ")})`);
      }
      if (!internal && !this.mayCall(a, opts.as, method)) {
        throw new MiniAppError("forbidden", `${opts.as} may not call ${app}.${method}; ask ${a.owner} for a grant`);
      }
      return { a, m, values: checkArgs(app, method, m, args ?? {}) };
    };
    resolve();
    const result = await this.serial(app, () => {
      const { a, m, values } = resolve();
      return this.invoke(a, method, m, values, opts);
    });
    if (result.events.length) result.deliveries = await this.deliver(result.events, depth);
    return result;
  }

  private async invoke(a: LoadedApp, method: string, m: MethodDef, args: Record<string, unknown>, opts: Caller): Promise<CallResult> {
    const now = this.clock().toISOString();
    const pending: Array<{ event: string; data: unknown }> = [];
    const written = new Set<string>();
    const state = { failed: undefined as unknown };
    const body = async () => {
      const value = m.sql !== undefined
        ? await this.runSql(a, method, m, args, opts.as, now, pending, written)
        : await this.runJs(a, method, m.kind, m.js!, args, opts, now, pending, written, state);
      // A statement that failed fails the action even when the program caught
      // the error: Postgres has already aborted the transaction, and the other
      // backends must not commit half of what the program meant to do.
      if (state.failed) throw state.failed;
      return value;
    };
    try {
      if (m.kind === "query") return { value: await body(), events: [], version: a.version };
      return await a.storage.transaction(async () => {
        const value = await body();
        if (!this.backend.capabilities.constraints && written.size) {
          await checkConstraints(a.storage, a.def.schema, [...written]);
        }
        const events: AppEvent[] = [];
        for (const e of pending) events.push(toEvent(a.name, await this.appendEvent(a.storage, a.version, e.event, e.data, opts.as, now)));
        return { value, events, version: a.version };
      });
    } catch (err) {
      throw asFailure(err, `${a.name}.${method}`, m.kind === "action");
    }
  }

  private compiled(a: LoadedApp, key: string, sql: string): CompiledSql {
    let c = a.compiled.get(key);
    if (!c) {
      c = compileNamed(sql, this.ph);
      a.compiled.set(key, c);
    }
    return c;
  }

  private async runSql(
    a: LoadedApp,
    method: string,
    m: MethodDef,
    args: Record<string, unknown>,
    caller: Principal,
    now: string,
    pending: Array<{ event: string; data: unknown }>,
    written: Set<string>,
  ): Promise<unknown> {
    let rows: Row[] = [];
    const values = { ...args, caller, now };
    for (const [i, sql] of statements(m.sql).entries()) {
      const c = this.compiled(a, `${method}:${i}`, sql);
      for (const t of checkStatement(sql, m.kind, a.def.schema, `${a.name}.${method}`).writes) written.add(t);
      rows = normalize(await a.storage.query(c.text, bindValues(c, values, `${a.name}.${method}`)), a.columns, this.backend.capabilities.jsonAsText);
    }
    const value = m.returns === "one" ? (rows[0] ?? null) : rows;
    if (m.emits) pending.push({ event: m.emits, data: value });
    return value;
  }

  private async runJs(
    a: LoadedApp,
    method: string,
    kind: MethodKind,
    code: string,
    args: Record<string, unknown>,
    opts: Caller,
    now: string,
    pending: Array<{ event: string; data: unknown }>,
    written: Set<string>,
    state: { failed: unknown },
  ): Promise<unknown> {
    const where = `${a.name}.${method}`;
    const run = async (sql: string, params: Record<string, unknown> | undefined) => {
      try {
        if (typeof sql !== "string") throw new MiniAppError("invalid", "db.query takes { sql: string, params?: object }");
        for (const reserved of ["caller", "now"]) {
          if (params && reserved in params) throw new MiniAppError("invalid", `:${reserved} is always bound; don't pass it in params`);
        }
        const info = checkStatement(sql, kind, a.def.schema, where);
        for (const t of info.writes) written.add(t);
        const c = compileNamed(sql, this.ph);
        return normalize(
          await a.storage.query(c.text, bindValues(c, { ...(params ?? {}), caller: opts.as, now }, where)),
          a.columns,
          this.backend.capabilities.jsonAsText,
        );
      } catch (err) {
        state.failed ??= err;
        throw err instanceof SqlCheckError ? new MiniAppError("invalid", err.message) : err;
      }
    };
    const sqlInput = {
      type: "object",
      properties: { sql: { type: "string" }, params: { type: "object" } },
      required: ["sql"],
    };
    const fns: ToolFn[] = [
      {
        name: "db__query",
        description: "Run one statement; returns its rows.",
        inputSchema: sqlInput,
        call: async (x) => run(x.sql as string, x.params as Record<string, unknown> | undefined),
      },
      {
        name: "db__one",
        description: "Run one statement; returns the first row or null.",
        inputSchema: sqlInput,
        call: async (x) => (await run(x.sql as string, x.params as Record<string, unknown> | undefined))[0] ?? null,
      },
      {
        // Not `apps.call`: the sandbox refuses a member named call/apply/bind.
        name: "apps__query",
        description: "Call a query method of another app.",
        inputSchema: {
          type: "object",
          properties: { app: { type: "string" }, method: { type: "string" }, args: { type: "object" } },
          required: ["app", "method"],
        },
        call: async (x) => this.nestedQuery(a, String(x.app), String(x.method), x.args as Record<string, unknown> | undefined, opts),
      },
    ];
    if (kind === "action") {
      fns.push({
        name: "app__emit",
        description: "Record an event; it is delivered when the action commits.",
        inputSchema: { type: "object", properties: { event: { type: "string" }, data: {} }, required: ["event"] },
        call: async (x) => {
          const event = String(x.event);
          if (!/^[a-z][a-z0-9_]*$/.test(event)) throw new MiniAppError("invalid", "event names are lowercase letters, digits and _");
          pending.push({ event, data: x.data ?? null });
          return true;
        },
      });
    }
    const session = JsSession.create({
      fuel: this.fuel,
      actor: opts.as,
      elide: { maxItems: Number.MAX_SAFE_INTEGER, maxString: Number.MAX_SAFE_INTEGER, maxDepth: Number.MAX_SAFE_INTEGER },
    });
    session.registerAll(fns);
    const ctx = { app: a.name, version: a.version, method, caller: opts.as, now };
    // One line, so error positions in the method body keep their line numbers.
    const prelude = `const args = ${JSON.stringify(args)}; const ctx = ${JSON.stringify(ctx)}; `;
    try {
      return (await session.execute(prelude + code, { signal: opts.signal, actor: opts.as })).value;
    } catch (err) {
      // The interpreter wraps a capability's error in its own; report the
      // original, which carries the code (constraint, invalid, …).
      throw state.failed ?? err;
    }
  }

  /**
   * `apps.query` from inside a method: queries only, so an action never
   * changes two apps at once (another app changes by subscribing to this
   * one's events). It does not wait its turn on the other app, so two apps
   * reading each other cannot deadlock.
   */
  private async nestedQuery(from: LoadedApp, app: string, method: string, args: Record<string, unknown> | undefined, opts: Caller): Promise<unknown> {
    if (app === from.name) throw new MiniAppError("invalid", `call your own methods' logic directly; apps.query is for other apps`);
    const target = this.get(app);
    const m = target.def.methods[method];
    if (!m) throw new MiniAppError("not_found", `"${app}" has no method "${method}"`);
    if (m.kind !== "query") {
      throw new MiniAppError("invalid", `${app}.${method} is an action; from inside a method you may only read other apps — emit an event "${app}" subscribes to instead`);
    }
    // Reads run with the calling app's owner's access: an app can see what its owner can.
    if (!this.mayCall(target, from.owner, method)) {
      throw new MiniAppError("forbidden", `${from.owner} may not call ${app}.${method}`);
    }
    const values = checkArgs(app, method, m, args ?? {});
    const r = await this.invoke(target, method, m, values, { as: `app:${from.name}`, signal: opts.signal });
    return r.value;
  }

  private async deliver(events: AppEvent[], depth: number): Promise<Delivery[]> {
    const out: Delivery[] = [];
    for (const e of events) {
      await this.options.onEvent?.(e);
      if (depth >= this.maxDepth) continue;
      const source = this.apps.get(e.app);
      for (const sub of this.subscribers.get(`${e.app}.${e.event}`) ?? []) {
        const target = this.apps.get(sub.app);
        if (!source || !target) continue;
        if (target.owner !== source.owner && !this.grantFor(source, target.owner)?.events) continue;
        try {
          // The event's fields become the action's arguments; fields it does
          // not declare are dropped, so a source can add fields freely.
          const fields = e.data && typeof e.data === "object" && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : { data: e.data };
          const params = target.def.methods[sub.run]?.params ?? {};
          const args = Object.fromEntries(Object.entries(fields).filter(([k]) => k in params));
          const r = await this.callAt(sub.app, sub.run, args, { as: `app:${e.app}` }, depth + 1, true);
          out.push({ app: sub.app, method: sub.run, event: `${e.app}.${e.event}`, ok: true });
          if (r.deliveries) out.push(...r.deliveries);
        } catch (err) {
          out.push({ app: sub.app, method: sub.run, event: `${e.app}.${e.event}`, ok: false, error: (err as Error).message });
        }
      }
    }
    return out;
  }

  // ── outputs ────────────────────────────────────────────────────────────────

  async output(app: string, name: string, { as }: Caller): Promise<OutputResult> {
    const a = this.get(app);
    if (!this.visible(a, as)) throw new MiniAppError("not_found", `there is no app "${app}"`);
    if (a.owner !== as && this.grantFor(a, as)?.methods !== "*") {
      throw new MiniAppError("forbidden", `outputs of "${app}" are for its owner and for callers granted every method`);
    }
    return this.serial(app, () => this.runOutput(this.get(app), name, as, this.clock()));
  }

  private async runOutput(a: LoadedApp, name: string, as: Principal, at: Date): Promise<OutputResult> {
    const o = a.def.outputs?.[name];
    if (!o) throw new MiniAppError("not_found", `"${a.name}" has no output "${name}"`);
    const now = at.toISOString();
    const m: MethodDef = { kind: "query", description: o.description, ...(o.sql !== undefined ? { sql: o.sql } : { js: o.js }) };
    let value: unknown;
    try {
      value = m.sql !== undefined
        ? await this.runSql(a, `output:${name}`, m, {}, as, now, [], new Set())
        : await this.runJs(a, `output:${name}`, "query", m.js!, {}, { as }, now, [], new Set(), { failed: undefined });
    } catch (err) {
      throw asFailure(err, `${a.name} output ${name}`, false);
    }
    await this.setMeta(a.storage, `output:${name}`, now);
    return { app: a.name, output: name, at: now, value, markdown: typeof value === "string" };
  }

  async tick({ now = this.clock() }: { now?: Date } = {}): Promise<OutputResult[]> {
    const results: OutputResult[] = [];
    for (const a of [...this.apps.values()]) {
      for (const [name, o] of Object.entries(a.def.outputs ?? {})) {
        if (!o.every) continue;
        const every = parseInterval(o.every);
        const r = await this.serial(a.name, async (): Promise<OutputResult | undefined> => {
          const last = await this.getMeta(a.storage, `output:${name}`);
          if (last && now.getTime() - Date.parse(last) < every) return undefined;
          try {
            return await this.runOutput(this.get(a.name), name, "host", now);
          } catch (err) {
            // Counted as a run, so a broken output waits for its next turn
            // instead of failing on every tick.
            await this.setMeta(a.storage, `output:${name}`, now.toISOString());
            return { app: a.name, output: name, at: now.toISOString(), value: { error: (err as Error).message }, markdown: false };
          }
        });
        if (!r) continue;
        results.push(r);
        await this.options.onOutput?.(r);
      }
    }
    return results;
  }

  async close(): Promise<void> {
    await Promise.all([...this.chains.values()]);
    await this.backend.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toEvent(app: string, r: Row): AppEvent {
  return {
    seq: Number(r.seq),
    app,
    version: Number(r.version),
    event: String(r.event),
    data: r.data === null || r.data === undefined ? null : JSON.parse(String(r.data)),
    caller: String(r.caller),
    at: String(r.at),
  };
}

function columnIndex(schema: Schema): Map<string, ColumnType | "mixed"> {
  const out = new Map<string, ColumnType | "mixed">();
  for (const t of Object.values(schema)) {
    for (const [name, c] of Object.entries(t.columns)) {
      const seen = out.get(name);
      out.set(name, seen === undefined || seen === c.type ? c.type : "mixed");
    }
  }
  return out;
}

/**
 * Make a row look the same on every backend. Result columns are matched to
 * schema columns by name — the only thing a backend reports for every
 * statement — so give a computed column a name of its own.
 */
function normalize(rows: Row[], columns: Map<string, ColumnType | "mixed">, jsonAsText: boolean): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
      const t = columns.get(k);
      let x = v;
      if (x instanceof Date) x = x.toISOString();
      else if (typeof x === "bigint") x = Number(x);
      if (t === "boolean" && (x === 0 || x === 1)) x = x === 1;
      else if ((t === "integer" || t === "real") && typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) x = Number(x);
      else if (t === "json" && jsonAsText && typeof x === "string") {
        try {
          x = JSON.parse(x);
        } catch {
          // Text that is not JSON was written by hand; return it as it is.
        }
      }
      out[k] = x;
    }
    return out;
  });
}

const TYPE_CHECK: Record<ColumnType, (v: unknown) => boolean> = {
  text: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(typeof v === "string" ? Number(v) : v),
  real: (v) => typeof v === "number" || (typeof v === "string" && Number.isFinite(Number(v))),
  boolean: (v) => typeof v === "boolean" || v === 0 || v === 1,
  json: () => true,
  timestamp: (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)),
};

/** For engines that parse constraints and keep none: check the tables an action wrote. */
async function checkConstraints(storage: AppStorage, schema: Schema, tables: string[]): Promise<void> {
  const problems: string[] = [];
  for (const table of tables) {
    const def = schema[table];
    if (!def) continue;
    const rows = await storage.query(`SELECT * FROM "${table}"`);
    for (const [col, c] of Object.entries(def.columns)) {
      const unique = c.unique || c.primaryKey ? new Set<string>() : undefined;
      for (const row of rows) {
        const v = row[col];
        if (v === null || v === undefined) {
          if (!c.nullable) {
            problems.push(`${table}.${col} is required${autoKey(def) === col ? "" : " and was left empty"}`);
            break;
          }
          continue;
        }
        if (!TYPE_CHECK[c.type](v)) {
          problems.push(`${table}.${col} is ${c.type}; got ${JSON.stringify(v)}`);
          break;
        }
        if (unique) {
          const key = JSON.stringify(v);
          if (unique.has(key)) {
            problems.push(`${table}.${col} must be unique; ${key} appears twice`);
            break;
          }
          unique.add(key);
        }
      }
    }
  }
  if (problems.length) throw new MiniAppError("constraint", problems[0], problems);
}

/** Validate call arguments against the method's params; absent optionals bind as null. */
function checkArgs(app: string, method: string, m: MethodDef, args: Record<string, unknown>): Record<string, unknown> {
  const where = `${app}.${method}`;
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new MiniAppError("invalid", `${where}: arguments are an object`);
  const params = m.params ?? {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args)) {
    if (!params[k]) {
      const names = Object.keys(params);
      throw new MiniAppError("invalid", `${where} has no parameter "${k}" (parameters: ${names.length ? names.join(", ") : "none"})`);
    }
  }
  for (const [p, def] of Object.entries(params)) {
    const v = args[p];
    if (v === undefined || v === null) {
      if (!def.optional) throw new MiniAppError("invalid", `${where} needs "${p}" (${def.type})`);
      out[p] = null;
      continue;
    }
    if (!matches(def, v)) throw new MiniAppError("invalid", `${where}: "${p}" is ${def.type}; got ${JSON.stringify(v)}`);
    if (def.enum && !def.enum.includes(v as string | number)) {
      throw new MiniAppError("invalid", `${where}: "${p}" is one of ${def.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    }
    out[p] = v;
  }
  return out;
}

function matches(def: ParamDef, v: unknown): boolean {
  switch (def.type) {
    case "string":
      return typeof v === "string";
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
    case "any":
      return true;
  }
}

/** Turn whatever a method threw into a MiniAppError the caller can act on. */
function asFailure(err: unknown, where: string, reverted: boolean): MiniAppError {
  if (err instanceof MiniAppError) return err;
  const suffix = reverted ? "; nothing was changed" : "";
  if (err instanceof SqlCheckError) return new MiniAppError("invalid", err.message);
  const raw = err instanceof Error ? err.message : String(err);
  // glove-js adds a note for REPL users that tool calls already fired. Here
  // the action was rolled back, so the note would be wrong.
  const message = raw.split("\nNOTE:")[0].replace(/^uncaught: /, "");
  if (err instanceof JsError && /budget exceeded|call stack too deep/.test(message)) {
    return new MiniAppError("budget", `${where}: ${message}${suffix}`);
  }
  const code = (err as { code?: unknown }).code;
  if (/constraint failed|violates (not-null|unique|check) constraint|duplicate key/i.test(message) || code === "23505" || code === "23502") {
    return new MiniAppError("constraint", `${where}: ${message}${suffix}`);
  }
  return new MiniAppError("failed", `${where}: ${message}${suffix}`);
}

/**
 * Run `tick()` on a timer, for a process that hosts apps for a long time (the
 * Kuiper apps service, a Foundry server). The timer does not keep the process
 * alive. Returns a function that stops it.
 */
export function startTicker(host: AppHost, opts: { intervalMs?: number; onError?: (err: unknown) => void } = {}): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await host.tick();
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 60_000);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}
