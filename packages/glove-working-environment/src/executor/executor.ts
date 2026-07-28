/**
 * Script execution. Modules run inside a fresh `node:vm` context per
 * operation, in a scope constructed from scratch: `env:*` modules, relative
 * VFS imports, console shims, and the standard JS intrinsics the context
 * provides. There is no `require`, no `process`, no `fetch`, no host fs, no
 * timers — not blocked, absent.
 *
 * Honesty note (from the design spec): `node:vm` with frozen injected
 * bindings is a discipline boundary for model-written code, not a
 * hostile-code boundary. The wall-clock limit covers the synchronous
 * prefix of every evaluation via the vm timeout and pending async work via a
 * deadline race; a script that goes CPU-bound *between* awaits can still
 * stall the host until its next yield.
 */
import vm from "node:vm";
import { format } from "node:util";
import { normalizePath, resolveRelative } from "../paths";
import { EnvLimitError, type EnvLimits, type RunResult } from "../types";
import { ScriptContractError, defaultExportError } from "../pipeline/contract";
import { transformModule } from "./transform";
import { BRIDGE_SOURCE, INVOKE_SOURCE, type Bridge } from "./bridge";

export class ModuleNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`no such module: ${path}`);
  }
}

export interface ConsoleCapture {
  out: string[];
  err: string[];
  bytes: number;
  truncated: boolean;
}

export interface ExecutorDeps {
  /** Read a module's source text; null when the file doesn't exist. */
  readSource(path: string): Promise<string | null>;
  /**
   * Frozen `env:*` namespaces, keyed by bare name ("fs", "std", "documents", …).
   * `readOnly` selects the validation-time set, whose filesystem refuses
   * mutations.
   */
  envModules(readOnly: boolean): Map<string, Record<string, unknown>>;
  /** Whether the default-export contract is enforced for this path at load time. */
  isEnforcedScript(path: string): boolean;
  limits: EnvLimits;
}

export interface LoadOptions {
  /** Uncommitted content consulted before the VFS (write-time validation). */
  overlay?: Map<string, string>;
  capture?: ConsoleCapture;
  /** Bind the validation-time `env:*` set, whose filesystem refuses mutations. */
  readOnly?: boolean;
}

interface RegistryEntry {
  state: "loading" | "done";
  ns?: Record<string, unknown>;
}

interface OpState {
  ctx: vm.Context;
  registry: Map<string, RegistryEntry>;
  overlay?: Map<string, string>;
  capture: ConsoleCapture;
  deadline: number;
  /** Context-realm bridge; the only way host values reach the sandbox. */
  bridge: Bridge;
  /** Per-context bound `env:*` namespaces (binding is context-specific). */
  envCache: Map<string, Record<string, unknown>>;
  /** Context-realm console, handed to every module. */
  boundConsole: unknown;
  /** Whether this operation binds the validation (mutation-refusing) modules. */
  readOnly: boolean;
}

const CAPTURE_CHAR_CAP = 1_000_000;

export function newCapture(): ConsoleCapture {
  return { out: [], err: [], bytes: 0, truncated: false };
}

function makeConsole(capture: ConsoleCapture): Record<string, unknown> {
  const write = (target: string[]) => (...args: unknown[]) => {
    if (capture.bytes >= CAPTURE_CHAR_CAP) {
      if (!capture.truncated) {
        capture.truncated = true;
        target.push("[console output truncated]");
      }
      return;
    }
    const line = format(...args);
    capture.bytes += line.length;
    target.push(line);
  };
  return Object.freeze({
    log: write(capture.out),
    info: write(capture.out),
    debug: write(capture.out),
    warn: write(capture.err),
    error: write(capture.err),
  });
}

export class ScriptExecutor {
  constructor(private deps: ExecutorDeps) {}

  private newOp(opts?: LoadOptions): OpState {
    // The sandbox object must have a NULL prototype. `createContext({})`
    // backs the contextified global with a host object, which leaves
    // `globalThis.constructor` pointing at the HOST `Object` — and
    // `globalThis.constructor.constructor("return process")()` then walks
    // straight out of the sandbox.
    const ctx = vm.createContext(Object.create(null), { name: "glove-working-environment" });
    const capture = opts?.capture ?? newCapture();
    vm.runInContext(`"use strict"; delete globalThis.WebAssembly;`, ctx);

    // Install the bridge, then take it off the globals: the host keeps the
    // reference, scripts get no handle to the binding machinery.
    vm.runInContext(BRIDGE_SOURCE, ctx, { filename: "<glove:bridge>" });
    const bridge = (ctx as Record<string, unknown>).__glove_bridge as Bridge;
    vm.runInContext(`delete globalThis.__glove_bridge;`, ctx);

    // Even the console shim must be context-realm — its methods would
    // otherwise be host functions sitting on a global.
    const boundConsole = bridge.freezeDeep(bridge.bindNamespace(makeConsole(capture)));
    (ctx as Record<string, unknown>).console = boundConsole;

    return {
      ctx,
      registry: new Map(),
      overlay: opts?.overlay,
      capture,
      deadline: Date.now() + this.deps.limits.runTimeoutMs,
      bridge,
      envCache: new Map(),
      boundConsole,
      readOnly: opts?.readOnly === true,
    };
  }

  /** The context-realm view of an `env:*` module (bound once per context). */
  private envNamespace(st: OpState, name: string): Record<string, unknown> | null {
    const cached = st.envCache.get(name);
    if (cached) return cached;
    const host = this.deps.envModules(st.readOnly).get(name);
    if (!host) return null;
    const bound = st.bridge.freezeDeep(st.bridge.bindNamespace(this.guardDeadline(host, st)));
    st.envCache.set(name, bound);
    return bound;
  }

  /**
   * Wrap a host namespace so every capability call re-checks the wall-clock
   * budget first. The vm timeout only covers a synchronous run; once a script
   * has awaited, nothing else can interrupt it. Checking here stops a
   * runaway loop from continuing to *do* anything through its capabilities,
   * and makes the limit fire promptly for the loops that actually touch the
   * filesystem.
   */
  private guardDeadline(host: Record<string, unknown>, st: OpState, seen = new Map<object, Record<string, unknown>>()): Record<string, unknown> {
    const hit = seen.get(host);
    if (hit) return hit;
    const out: Record<string, unknown> = {};
    seen.set(host, out);
    for (const key of Object.keys(host)) {
      const value = host[key];
      if (typeof value === "function") {
        const fn = value as (...a: unknown[]) => unknown;
        out[key] = (...args: unknown[]) => {
          if (Date.now() > st.deadline) throw this.limitError();
          return fn.apply(host, args);
        };
      } else if (value !== null && typeof value === "object") {
        out[key] = this.guardDeadline(value as Record<string, unknown>, st, seen);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private remaining(st: OpState): number {
    const ms = st.deadline - Date.now();
    if (ms <= 0) throw this.limitError();
    return ms;
  }

  private limitError(): EnvLimitError {
    return new EnvLimitError(
      `script exceeded the wall-clock limit: ${this.deps.limits.runTimeoutMs}ms (limits.runTimeoutMs)`,
    );
  }

  /** Run vm code, translating vm's own timeout error into our named limit error. */
  private runSync(code: string | vm.Script, st: OpState, filename?: string): unknown {
    try {
      const script = typeof code === "string" ? new vm.Script(code, { filename: filename ?? "<env>" }) : code;
      return script.runInContext(st.ctx, { timeout: this.remaining(st) });
    } catch (e) {
      // The vm timeout error loses its host prototype crossing the context
      // boundary — duck-type on code/message, not instanceof.
      const err = e as { code?: string; message?: string } | null;
      if (
        err?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
        (typeof err?.message === "string" && /Script execution timed out/.test(err.message))
      ) {
        throw this.limitError();
      }
      throw e;
    }
  }

  private async withDeadline<T>(p: Promise<T>, st: OpState): Promise<T> {
    const ms = this.remaining(st);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(this.limitError()), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private envModuleNames(): string {
    return [...this.deps.envModules(false).keys()].map((n) => `env:${n}`).join(", ");
  }

  private async resolveImport(spec: string, importer: string, st: OpState, chain: string[]): Promise<Record<string, unknown>> {
    if (spec.startsWith("env:")) {
      const name = spec.slice(4);
      const mod = this.envNamespace(st, name);
      if (!mod) {
        throw new Error(`unknown module "env:${name}". Available env modules: ${this.envModuleNames()}`);
      }
      return mod;
    }
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
      const target = spec.startsWith("/") ? normalizePath(spec) : resolveRelative(importer, spec);
      try {
        return await this.loadInner(target, st, chain);
      } catch (e) {
        if (e instanceof ModuleNotFoundError && e.path === target) {
          if (!target.endsWith(".js")) {
            const alt = target + ".js";
            const altSrc = st.overlay?.get(alt) ?? (await this.deps.readSource(alt));
            if (altSrc !== null && altSrc !== undefined) return await this.loadInner(alt, st, chain);
          }
          throw new Error(`cannot import "${spec}" from ${importer}: no such file ${target}`);
        }
        throw e;
      }
    }
    throw new Error(
      `only relative VFS paths and env:* modules can be imported (got "${spec}"). Available env modules: ${this.envModuleNames()}`,
    );
  }

  private async loadInner(path: string, st: OpState, chain: string[]): Promise<Record<string, unknown>> {
    const norm = normalizePath(path);
    const existing = st.registry.get(norm);
    if (existing?.state === "done") return existing.ns!;
    if (existing?.state === "loading") {
      throw new Error(`circular import detected: ${[...chain, norm].join(" -> ")}`);
    }

    const src = st.overlay?.get(norm) ?? (await this.deps.readSource(norm));
    if (src === null || src === undefined) throw new ModuleNotFoundError(norm);

    st.registry.set(norm, { state: "loading" });
    const nextChain = [...chain, norm];
    try {
      const t = transformModule(src, norm);
      const headerParts = [
        "(async (__env) => {",
        "const { __exports, __glove_import, __glove_pick } = __env;",
        "const console = __env.console;",
        'return (async () => { "use strict";',
        ...t.prelude,
      ];
      const header = headerParts.join("\n") + "\n";
      const headerLines = headerParts.length;
      const wrapper = header + t.body + "\n;\n" + t.footer.join("\n") + "\n})();\n})(globalThis.__glove_current)";

      let script: vm.Script;
      try {
        script = new vm.Script(wrapper, { filename: norm, lineOffset: -headerLines });
      } catch (e) {
        throw new Error(`${norm}: syntax error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // `__exports` and the `__glove_current` record are built INSIDE the
      // context — a host-realm object here would be reachable from user code
      // as `import * as ns` (or via `globalThis.__glove_current`) and would
      // leak the host realm through its constructor chain.
      const __exports = st.bridge.mkModule(
        (spec: unknown) => this.resolveImport(String(spec), norm, st, nextChain),
        (ns: Record<string, unknown>, key: string, spec: string) => {
          if (ns !== null && typeof ns === "object" && key in ns) return ns[key];
          throw new Error(`module "${spec}" has no export "${key}"`);
        },
        st.boundConsole,
      );

      const evalPromise = this.runSync(script, st) as Promise<unknown>;
      await this.withDeadline(Promise.resolve(evalPromise), st);

      const ns = st.bridge.freezeDeep(__exports);
      st.registry.set(norm, { state: "done", ns });

      if (this.deps.isEnforcedScript(norm)) {
        const err = defaultExportError(ns);
        if (err) throw new ScriptContractError(norm, err);
      }
      return ns;
    } catch (e) {
      st.registry.delete(norm);
      throw e;
    }
  }

  /**
   * Load a module (and everything it imports) in a fresh sandbox. Used by
   * write-time validation (with an overlay) and by `run`.
   */
  async loadModule(path: string, opts?: LoadOptions): Promise<Record<string, unknown>> {
    const st = this.newOp(opts);
    return this.loadInner(path, st, []);
  }

  /** Execute a script's default export with plain-JSON args. */
  async run(path: string, args: unknown, opts?: LoadOptions): Promise<RunResult> {
    const started = Date.now();
    const capture = opts?.capture ?? newCapture();
    const st = this.newOp({ ...opts, capture });
    const finish = (partial: Partial<RunResult> & { ok: boolean }): RunResult => ({
      result: undefined,
      stdout: capture.out.join("\n"),
      stderr: capture.err.join("\n"),
      durationMs: Date.now() - started,
      ...partial,
    });

    try {
      const ns = await this.loadInner(normalizePath(path), st, []);
      const contractErr = defaultExportError(ns);
      if (contractErr) return finish({ ok: false, error: contractErr });

      // Arguments cross as a JSON string — a primitive — and are parsed
      // inside the context, so the script never receives a host-realm object.
      const argsJson = args === undefined ? undefined : JSON.stringify(args);
      const globals = st.ctx as Record<string, unknown>;
      globals.__glove_fn = ns.default;
      globals.__glove_argsJson = argsJson;
      const p = this.runSync(INVOKE_SOURCE, st, path);
      let result = await this.withDeadline(Promise.resolve(p), st);
      // Results are built inside the vm realm; round-trip JSON-able values so
      // hosts get ordinary host-realm objects. Non-JSON values stay as-is.
      try {
        if (result !== undefined) result = JSON.parse(JSON.stringify(result));
      } catch {
        // keep the raw value — the tool layer inspect-formats it
      }
      return finish({ ok: true, result });
    } catch (e) {
      return finish({ ok: false, error: describeError(e) });
    }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof ScriptContractError) return e.message;
  const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
  const stack = (e as { stack?: string })?.stack;
  if (typeof stack === "string") {
    const frames = stack
      .split("\n")
      .filter((l) => /^\s+at .*\/(scripts|tmp|inbox|out)\/.*:\d+/.test(l))
      .slice(0, 4)
      .map((l) => l.trim());
    if (frames.length > 0) return `${message}\n  ${frames.join("\n  ")}`;
  }
  return message;
}

/** Recursively freeze an injected object graph so scripts can't mutate shared adapter state. */
export function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    seen.has(value) ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value as object)) {
    let child: unknown;
    try {
      child = (value as Record<PropertyKey, unknown>)[key];
    } catch {
      continue;
    }
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
