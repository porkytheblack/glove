/**
 * The Python session — one interpreter instance holding a persistent root scope
 * (top-level bindings survive across `execute` calls, so big intermediates live
 * HERE, not in the model's context), the registered tool functions, the
 * builtins, and the print sink. Mirrors glove-js's `JsSession`: a function call
 * FIRES the tool immediately — there is no staging.
 *
 * Tool calls are Python-native: `save_notion_page(title=…, items=…)` passes the
 * ToolFn its argument object `{title, items}` from the call's keyword args (a
 * single positional dict is also accepted). Namespaced names
 * (`github__list_pull_requests`) additionally mount as an attribute on a dict
 * namespace object (`github.list_pull_requests(...)`).
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
import { PyError } from "./errors";
import { parseProgram } from "./parse";
import { Scope } from "./scope";
import { makeBuiltins, type StdoutSink } from "./builtins";
import { NativeFn } from "./native";
import { Closure, formatError, runProgram, type EvalCtx } from "./interp";
import { PyRange, isDict, pyRepr } from "./values";

export interface PySessionOptions {
  /** Evaluation budget per `execute`. Default 100_000. */
  fuel?: number;
  /** Max nested-call depth. Default 100. */
  maxDepth?: number;
  /** Output truncation limits for the value returned to the model. */
  elide?: Partial<ElideLimits>;
  /** Stamped into the tool-call context as the actor. */
  actor?: string;
}

export interface PyExecuteOptions {
  signal?: AbortSignal;
  actor?: string;
}

export interface PyExecuteResult {
  /** The last top-level expression's value, structurally elided. */
  value: unknown;
  elided: boolean;
  /** Tool invocations this call (name → count). */
  called: Array<{ name: string; calls: number }>;
  /** Names bound at top level this call — they persist for later calls. */
  defined?: string[];
  /** Per-def summaries (count + a small peek) for list defs. */
  defs?: Record<string, unknown>;
  /** print() output, if any. */
  stdout?: string[];
  note?: string;
}

/** Discovery builtins — short names AND native-tool-name aliases
 *  (search_functions / list_functions / …), so a call lands whichever front
 *  door the model learned. Shared across the fn-mode REPLs. */
const RESERVED = new Set(DISCOVERY_BUILTIN_NAMES);

/** Opaque printing for the model-facing value: Python's non-JSON values. */
function opaque(v: unknown): string | undefined {
  if (v instanceof NativeFn || v instanceof Closure) return "#<fn>";
  if (v instanceof PyRange) return pyRepr(v);
  return undefined;
}

export class PySession {
  private root: Scope;
  private sink: StdoutSink = { out: [] };
  private builtinNames: Set<string>;
  private toolFns = new Map<string, ToolFn>();
  private namespaces = new Map<string, Record<string, unknown>>();
  /** Memoized server grouping; invalidated when a function is registered. */
  private serverCache?: ServerSummary[];
  private actor?: string;
  private fuelBudget: number;
  private maxDepth: number;
  private elideLimits: ElideLimits;

  private constructor(opts: PySessionOptions) {
    this.actor = opts.actor;
    this.fuelBudget = opts.fuel ?? 100_000;
    this.maxDepth = opts.maxDepth ?? 100;
    this.elideLimits = { ...DEFAULT_ELIDE, ...opts.elide };
    this.root = new Scope(undefined, true);
    const builtins = makeBuiltins(this.sink);
    this.builtinNames = new Set(Object.keys(builtins));
    for (const [name, value] of Object.entries(builtins)) this.root.set(name, value);
    this.installSurface();
  }

  static create(opts: PySessionOptions = {}): PySession {
    return new PySession(opts);
  }

  /**
   * Register a {@link ToolFn}. It becomes callable by its flat name
   * (`github__list_pull_requests(...)`) and, when the name has a `__` namespace,
   * as a member of a dict namespace object (`github.list_pull_requests(...)`).
   *
   * IMPORTANT: a call FIRES the tool immediately — there is no staging. Register
   * effectful functions only on a session you are comfortable firing.
   */
  register(fn: ToolFn): void {
    const name = fn.name;
    if (this.toolFns.has(name)) throw new Error(`glove-python: function "${name}" is already registered`);
    if (this.builtinNames.has(name) || RESERVED.has(name)) {
      throw new Error(
        `glove-python: cannot register function "${name}" — the name is a builtin. Rename it (defineFn's "name", fnFromTool's opts.name, or fnsFromMcp's opts.filter).`,
      );
    }
    if (this.namespaces.has(name)) {
      throw new Error(`glove-python: cannot register function "${name}" — that name is already a namespace object.`);
    }
    this.toolFns.set(name, fn);
    this.serverCache = undefined; // catalog changed — regroup on next discover
    this.root.set(name, this.bindTool(fn));

    const sep = name.indexOf("__");
    if (sep > 0 && sep + 2 < name.length) {
      const ns = name.slice(0, sep);
      const rest = name.slice(sep + 2);
      if (!this.builtinNames.has(ns) && !RESERVED.has(ns) && !this.toolFns.has(ns)) {
        const record = this.namespaces.get(ns) ?? {};
        record[rest] = this.bindTool(fn);
        this.namespaces.set(ns, record);
        // a plain object is a `dict`; `github.list_pull_requests` resolves as
        // an own-key attribute access on it (see interp evalCall).
        this.root.set(ns, { ...record });
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
      const known = this.discoverServers().map((s) => s.name);
      const hint = closest(server, known);
      throw new PyError(
        `no server named '${server}'${hint ? ` — did you mean '${hint}'?` : ""}. Call servers() to list them.`,
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
      throw new PyError(
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

  /** Names bound at top level so far — the session's scratchpad contents. */
  definitions(): string[] {
    return this.root
      .ownNames()
      .filter((n) => !this.builtinNames.has(n) && !this.namespaces.has(n) && !RESERVED.has(n) && !this.toolFns.has(n));
  }

  // ── the model-facing surface ───────────────────────────────────────────────

  private installSurface(): void {
    // Each discovery tier is bound under BOTH its short name (search / servers
    // / fns / describe) AND its native-tool-name alias (search_functions /
    // list_servers / list_functions / describe_function). Each accepts the
    // native tool's keyword form (search_functions(query="…")), a single
    // positional dict, or a bare positional string — models mirror the tool
    // schema even inside the code.
    for (const b of DISCOVERY_BUILTINS) {
      const handler = (args: unknown[], kwargs: Record<string, unknown>) =>
        this.discovery(b.kind, args, kwargs, b.argKey);
      this.root.set(b.short, new NativeFn(b.short, handler));
      this.root.set(b.alias, new NativeFn(b.alias, handler));
    }
  }

  /** Route a discovery builtin call (short name or alias) to its tier, reading
   *  its argument from kwargs, a positional dict, or a positional string. */
  private discovery(
    kind: DiscoveryKind,
    args: unknown[],
    kwargs: Record<string, unknown>,
    argKey?: "query" | "server" | "name",
  ): unknown {
    const raw = argKey && kwargs[argKey] != null ? kwargs[argKey] : args[0];
    switch (kind) {
      case "search":
        return this.searchFunctions(discoveryArg(raw, "query"));
      case "servers":
        return this.discoverServers();
      case "functions":
        return argKey && hasDiscoveryArg(raw, argKey)
          ? this.discoverFunctions(discoveryArg(raw, argKey))
          : this.list().map((fn) => this.fnRow(fn));
      case "describe":
        return this.describeFunction(discoveryArg(raw, "name"));
    }
  }

  /** A ToolFn as a NativeFn: validates the argument object (from kwargs or a
   *  single positional dict), fires the tool, and — via its `toolName` — has the
   *  interpreter record the call. */
  private bindTool(fn: ToolFn): NativeFn {
    return new NativeFn(
      fn.name,
      (args, kwargs, api) => {
        let argObj: Record<string, unknown>;
        if (Object.keys(kwargs).length > 0) {
          argObj = { ...kwargs };
        } else if (args.length === 0) {
          argObj = {};
        } else if (args.length === 1 && isDict(args[0])) {
          argObj = { ...(args[0] as Record<string, unknown>) };
        } else {
          throw new PyError(
            `${fn.name} takes keyword arguments, e.g. ${fn.name}(name=…) (or a single dict). See describe("${fn.name}").`,
          );
        }
        const missing = missingRequired(fn, argObj);
        if (missing.length > 0) {
          throw new PyError(
            `${fn.name} requires ${missing.map((m) => `'${m}'`).join(", ")} — call ${fn.name}(${missing[0]}=…). See describe("${fn.name}").`,
          );
        }
        const unknown = unknownKeys(fn, argObj);
        if (unknown.length > 0) {
          const u = unknown[0];
          throw new PyError(
            `${fn.name} has no parameter '${u.key}'${u.hint ? ` — did you mean '${u.hint}'?` : ""}. See describe("${fn.name}").`,
          );
        }
        return fn.call(argObj, { signal: api.signal, actor: api.actor });
      },
      fn.name,
    );
  }

  // ── execute ────────────────────────────────────────────────────────────────

  async execute(code: string, opts: PyExecuteOptions = {}): Promise<PyExecuteResult> {
    const program = parseProgram(code);
    this.sink.out = [];
    const before = new Set(this.root.ownNames());
    const ctx: EvalCtx = {
      fuel: { remaining: this.fuelBudget },
      depth: 0,
      maxDepth: this.maxDepth,
      signal: opts.signal,
      actor: opts.actor ?? this.actor,
      called: new Map(),
    };

    let value: unknown;
    try {
      value = await runProgram(program.body, this.root, ctx);
    } catch (err) {
      // A tool call that fired BEFORE the error stands (no rollback in a
      // call-by-value language) — say so, or the model re-runs the whole program
      // and double-fires the effect.
      const fired = [...ctx.called.entries()];
      let msg = formatError(err);
      if (fired.length > 0) {
        const list = fired.map(([n, c]) => `${n}×${c}`).join(", ");
        msg += `\nNOTE: ${fired.reduce((a, [, c]) => a + c, 0)} tool call(s) had ALREADY FIRED before the error (${list}) — they are done; fix the error and re-run WITHOUT repeating them.`;
      }
      throw new PyError(msg);
    }

    const defined = this.root.ownNames().filter((n) => !before.has(n));
    const { value: elided, elided: didElide } = elide(value, {
      ...this.elideLimits,
      opaque,
      keepHint: "return a count, a slice x[:n], or bind it to a top-level name to keep the full value in the session",
    });

    const called = [...ctx.called.entries()].map(([name, calls]) => ({ name, calls }));
    const out: PyExecuteResult = { value: elided, elided: didElide, called };

    if (defined.length) {
      out.defined = defined;
      const defs: Record<string, unknown> = {};
      for (const n of defined) {
        const v = this.root.lookup(n).value;
        if (Array.isArray(v) && v.length > 0) {
          const el = v[0];
          const peek =
            el !== null && typeof el === "object" && !Array.isArray(el) && isDict(el)
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
        '0 items came back. If you expected data, re-check your argument values before concluding it doesn\'t exist — describe("name") shows a function\'s parameters.';
    }
    return out;
  }
}
