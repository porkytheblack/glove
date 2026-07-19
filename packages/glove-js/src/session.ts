/**
 * The JS session — one interpreter instance holding a persistent root scope
 * (top-level `const`/`let` survive across `execute` calls, so big intermediates
 * live HERE, not in the model's context), the registered tool functions, and
 * the console sink. Mirrors glove-lisp's `LispSession`, minus the table
 * machinery: a function call fires immediately, there is no staging.
 */
import {
  closest,
  describeFn,
  elide,
  fnSignature,
  missingRequired,
  unknownKeys,
  serverSummaries,
  fnsForServer,
  searchFns,
  sampleOne,
  DEFAULT_ELIDE,
  DISCOVERY_BUILTINS,
  DISCOVERY_BUILTIN_NAMES,
  discoveryArg,
  hasDiscoveryArg,
  type DiscoveryKind,
  type ElideLimits,
  type FnDescription,
  type ServerSummary,
  type ToolFn,
} from "glove-scratchpad/fns";
import { JsError } from "./errors";
import { parseProgram } from "./parse";
import { Scope } from "./scope";
import { makeGlobals, type StdoutSink } from "./globals";
import { formatProgramError, runProgram, type EvalCtx } from "./interp";

export interface JsSessionOptions {
  /** Evaluation budget per `execute`. Default 100_000. */
  fuel?: number;
  /** Max nested-call depth. Default 100. */
  maxDepth?: number;
  /** Output truncation limits for the value returned to the model. */
  elide?: Partial<ElideLimits>;
  /** Stamped into the tool-call context as the actor. */
  actor?: string;
}

export interface JsExecuteOptions {
  signal?: AbortSignal;
  actor?: string;
}

export interface JsExecuteResult {
  /** The last top-level expression's value, structurally elided. */
  value: unknown;
  elided: boolean;
  /** Tool invocations this call (name → count). */
  called: Array<{ name: string; calls: number }>;
  /** Names declared at top level this call — they persist for later calls. */
  defined?: string[];
  /** Per-def summaries (count + a small peek) for array defs. */
  defs?: Record<string, unknown>;
  /** console.* output, if any. */
  stdout?: string[];
  note?: string;
}

interface Runtime {
  signal?: AbortSignal;
  actor?: string;
  called: Map<string, number>;
}

/** Discovery builtins — the short names AND the native-tool-name aliases
 *  (search_functions / list_functions / …), so a call lands whichever front
 *  door the model learned. Shared across the fn-mode REPLs. */
const RESERVED = new Set(DISCOVERY_BUILTIN_NAMES);

export class JsSession {
  private root: Scope;
  private sink: StdoutSink = { out: [] };
  private globalNames: Set<string>;
  private toolFns = new Map<string, ToolFn>();
  /** Memoized server grouping; invalidated when a function is registered. */
  private serverCache?: ServerSummary[];
  private namespaces = new Map<string, Record<string, unknown>>();
  private runtime: Runtime = { called: new Map() };
  private actor?: string;
  private fuelBudget: number;
  private maxDepth: number;
  private elideLimits: ElideLimits;

  private constructor(opts: JsSessionOptions) {
    this.actor = opts.actor;
    this.fuelBudget = opts.fuel ?? 100_000;
    this.maxDepth = opts.maxDepth ?? 100;
    this.elideLimits = { ...DEFAULT_ELIDE, ...opts.elide };
    this.root = new Scope(undefined, true);
    const globals = makeGlobals(this.sink);
    this.globalNames = new Set(Object.keys(globals));
    for (const [name, value] of Object.entries(globals)) this.root.declare(name, value, true);
    this.installSurface();
  }

  static create(opts: JsSessionOptions = {}): JsSession {
    return new JsSession(opts);
  }

  /**
   * Register a {@link ToolFn}. It becomes callable by its flat name
   * (`github__list_pull_requests(...)`) and, when the name has a `__` namespace,
   * as a member of a frozen namespace object (`github.list_pull_requests(...)`).
   *
   * IMPORTANT: a call FIRES the tool immediately — there is no staging. Register
   * effectful functions only on a session you are comfortable firing.
   */
  register(fn: ToolFn): void {
    const name = fn.name;
    if (this.toolFns.has(name)) throw new Error(`glove-js: function "${name}" is already registered`);
    if (this.globalNames.has(name) || RESERVED.has(name)) {
      throw new Error(
        `glove-js: cannot register function "${name}" — the name is a builtin. Rename it (defineFn's "name", fnFromTool's opts.name, or fnsFromMcp's opts.filter).`,
      );
    }
    if (this.namespaces.has(name)) {
      throw new Error(`glove-js: cannot register function "${name}" — that name is already a namespace object.`);
    }
    this.toolFns.set(name, fn);
    this.serverCache = undefined; // catalog changed — regroup on next discover
    this.root.declare(name, this.bindTool(fn), true);

    const sep = name.indexOf("__");
    if (sep > 0 && sep + 2 < name.length) {
      const ns = name.slice(0, sep);
      const rest = name.slice(sep + 2);
      if (!this.globalNames.has(ns) && !RESERVED.has(ns) && !this.toolFns.has(ns)) {
        const record = this.namespaces.get(ns) ?? {};
        record[rest] = this.bindTool(fn);
        this.namespaces.set(ns, record);
        this.root.declare(ns, Object.freeze({ ...record }), true);
      }
    }
  }

  registerAll(fns: ToolFn[]): void {
    for (const fn of fns) this.register(fn);
  }

  /** The registered functions (for the mount preamble and for `fns()`). */
  list(): ToolFn[] {
    return [...this.toolFns.values()];
  }

  // ── progressive discovery (shared by the REPL builtins and the native tools) ─

  /** Tier 1 — the servers (MCP namespaces) in the catalog, with fn counts. */
  discoverServers(): ServerSummary[] {
    return (this.serverCache ??= serverSummaries(this.list()));
  }

  /** Tier 2 — one server's functions as `{ name, signature, effect }`. */
  discoverFunctions(server: string): Array<{ name: string; description?: string; signature: string; effect?: string }> {
    const fns = fnsForServer(this.list(), server);
    if (fns.length === 0) {
      const hint = closest(server, this.discoverServers().map((s) => s.name));
      throw new JsError(
        `no server named '${server}'${hint ? ` — did you mean '${hint}'?` : ""}. Call fns() with no argument, or servers(), to list them.`,
      );
    }
    return fns.map((fn) => this.fnRow(fn));
  }

  /** Search — jump straight to the functions matching a free-text query. */
  searchFunctions(query: string): Array<{ name: string; description?: string; signature: string; effect?: string }> {
    return searchFns(this.list(), String(query)).map((fn) => this.fnRow(fn));
  }

  /** Tier 3 — one function's full schema (params + result shape). Warms the
   *  result shape on demand (one read) rather than sampling the whole catalog. */
  async describeFunction(name: string): Promise<FnDescription> {
    const fn = this.toolFns.get(name);
    if (!fn) {
      const hint = closest(name, [...this.toolFns.keys()]);
      throw new JsError(
        `no function named '${name}'${hint ? ` — did you mean '${hint}'?` : ""}. Call fns("server") to list a server's functions.`,
      );
    }
    if (!fn.resultShape) await sampleOne(fn, { ctx: { actor: this.actor } });
    return describeFn(fn);
  }

  private fnRow(fn: ToolFn): { name: string; description?: string; signature: string; effect?: string } {
    return {
      name: fn.name,
      description: fn.description,
      signature: fnSignature(fn),
      ...(fn.readOnlyHint === false ? { effect: "write" } : fn.readOnlyHint === true ? { effect: "read" } : {}),
    };
  }

  /** Names declared at top level so far — the session's scratchpad contents. */
  definitions(): string[] {
    return this.root.ownNames().filter((n) => !this.globalNames.has(n) && !this.namespaces.has(n) && !RESERVED.has(n) && !this.toolFns.has(n));
  }

  // ── the model-facing surface ───────────────────────────────────────────────

  private installSurface(): void {
    // Each discovery tier is bound under BOTH its short name (search / servers
    // / fns / describe) AND its native-tool-name alias (search_functions /
    // list_servers / list_functions / describe_function). Every builtin accepts
    // the positional form (search("q")) AND the tool's object form
    // (search_functions({ query: "q" })), since models mirror the tool schema
    // even inside the code.
    for (const b of DISCOVERY_BUILTINS) {
      const handler = (arg?: unknown) => this.discovery(b.kind, arg, b.argKey);
      this.root.declare(b.short, handler, true);
      this.root.declare(b.alias, handler, true);
    }
  }

  /** Route a discovery builtin call (short name or alias) to its tier. */
  private discovery(kind: DiscoveryKind, arg: unknown, argKey?: "query" | "server" | "name"): unknown {
    switch (kind) {
      case "search":
        return this.searchFunctions(discoveryArg(arg, "query"));
      case "servers":
        return this.discoverServers();
      case "functions":
        // A server arg lists that server; no arg lists ALL functions.
        return argKey && hasDiscoveryArg(arg, argKey)
          ? this.discoverFunctions(discoveryArg(arg, argKey))
          : this.list().map((fn) => this.fnRow(fn));
      case "describe":
        return this.describeFunction(discoveryArg(arg, "name"));
    }
  }

  /** A ToolFn as a native function: validates the argument object, fires the
   *  tool, and records the call. */
  private bindTool(fn: ToolFn): (...args: unknown[]) => Promise<unknown> {
    const session = this;
    return async function (...args: unknown[]): Promise<unknown> {
      const arg = args[0];
      if (arg !== undefined && (typeof arg !== "object" || arg === null || Array.isArray(arg))) {
        throw new JsError(`${fn.name} takes a single argument object, e.g. ${fn.name}({ ... }). See describe("${fn.name}").`);
      }
      const argObj = (arg ?? {}) as Record<string, unknown>;
      const missing = missingRequired(fn, argObj);
      if (missing.length > 0) {
        throw new JsError(
          `${fn.name} requires ${missing.map((m) => `'${m}'`).join(", ")} — call ${fn.name}({ ${missing[0]}: … }). See describe("${fn.name}").`,
        );
      }
      const unknown = unknownKeys(fn, argObj);
      if (unknown.length > 0) {
        const u = unknown[0];
        throw new JsError(
          `${fn.name} has no parameter '${u.key}'${u.hint ? ` — did you mean '${u.hint}'?` : ""}. See describe("${fn.name}").`,
        );
      }
      const rt = session.runtime;
      rt.called.set(fn.name, (rt.called.get(fn.name) ?? 0) + 1);
      return fn.call(argObj, { signal: rt.signal, actor: rt.actor });
    };
  }

  // ── execute ────────────────────────────────────────────────────────────────

  async execute(code: string, opts: JsExecuteOptions = {}): Promise<JsExecuteResult> {
    const program = parseProgram(code);
    this.sink.out = [];
    this.runtime = { signal: opts.signal, actor: opts.actor ?? this.actor, called: new Map() };
    const before = new Set(this.root.ownNames());
    const ctx: EvalCtx = {
      fuel: { remaining: this.fuelBudget },
      depth: 0,
      maxDepth: this.maxDepth,
      signal: opts.signal,
    };

    let value: unknown;
    try {
      value = await runProgram(program, this.root, ctx);
    } catch (err) {
      // A tool call that fired BEFORE the error stands (no rollback in a
      // call-by-value language) — say so, or the model re-runs the whole program
      // and double-fires the effect.
      const fired = [...this.runtime.called.entries()];
      let msg = formatProgramError(err);
      if (fired.length > 0) {
        const list = fired.map(([n, c]) => `${n}×${c}`).join(", ");
        msg += `\nNOTE: ${fired.reduce((a, [, c]) => a + c, 0)} tool call(s) had ALREADY FIRED before the error (${list}) — they are done; fix the error and re-run WITHOUT repeating them.`;
      }
      throw new JsError(msg);
    }

    const defined = this.root.ownNames().filter((n) => !before.has(n));
    const { value: elided, elided: didElide } = elide(value, {
      ...this.elideLimits,
      keepHint: "return a count, .slice(0, n), or bind it to a top-level const to keep the full value in the session",
    });

    const called = [...this.runtime.called.entries()].map(([name, calls]) => ({ name, calls }));
    const out: JsExecuteResult = { value: elided, elided: didElide, called };

    if (defined.length) {
      out.defined = defined;
      const defs: Record<string, unknown> = {};
      for (const n of defined) {
        const v = this.root.lookup(n).value;
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
    if (this.sink.out.length) out.stdout = [...this.sink.out];
    if (Array.isArray(value) && value.length === 0 && called.length > 0) {
      out.note =
        "0 items came back. If you expected data, re-check your argument values before concluding it doesn't exist — describe(\"name\") shows a function's parameters.";
    }
    return out;
  }
}
