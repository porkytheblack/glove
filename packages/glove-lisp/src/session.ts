/**
 * The Lisp session — one interpreter instance holding:
 *
 *   - the resource catalog (the SAME {@link ResourceTable} contract as
 *     glove-scratchpad, so one catalog mounts on either surface),
 *   - a persistent root environment (`def` survives across `execute` calls —
 *     big intermediates live HERE, not in the model's context),
 *   - the volatility caches (immutable across the session, stable within one
 *     `execute`; volatile is exactly-once by evaluation order),
 *   - the read-your-writes overlay (a fired write folds into later reads of the
 *     same resource, so the verify instinct is correct rather than forbidden),
 *   - staging (`(stage …)` records writes with their exact resolver arguments;
 *     `(commit!)` fires them in order; `(rollback!)` discards — a true dry run).
 *
 * Reads take the resource's declared columns as an argument map:
 * `(github_pull_requests {:state "open"})` pushes `state` down as an argument
 * (and re-filters the returned rows, so it holds even when the resolver ignores
 * it). A vector value fans out like SQL `IN`. Required-key columns must be
 * present — the error names them.
 */
import {
  bindingsKey,
  makeBindings,
  toRows,
  type ResourceContext,
  type ResourceTable,
  type SqlScalar,
} from "glove-scratchpad";
import { closest, Env } from "./env";
import { chargeFuel, evalForm, EvalCtx, LispError, NativeFn } from "./eval";
import { readAll } from "./reader";
import { stdlib } from "./stdlib";
import {
  DEFAULT_ELIDE,
  elide,
  eq as valEq,
  type ElideLimits,
  isPlainObject,
  Keyword,
  printForm,
} from "./values";

export interface LispPolicy {
  /** Allow writes at all. Default false. */
  writes?: boolean;
  /** Fold this session's fired writes into subsequent reads. Default true. */
  readYourWrites?: boolean;
}

export interface LispSessionOptions {
  policy?: LispPolicy;
  /** Stamped into resolver context. */
  actor?: string;
  /** Evaluation budget per `execute` call. Default 100_000. */
  fuel?: number;
  /** Max nested-call depth. Default 100. */
  maxDepth?: number;
  /** Output truncation limits for the value returned to the model. */
  elide?: Partial<ElideLimits>;
}

export interface LispExecuteOptions {
  allowWrites?: boolean;
  signal?: AbortSignal;
  actor?: string;
}

export interface TouchedResource {
  name: string;
  op: "select" | "insert" | "update" | "delete";
  /** Resolver invocations (a cached read is 0 calls). */
  calls: number;
}

export interface LispStagedView {
  resource: string;
  op: "insert" | "update" | "delete";
  rows?: Record<string, unknown>[];
  set?: Record<string, unknown>;
  match?: Record<string, SqlScalar[]>;
}

export interface LispExecuteResult {
  /** The last form's value, structurally elided to stay context-friendly. */
  value: unknown;
  elided: boolean;
  touched: TouchedResource[];
  /** Writes currently staged (pending commit!/rollback!). */
  staged?: LispStagedView[];
  /** Command tag(s) for fired writes — truth is cheap. */
  message?: string;
  note?: string;
  /** Symbols (def'd) this call — they persist for later calls. */
  defined?: string[];
  /** Per-def summaries (count + a small peek of real values) for list defs. */
  defs?: Record<string, unknown>;
  /** println output, if any. */
  stdout?: string[];
}

interface StagedWrite {
  resource: string;
  op: "insert" | "update" | "delete";
  detail: { rows?: Record<string, unknown>[]; set?: Record<string, unknown>; match?: Record<string, SqlScalar[]> };
  run: (ctx: ResourceContext) => Promise<unknown>;
}

type OverlayEntry =
  | { op: "insert"; rows: Record<string, unknown>[] }
  | { op: "update"; match: Record<string, SqlScalar[]>; set: Record<string, unknown> }
  | { op: "delete"; match: Record<string, SqlScalar[]> };

function scalarEq(a: unknown, b: unknown): boolean {
  return valEq(a, b);
}

/** A multi-line zod/MCP validation dump is unreadable mid-transcript — reduce it
 *  to one line naming the field, what was expected, and what arrived. */
function rewrapToolError(err: unknown, write: { op: string; resource: string }): LispError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Input validation error|invalid_type|-32602/.test(msg)) {
    const issues: string[] = [];
    const re = /"expected":\s*"([^"]+)"[\s\S]*?"path":\s*\[\s*"?([^\]"]*)"?\s*\][\s\S]*?(?:"received"|"message"):\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(msg)) !== null && issues.length < 3) {
      issues.push(`:${m[2] || "?"} expected ${m[1]}, got ${m[3]}`);
    }
    const detail = issues.length ? issues.join("; ") : "a field has the wrong type or is missing";
    return new LispError(
      `${write.op}! on "${write.resource}": the tool rejected the row — ${detail}. Run (describe :${write.resource}) for column types, and pass strings for text columns (use "" not nil).`,
    );
  }
  return err instanceof LispError ? err : new LispError(msg);
}

/** Drop nil-valued keys from a row (Clojure APIs omit absent fields). */
function stripNilColumns(r: Record<string, unknown>): Record<string, unknown> {
  let hasNil = false;
  for (const k in r) {
    if (r[k] === null || r[k] === undefined) {
      hasNil = true;
      break;
    }
  }
  if (!hasNil) return r;
  const out: Record<string, unknown> = {};
  for (const k in r) if (r[k] !== null && r[k] !== undefined) out[k] = r[k];
  return out;
}

function overlayMatch(row: Record<string, unknown>, match: Record<string, SqlScalar[]>): boolean {
  for (const [col, vals] of Object.entries(match)) {
    if (!vals.some((v) => scalarEq(row[col], v))) return false;
  }
  return true;
}

/** A clear "this capability can't do X" error listing what it CAN do. */
function capabilityError(name: string, op: string, r: ResourceTable): string {
  const ops = [r.select && "read", r.insert && "insert!", r.update && "update!", r.delete && "delete!"]
    .filter(Boolean)
    .join(", ");
  return `resource "${name}" does not support ${op} (it supports: ${ops || "nothing"}). There is no underlying tool for that verb.`;
}

function asScalar(v: unknown, col: string, table: string): SqlScalar {
  if (v instanceof Keyword) return v.name;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  throw new LispError(
    `(${table} {:${col} …}): argument values must be strings, numbers, booleans, or vectors of those — got ${printForm(v)}`,
  );
}

/** Per-call bookkeeping shared with the resource fns via the eval context. */
interface CallState {
  ctx: ResourceContext;
  touched: Map<string, TouchedResource>;
  messages: string[];
  allowWrites: boolean;
  sawEmptyRead?: string;
}

type SessionCtx = EvalCtx & { call: CallState; stdout: string[] };

export class LispSession {
  private resources = new Map<string, ResourceTable>();
  private builtins: Env;
  private root: Env;
  private immutableCache = new Map<string, Record<string, unknown>[]>();
  private overlay = new Map<string, OverlayEntry[]>();
  private pending: StagedWrite[] | null = null;
  private staging = false;
  private policy: Required<LispPolicy>;
  private actor?: string;
  private fuelBudget: number;
  private maxDepth: number;
  private elideLimits: ElideLimits;

  private constructor(opts: LispSessionOptions) {
    this.policy = { writes: opts.policy?.writes ?? false, readYourWrites: opts.policy?.readYourWrites ?? true };
    this.actor = opts.actor;
    this.fuelBudget = opts.fuel ?? 100_000;
    this.maxDepth = opts.maxDepth ?? 100;
    this.elideLimits = { ...DEFAULT_ELIDE, ...opts.elide };
    this.builtins = new Env();
    for (const [name, fn] of stdlib()) this.builtins.set(name, fn);
    this.installSurface();
    this.root = new Env(this.builtins);
  }

  static create(opts: LispSessionOptions = {}): LispSession {
    return new LispSession(opts);
  }

  register(resource: ResourceTable): void {
    if (this.resources.has(resource.name)) {
      throw new Error(`glove-lisp: resource "${resource.name}" is already registered`);
    }
    this.resources.set(resource.name, resource);
    this.builtins.set(resource.name, this.readFnFor(resource));
  }

  registerAll(resources: ResourceTable[]): void {
    for (const r of resources) this.register(r);
  }

  /** The registered catalog (for the mount preamble and for `(tables)`). */
  list(): ResourceTable[] {
    return [...this.resources.values()];
  }

  /** Writes currently staged and awaiting `(commit!)`. */
  preview(): LispStagedView[] {
    return (this.pending ?? []).map((w) => ({ resource: w.resource, op: w.op, ...w.detail }));
  }

  /** Forget this session's recorded writes (reset read-your-writes). */
  clearWrites(): void {
    this.overlay.clear();
  }

  /** Names `def`'d so far — the session's scratchpad contents. */
  definitions(): string[] {
    return this.root.ownNames();
  }

  // ── execute ────────────────────────────────────────────────────────────────

  async execute(code: string, opts: LispExecuteOptions = {}): Promise<LispExecuteResult> {
    const forms = readAll(code);
    const call: CallState = {
      ctx: { signal: opts.signal, cache: new Map(), actor: opts.actor ?? this.actor },
      touched: new Map(),
      messages: [],
      allowWrites: opts.allowWrites ?? false,
    };
    const stdout: string[] = [];
    const ctx: SessionCtx = {
      fuel: { remaining: this.fuelBudget },
      depth: 0,
      maxDepth: this.maxDepth,
      rootEnv: this.root,
      signal: opts.signal,
      extraSpecials: {
        stage: (items, env, c) => this.evalStage(items, env, c as SessionCtx),
      },
      call,
      stdout,
    };

    const before = new Set(this.root.ownNames());
    let value: unknown = null;
    for (const form of forms) value = await evalForm(form, this.root, ctx);
    const defined = this.root.ownNames().filter((n) => !before.has(n));

    const { value: elided, elided: didElide } = elide(value, this.elideLimits);
    const out: LispExecuteResult = {
      value: elided,
      elided: didElide,
      touched: [...call.touched.values()],
    };
    if (defined.length) {
      out.defined = defined;
      // Per-def summaries with a peek of REAL values. A model whose last form
      // was a scalar (count) otherwise reports rows it never saw — one computed
      // a perfect 13-row join, returned its count, then fabricated the pairs.
      const defs: Record<string, unknown> = {};
      for (const n of defined) {
        const looked = this.root.lookup(n);
        const v = looked.found ? looked.value : undefined;
        if (Array.isArray(v) && v.length > 0) {
          const el = v[0];
          const peek =
            el !== null && typeof el === "object" && !Array.isArray(el)
              ? Object.fromEntries(
                  Object.entries(el as Record<string, unknown>)
                    .slice(0, 4)
                    .map(([k, x]) => [k, typeof x === "string" && x.length > 40 ? x.slice(0, 40) + "…" : x]),
                )
              : v.slice(0, 3);
          defs[n] = { count: v.length, peek };
        }
      }
      if (Object.keys(defs).length) out.defs = defs;
    }
    if (stdout.length) out.stdout = stdout;
    if (call.messages.length) out.message = call.messages.join(" ");
    if (this.pending && this.pending.length) out.staged = this.preview();
    if (
      Array.isArray(value) &&
      value.length === 0 &&
      call.sawEmptyRead &&
      out.touched.some((t) => t.op === "select")
    ) {
      out.note =
        `0 items came back. If you expected data, re-check your argument values before concluding it doesn't exist — ` +
        `(describe :${call.sawEmptyRead}) lists each column's valid values, and calling the resource with no arguments shows real rows.`;
    }
    return out;
  }

  // ── the model-facing surface ───────────────────────────────────────────────

  private installSurface(): void {
    this.builtins.set(
      "tables",
      new NativeFn("tables", () =>
        this.list().map((r) => ({
          name: r.name,
          description: r.description,
          volatility: r.volatility,
          ops: [r.select && "read", r.insert && "insert!", r.update && "update!", r.delete && "delete!"].filter(Boolean),
        })),
      ),
    );

    this.builtins.set(
      "describe",
      new NativeFn(
        "describe",
        (args) => {
          if (args.length !== 1) throw new LispError("describe takes one resource name — (describe :github_pull_requests)");
          const r = this.resolveResource(args[0], "describe");
          return {
            name: r.name,
            description: r.description,
            volatility: r.volatility,
            ops: [r.select && "read", r.insert && "insert!", r.update && "update!", r.delete && "delete!"].filter(Boolean),
            columns: r.columns.map((c) => ({
              name: c.name,
              type: c.type,
              ...(c.requiredKey ? { required: true } : {}),
              ...(c.description ? { description: c.description } : {}),
            })),
            usage: r.select
              ? `(${r.name}) or (${r.name} {:col value}) — a {…} map pushes arguments down; vector values fan out like IN`
              : `write-only — see insert!/update!/delete!`,
          };
        },
        "(describe :resource-name)",
      ),
    );

    this.builtins.set(
      "insert!",
      new NativeFn(
        "insert!",
        (args, ctx) => {
          if (args.length !== 2) throw new LispError("insert! takes (insert! :table row-map) or (insert! :table [row1 row2 …])");
          const r = this.resolveResource(args[0], "insert!");
          if (!r.insert) throw new LispError(capabilityError(r.name, "insert!", r));
          const rows = this.checkRows(r, args[1]);
          return this.performWrite(ctx as SessionCtx, {
            resource: r.name,
            op: "insert",
            detail: { rows },
            run: (rc) => r.insert!(rows, rc),
          });
        },
        '(insert! :emails {:to_addr "a@b.io" :subject "hi" :body "…"})',
      ),
    );

    this.builtins.set(
      "update!",
      new NativeFn(
        "update!",
        (args, ctx) => {
          if (args.length !== 3) {
            throw new LispError("update! takes (update! :table {:set-col value} {:match-col value}) — the SET map first, then the match map");
          }
          const r = this.resolveResource(args[0], "update!");
          if (!r.update) throw new LispError(capabilityError(r.name, "update!", r));
          const set = this.checkMap(r, args[1], "update!", "SET");
          const match = this.checkMatch(r, args[2], "update!");
          return this.performWrite(ctx as SessionCtx, {
            resource: r.name,
            op: "update",
            detail: { set, match },
            run: (rc) => r.update!(set, makeBindings(new Map(Object.entries(match))), rc),
          });
        },
        '(update! :linear_issues {:state "done"} {:id "LIN-42"})',
      ),
    );

    this.builtins.set(
      "delete!",
      new NativeFn(
        "delete!",
        (args, ctx) => {
          if (args.length !== 2) throw new LispError("delete! takes (delete! :table {:match-col value})");
          const r = this.resolveResource(args[0], "delete!");
          if (!r.delete) throw new LispError(capabilityError(r.name, "delete!", r));
          const match = this.checkMatch(r, args[1], "delete!");
          return this.performWrite(ctx as SessionCtx, {
            resource: r.name,
            op: "delete",
            detail: { match },
            run: (rc) => r.delete!(makeBindings(new Map(Object.entries(match))), rc),
          });
        },
        '(delete! :calendar_events {:id "evt_1"})',
      ),
    );

    this.builtins.set(
      "commit!",
      new NativeFn("commit!", async (args, ctx) => {
        if (args.length !== 0) throw new LispError("commit! takes no arguments");
        if (!this.pending || this.pending.length === 0) {
          throw new LispError("nothing is staged — use (stage …) to stage writes first, or just run the write directly to fire it immediately");
        }
        const sctx = ctx as SessionCtx;
        const writes = this.pending;
        this.pending = null;
        const tags: string[] = [];
        for (const w of writes) {
          await w.run(sctx.call.ctx);
          this.recordOverlay(w);
          this.touch(sctx, w.resource, w.op, 1);
          tags.push(this.commandTag(w));
        }
        sctx.call.messages.push(`COMMIT — ${tags.join("; ")}.`);
        return { committed: writes.length };
      }),
    );

    this.builtins.set(
      "rollback!",
      new NativeFn("rollback!", (args) => {
        if (args.length !== 0) throw new LispError("rollback! takes no arguments");
        const n = this.pending?.length ?? 0;
        if (n === 0) {
          throw new LispError(
            "nothing is staged — rollback! only discards writes staged with (stage …). Nothing has fired; there is nothing to undo.",
          );
        }
        this.pending = null;
        return { rolledBack: n };
      }),
    );
  }

  private async evalStage(items: import("./values").Form[], env: Env, ctx: SessionCtx): Promise<unknown> {
    if (this.staging) throw new LispError("stage cannot be nested");
    if (this.pending && this.pending.length) {
      throw new LispError("writes are already staged — run (commit!) to fire them or (rollback!) to discard before staging more");
    }
    if (items.length === 0) throw new LispError("stage takes a body — (stage (insert! …) (insert! …))");
    this.pending = [];
    this.staging = true;
    try {
      let out: unknown = null;
      for (const f of items) out = await evalForm(f, env, ctx);
      const staged = this.preview();
      if (staged.length === 0) {
        // A body that evaluated but staged nothing (e.g. plain maps instead of
        // write calls) would otherwise "succeed" silently and strand the model
        // at a no-op (commit!).
        this.pending = null;
        throw new LispError(
          "stage ran its body but no writes were staged — the body must CALL the write fns: (stage (insert! :table {…}) (insert! :table {…})). Plain maps or lists are just values.",
        );
      }
      ctx.call.messages.push(
        `staged ${staged.length} write(s) — nothing has fired yet. Inspect them, then (commit!) to fire in order or (rollback!) to discard.`,
      );
      return { staged, value: out };
    } catch (err) {
      this.pending = null; // a failed stage discards its partial staging
      throw err;
    } finally {
      this.staging = false;
    }
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  private readFnFor(resource: ResourceTable): NativeFn {
    return new NativeFn(
      resource.name,
      async (args, ctx) => {
        if (!resource.select) throw new LispError(capabilityError(resource.name, "read", resource));
        if (args.length > 1 || (args.length === 1 && !isPlainObject(args[0]) && args[0] !== null)) {
          throw new LispError(
            `(${resource.name} …) takes at most one argument map — e.g. (${resource.name} {:${resource.columns[0]?.name ?? "col"} value})`,
          );
        }
        const argMap = (args[0] ?? {}) as Record<string, unknown>;
        const eqMap = this.bindingsOf(resource, argMap);
        const missing = resource.columns.filter((c) => c.requiredKey && !eqMap.has(c.name)).map((c) => c.name);
        if (missing.length > 0) {
          throw new LispError(
            `resource "${resource.name}" requires ${missing.map((m) => `:${m}`).join(", ")} — call (${resource.name} {:${missing[0]} …}). (describe :${resource.name}) shows all columns.`,
          );
        }
        const sctx = ctx as SessionCtx;
        const rows = await this.resolveRows(resource, eqMap, sctx);
        const stamped = this.stampBindings(rows, eqMap);
        const merged = this.applyOverlay(resource, stamped);
        const filtered = this.residualFilter(merged, eqMap);
        chargeFuel(ctx, filtered.length);
        if (filtered.length === 0) sctx.call.sawEmptyRead = resource.name;
        // Rows omit nil-valued columns — the shape a Clojure API returns.
        // `(:col row)` still yields nil, but `(contains? row :col)` and
        // `(filter :col rows)` now mean "has a value", which is what a model
        // writing them intends. Nil-filled rows made contains? always-true —
        // a silent wrong answer on every "has a link?" filter.
        return filtered.map(stripNilColumns);
      },
      `(${resource.name}) or (${resource.name} {:col value, …})`,
    );
  }

  private bindingsOf(resource: ResourceTable, argMap: Record<string, unknown>): Map<string, SqlScalar[]> {
    const declared = new Map(resource.columns.map((c) => [c.name, c]));
    const eqMap = new Map<string, SqlScalar[]>();
    for (const [key, raw] of Object.entries(argMap)) {
      if (!declared.has(key)) {
        const hint = closest(key, [...declared.keys()]);
        throw new LispError(
          `resource "${resource.name}" has no column :${key}${hint ? ` — did you mean :${hint}?` : ""}. Columns: ${[...declared.keys()].map((c) => `:${c}`).join(", ")}.`,
        );
      }
      const vals = Array.isArray(raw) ? raw : [raw];
      if (vals.length === 0) {
        throw new LispError(`(${resource.name} {:${key} []}): an empty vector matches nothing — pass at least one value`);
      }
      eqMap.set(
        key,
        vals.map((v) => asScalar(v, key, resource.name)),
      );
    }
    return eqMap;
  }

  private async resolveRows(
    resource: ResourceTable,
    eqMap: Map<string, SqlScalar[]>,
    sctx: SessionCtx,
  ): Promise<Record<string, unknown>[]> {
    const key = `${resource.name}::${bindingsKey(eqMap)}`;
    if (resource.volatility === "immutable" && this.immutableCache.has(key)) {
      this.touch(sctx, resource.name, "select", 0);
      return this.immutableCache.get(key)!;
    }
    if (resource.volatility === "stable" && sctx.call.ctx.cache.has(key)) {
      this.touch(sctx, resource.name, "select", 0);
      return sctx.call.ctx.cache.get(key) as Record<string, unknown>[];
    }
    const data = await resource.select!(makeBindings(eqMap), sctx.call.ctx);
    const rows = toRows(data);
    if (resource.volatility === "immutable") this.immutableCache.set(key, rows);
    if (resource.volatility === "stable") sctx.call.ctx.cache.set(key, rows);
    this.touch(sctx, resource.name, "select", 1);
    return rows;
  }

  /** Echo single-valued pushed-down arguments into rows that don't carry them. */
  private stampBindings(
    rows: Record<string, unknown>[],
    eqMap: Map<string, SqlScalar[]>,
  ): Record<string, unknown>[] {
    const single = [...eqMap.entries()].filter(([, v]) => v.length === 1);
    if (single.length === 0) return rows;
    return rows.map((row) => {
      let out = row;
      for (const [col, [v]] of single) {
        if (out[col] === undefined) out = { ...out, [col]: v };
      }
      return out;
    });
  }

  /** Keep only rows matching every bound column — the argument is also a filter,
   *  so pushdown holds even when a resolver ignores an argument. */
  private residualFilter(
    rows: Record<string, unknown>[],
    eqMap: Map<string, SqlScalar[]>,
  ): Record<string, unknown>[] {
    if (eqMap.size === 0) return rows;
    return rows.filter((row) => {
      for (const [col, vals] of eqMap) {
        if (!vals.some((v) => scalarEq(row[col], v))) return false;
      }
      return true;
    });
  }

  // ── writes ────────────────────────────────────────────────────────────────

  private async performWrite(ctx: SessionCtx, write: StagedWrite): Promise<unknown> {
    if (!this.policy.writes || !ctx.call.allowWrites) {
      throw new LispError(
        `writes are disabled on this session — ${write.op}! on "${write.resource}" was NOT performed.`,
      );
    }
    const count = write.detail.rows?.length ?? 1;
    if (this.staging) {
      this.pending!.push(write);
      return { op: write.op, resource: write.resource, staged: true, count };
    }
    if (this.pending && this.pending.length) {
      throw new LispError(
        "writes are staged and pending — run (commit!) to fire them or (rollback!) to discard before writing outside the stage",
      );
    }
    let result: unknown;
    try {
      result = await write.run(ctx.call.ctx);
    } catch (err) {
      throw rewrapToolError(err, write);
    }
    this.recordOverlay(write);
    this.touch(ctx, write.resource, write.op, 1);
    ctx.call.messages.push(`${this.commandTag(write)}.`);
    return { op: write.op, resource: write.resource, fired: true, count, result };
  }

  /** Postgres answers `INSERT 0 15`; we answer in kind — a write result always
   *  carries its row count, so "did it happen?" never needs a verification read. */
  private commandTag(w: StagedWrite): string {
    const n = w.detail.rows?.length ?? 1;
    return `${w.op}! on "${w.resource}" fired — ${n} row(s)`;
  }

  private recordOverlay(w: StagedWrite): void {
    if (!this.policy.readYourWrites) return;
    const log = this.overlay.get(w.resource) ?? [];
    if (w.op === "insert") log.push({ op: "insert", rows: w.detail.rows ?? [] });
    else if (w.op === "update") log.push({ op: "update", match: w.detail.match ?? {}, set: w.detail.set ?? {} });
    else log.push({ op: "delete", match: w.detail.match ?? {} });
    this.overlay.set(w.resource, log);
  }

  private applyOverlay(resource: ResourceTable, live: Record<string, unknown>[]): Record<string, unknown>[] {
    const log = this.overlay.get(resource.name);
    if (!log || log.length === 0) return live;
    const keyCols = resource.columns.filter((c) => c.requiredKey).map((c) => c.name);
    let rows = live.slice();
    for (const e of log) {
      if (e.op === "insert") {
        if (keyCols.length > 0) {
          const insKeys = e.rows
            .filter((ins) => keyCols.every((k) => ins[k] != null))
            .map((ins) => keyCols.map((k) => ins[k]));
          if (insKeys.length > 0) {
            rows = rows.filter((r) => !insKeys.some((ik) => keyCols.every((k, i) => scalarEq(r[k], ik[i]))));
          }
        }
        // An upstream that already reflects the write must not be double-counted:
        // skip an overlay row when some live row carries all its values (the
        // fired insert came back through the read). Without this, a re-read
        // after commit showed 30 "Verify:" issues where 15 were written.
        const reflected = (ins: Record<string, unknown>): boolean =>
          rows.some((r) => Object.entries(ins).every(([k, v]) => v === null || v === undefined || scalarEq(r[k] as SqlScalar, v as SqlScalar)));
        rows = rows.concat(e.rows.filter((ins) => !reflected(ins)));
      } else if (e.op === "update") {
        rows = rows.map((r) => (overlayMatch(r, e.match) ? { ...r, ...e.set } : r));
      } else {
        rows = rows.filter((r) => !overlayMatch(r, e.match));
      }
    }
    return rows;
  }

  // ── shared checks ─────────────────────────────────────────────────────────

  private resolveResource(nameArg: unknown, fn: string): ResourceTable {
    let name: string;
    if (nameArg instanceof Keyword) name = nameArg.name;
    else if (typeof nameArg === "string") name = nameArg;
    else if (nameArg instanceof NativeFn && this.resources.has(nameArg.name)) name = nameArg.name;
    else {
      throw new LispError(`${fn}: name the resource with a keyword, e.g. (${fn} :emails …) — got ${printForm(nameArg)}`);
    }
    const r = this.resources.get(name);
    if (!r) {
      const hint = closest(name, [...this.resources.keys()]);
      throw new LispError(
        `unknown resource "${name}"${hint ? ` — did you mean :${hint}?` : ""}. Run (tables) to list resources.`,
      );
    }
    return r;
  }

  private checkRows(r: ResourceTable, arg: unknown): Record<string, unknown>[] {
    const rows = Array.isArray(arg) ? arg : [arg];
    if (rows.length === 0) throw new LispError(`insert! into "${r.name}": the row vector is empty`);
    const declared = new Set(r.columns.map((c) => c.name));
    return rows.map((row, i) => {
      if (!isPlainObject(row)) {
        throw new LispError(`insert! into "${r.name}": row ${i + 1} must be a {:col value} map, got ${printForm(row)}`);
      }
      for (const k of Object.keys(row)) {
        if (!declared.has(k)) {
          const hint = closest(k, [...declared]);
          throw new LispError(
            `insert! into "${r.name}": unknown column :${k}${hint ? ` — did you mean :${hint}?` : ""}. Columns: ${[...declared].map((c) => `:${c}`).join(", ")}.`,
          );
        }
      }
      return this.plainRow(row);
    });
  }

  private checkMap(r: ResourceTable, arg: unknown, fn: string, what: string): Record<string, unknown> {
    if (!isPlainObject(arg)) throw new LispError(`${fn} on "${r.name}": the ${what} map must be {:col value}, got ${printForm(arg)}`);
    const declared = new Set(r.columns.map((c) => c.name));
    for (const k of Object.keys(arg)) {
      if (!declared.has(k)) {
        const hint = closest(k, [...declared]);
        throw new LispError(
          `${fn} on "${r.name}": unknown column :${k}${hint ? ` — did you mean :${hint}?` : ""}. Columns: ${[...declared].map((c) => `:${c}`).join(", ")}.`,
        );
      }
    }
    return this.plainRow(arg);
  }

  private checkMatch(r: ResourceTable, arg: unknown, fn: string): Record<string, SqlScalar[]> {
    const m = this.checkMap(r, arg, fn, "match");
    const out: Record<string, SqlScalar[]> = {};
    for (const [k, v] of Object.entries(m)) {
      const vals = Array.isArray(v) ? v : [v];
      out[k] = vals.map((x) => asScalar(x, k, r.name));
    }
    return out;
  }

  /** Strip Keywords out of row values (resolvers receive plain JSON). */
  private plainRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = v instanceof Keyword ? v.name : v;
    return out;
  }

  private touch(ctx: SessionCtx, name: string, op: TouchedResource["op"], calls: number): void {
    const key = `${name}::${op}`;
    const cur = ctx.call.touched.get(key);
    if (cur) cur.calls += calls;
    else ctx.call.touched.set(key, { name, op, calls });
  }
}
