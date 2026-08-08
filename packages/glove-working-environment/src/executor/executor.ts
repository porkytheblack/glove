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
import { ScriptContractError, contractOf, defaultExportError } from "../pipeline/contract";
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
  /**
   * Namespace object → the exports that module reassigns after declaring them.
   * Keyed on the namespace so `pick` can answer without re-resolving the
   * specifier. Host-side: the host may hold a context object, only the
   * reverse leaks.
   */
  mutableExports: WeakMap<object, Set<string>>;
}

const CAPTURE_CHAR_CAP = 1_000_000;

/**
 * Name what a module exports, without burying the answer.
 *
 * A wrapped library brings its whole vocabulary with it — `env:documents`
 * exports forty names once docx's constructors and enums are there — and an
 * error that lists all forty is worse than one that lists a useful ten: the
 * model is looking for the one name it should have written, and every extra
 * name is something to read past. So the lowercase names go first (they are
 * the module's own verbs, which is what a wrong guess is nearly always
 * reaching for), the library's capitalised classes are counted rather than
 * spelled out, and the skill that does spell them out is named.
 */
function exportList(available: string[]): string {
  if (available.length === 0) return ".";
  const verbs = available.filter((name) => !/^[A-Z]/.test(name));
  const classes = available.filter((name) => /^[A-Z]/.test(name));
  const shown = (verbs.length > 0 ? verbs : available).slice(0, 16);
  const parts = [` — it exports: ${shown.join(", ")}`];
  if (verbs.length > shown.length) parts.push(`, and ${verbs.length - shown.length} more`);
  if (verbs.length > 0 && classes.length > 0) {
    parts.push(
      `. It also exports ${classes.length} classes and enums from the library it wraps ` +
        `(${classes.slice(0, 3).join(", ")}, …) — see /skills/imports.md`,
    );
  }
  return `${parts.join("")}.`;
}

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
      mutableExports: new WeakMap(),
    };
  }

  /** The context-realm view of an `env:*` module (bound once per context). */
  private envNamespace(st: OpState, name: string): Record<string, unknown> | null {
    const cached = st.envCache.get(name);
    if (cached) return cached;
    const host = this.deps.envModules(st.readOnly).get(name);
    if (!host) return null;
    const bound = st.bridge.freezeDeep(
      st.bridge.guardNamespace(st.bridge.bindNamespace(this.guardDeadline(host, st)), `env:${name}`),
    );
    st.envCache.set(name, bound);
    return bound;
  }

  /**
   * Wrap a host namespace so every capability call re-checks the wall-clock
   * budget first, and so its arguments arrive as host-realm values. The vm timeout only covers a synchronous run; once a script
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
        const guarded = (...args: unknown[]) => {
          if (Date.now() > st.deadline) throw this.limitError();
          return fn.apply(host, args.map((a) => hostify(a)));
        };
        // The bridge copies name/arity from whatever it is handed, so this
        // wrapper is where a capability would otherwise lose its shape and
        // reach the script as an anonymous zero-arity function.
        Object.defineProperty(guarded, "name", { value: fn.name, configurable: true });
        Object.defineProperty(guarded, "length", { value: fn.length, configurable: true });
        // A builder carrier is not a capability to be called — it is a
        // description the bridge turns into an in-context constructor. The
        // marker has to survive this wrapper, or the bridge never sees it and
        // the script gets a plain function it cannot `new`. Its flush is a
        // host call like any other, so it takes the same deadline check.
        const builder = (value as { __glove_builder?: { flush: (ops: unknown[]) => Promise<unknown> } }).__glove_builder;
        if (builder) {
          (guarded as unknown as Record<string, unknown>).__glove_builder = {
            ...builder,
            flush: (ops: unknown[]) => {
              if (Date.now() > st.deadline) throw this.limitError();
              return builder.flush(ops);
            },
          };
        }
        out[key] = guarded;
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
      // Reading /std/<name>/index.d.ts and then importing that *path* is the
      // natural next step and the wrong one — the docs live at a path, the
      // module does not. Say so instead of reporting a missing file, or
      // (worse) trying to evaluate a .d.ts as a module.
      if (target === "/std" || target.startsWith("/std/")) {
        const name = target.split("/")[2];
        throw new Error(
          `cannot import "${spec}": /std holds documentation, not modules. ` +
            (name
              ? `Import the module by name instead: import { … } from 'env:${name}'.`
              : `Import modules by name: ${this.envModuleNames()}.`),
        );
      }
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
        // V8 puts the offending line and a caret in the stack, not the
        // message. Without it "Unexpected identifier 'the'" is a search
        // through the whole file for a word that probably appears in it
        // several times — and the observed cost was three identical rewrites
        // before the author found an unterminated comment.
        const where = locateSyntaxError(e);
        throw new Error(
          `${norm}: syntax error: ${e instanceof Error ? e.message : String(e)}${where}`,
        );
      }

      // `__exports` and the `__glove_current` record are built INSIDE the
      // context — a host-realm object here would be reachable from user code
      // as `import * as ns` (or via `globalThis.__glove_current`) and would
      // leak the host realm through its constructor chain.
      const __exports = st.bridge.mkModule(
        (spec: unknown) => this.resolveImport(String(spec), norm, st, nextChain),
        (ns: Record<string, unknown>, key: string, spec: string) => {
          if (ns !== null && typeof ns === "object" && key in ns) {
            // A named import of a reassigned `export let`/`export var` is a
            // snapshot here and a live binding in real ESM. Real live
            // bindings need every identifier reference rewritten to a
            // namespace access, which needs a parser; the transform is a
            // lexical scanner by design. So the divergence is reported
            // instead of silently producing a stale value — at write time,
            // since validation loads the graph.
            if (st.mutableExports.get(ns as object)?.has(key)) {
              throw new Error(
                `"${key}" is reassigned by ${spec} after it is declared, and a named import of it would be a ` +
                  `snapshot taken at import time — real ESM would show you the updated value. ` +
                  `Import the namespace instead: import * as ns from '${spec}'; then read ns.${key}.`,
              );
            }
            return ns[key];
          }
          // Name what the module does export. A model that guessed the
          // binding name gets the correction here, at import time, rather
          // than discovering it as an undefined at the call site — and the
          // same courtesy applies to relative script imports.
          const available = ns !== null && typeof ns === "object" ? Object.keys(ns).filter((k) => k !== "default") : [];
          throw new Error(`module "${spec}" has no export "${key}"${exportList(available)}`);
        },
        st.boundConsole,
      );

      const evalPromise = this.runSync(script, st) as Promise<unknown>;
      await this.withDeadline(Promise.resolve(evalPromise), st);

      const ns = st.bridge.freezeDeep(__exports);
      if (t.mutableExports.length > 0) st.mutableExports.set(ns as object, new Set(t.mutableExports));
      st.registry.set(norm, { state: "done", ns });

      if (this.deps.isEnforcedScript(norm)) {
        const err = defaultExportError(contractOf(ns));
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
      const contractErr = defaultExportError(contractOf(ns));
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
      // The registry keys ARE the filenames given to vm.Script, so this is an
      // exact list of the script files in play — nothing host-side can match.
      let error = describeError(e, new Set(st.registry.keys()));
      const hint =
        importHint(error, this.deps.envModules(false)) ??
        shapeHint(error, await this.deps.readSource(path).catch(() => null));
      if (hint) {
        // On the FIRST line, not appended to the whole thing. `describeError`
        // returns "message\n  at …", and the tool layer surfaces only line one
        // as the result's `message` — a hint after the stack trace lands in
        // the field nobody reads, which is the exact failure this whole set of
        // hints exists to fix.
        const [head, ...rest] = error.split("\n");
        error = [`${head} — ${hint}`, ...rest].join("\n");
      }
      return finish({ ok: false, error });
    }
  }
}

/**
 * Copy a value coming *out* of the sandbox into host-realm objects.
 *
 * Results already cross host→script as deep copies; without the mirror image
 * the boundary is asymmetric, and the asymmetry is not academic. An array
 * literal written inside a script is a context-realm Array: `Array.isArray`
 * still recognises it, but `instanceof Array` does not, and real libraries
 * use both. exceljs takes `instanceof Array` to mean "a row of cells" and
 * anything else to mean "a map of column names", so passing a script's array
 * straight through produced a silently empty spreadsheet. Every adapter
 * author would have hit some version of that, one library at a time.
 *
 * Copying also severs the live reference: a host library that retains an
 * argument holds plain host data, not an object whose prototype chain and
 * getters still live inside the sandbox.
 *
 * Functions are the exception — they cannot be copied, so callbacks pass
 * through as-is. They are context-realm closures, which can do no more than
 * the script itself.
 */
export function hostify(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t !== "object" && t !== "function") return value;
  if (t === "function") return value;

  const obj = value as object;
  const hit = seen.get(obj);
  if (hit !== undefined) return hit;

  const tag = Object.prototype.toString.call(obj);

  if (tag === "[object Uint8Array]" || tag === "[object Uint8ClampedArray]" || tag === "[object Int8Array]") {
    const src = obj as unknown as ArrayLike<number>;
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i];
    seen.set(obj, out);
    return out;
  }
  if (tag === "[object Date]") {
    const out = new Date(Number(obj));
    seen.set(obj, out);
    return out;
  }
  if (tag === "[object RegExp]") {
    const re = obj as RegExp;
    const out = new RegExp(String(re.source), String(re.flags));
    seen.set(obj, out);
    return out;
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    seen.set(obj, out);
    for (let i = 0; i < obj.length; i++) out[i] = hostify(obj[i], seen);
    return out;
  }
  if (tag === "[object Map]") {
    const out = new Map<unknown, unknown>();
    seen.set(obj, out);
    for (const [k, v] of obj as Map<unknown, unknown>) out.set(hostify(k, seen), hostify(v, seen));
    return out;
  }
  if (tag === "[object Set]") {
    const out = new Set<unknown>();
    seen.set(obj, out);
    for (const v of obj as Set<unknown>) out.add(hostify(v, seen));
    return out;
  }
  if (tag === "[object Error]") {
    const err = obj as Error;
    const out = new Error(String(err.message));
    out.name = String(err.name);
    seen.set(obj, out);
    return out;
  }

  const out: Record<string, unknown> = {};
  seen.set(obj, out);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    let child: unknown;
    // A getter that throws is the script's problem, not a reason to fail the
    // whole call before the capability has seen anything.
    try {
      child = (obj as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    out[key] = hostify(child, seen);
  }
  return out;
}

/**
 * `readFile is not defined` almost always means a missing import, and the
 * environment knows exactly which module exports that name. Saying so turns a
 * two-turn recovery (re-read the docs, rewrite) into a zero-turn one.
 */
/**
 * The slice of an error message a hint may pattern-match against.
 *
 * Error text is script-controlled and unbounded; every regex below is applied
 * to this, not to the raw message.
 */
function hintable(message: string): string {
  return message.slice(0, 400).split("\n")[0];
}

/**
 * The line, the source, and the caret — which V8 puts in the stack, not the
 * message.
 *
 * `new vm.Script` throws a SyntaxError whose `.message` is just
 * "Unexpected identifier 'the'". The stack's first three lines are
 * `file:line`, the offending source, and a `^^^` under the token. That is the
 * part worth showing; the rest of the stack is host frames.
 */
function locateSyntaxError(e: unknown): string {
  const stack = e instanceof Error ? (e.stack ?? "") : "";
  const [head, source, caret] = stack.split("\n");
  const line = /:(\d+)$/.exec(head ?? "")?.[1];
  if (!line || !source) return "";
  const shown = source.length > 200 ? `${source.slice(0, 200)}…` : source;
  // The caret column only means anything against the untruncated line.
  const pointer = caret?.trim().startsWith("^") && source.length <= 200 ? `\n${caret}` : "";
  return `\n  at line ${line}:\n${shown}${pointer}`;
}

export function importHint(message: string, modules: Map<string, Record<string, unknown>>): string | null {
  const missing = /^(?:Uncaught )?ReferenceError: (\w+) is not defined|^(\w+) is not defined/.exec(hintable(message));
  const name = missing?.[1] ?? missing?.[2];
  if (!name) return null;
  const owners: string[] = [];
  for (const [mod, ns] of modules) {
    if (Object.prototype.hasOwnProperty.call(ns, name)) owners.push(mod);
  }
  if (owners.length === 0) return null;
  const suggestions = owners.map((m) => `import { ${name} } from 'env:${m}'`);
  return `did you mean to import it? ${suggestions.join(" or ")}`;
}

/** String methods, called on something that is not a string. */
const STRING_METHOD_RE =
  /(\w+)\.(endsWith|startsWith|includes|toLowerCase|toUpperCase|split|trim|replace|slice|match) is not a function/;

/**
 * The readdir shape mistake, named.
 *
 * Node's `fs.readdir` returns strings; ours returns entry objects, so
 * `entries.filter(f => f.endsWith('.png'))` is the single most common
 * in-script slip — the `.d.ts` warns about it in capitals and models still
 * write it. The TypeError alone ("f.endsWith is not a function") does not say
 * what `f` is, which is the only fact that would fix it.
 */
export function shapeHint(message: string, source: string | null): string | null {
  // Match against a bounded prefix, never the whole message. `\w+` scanning
  // an unanchored pattern over a script-controlled string backtracks
  // quadratically — a script that throws half a megabyte of "E" hangs the
  // process, which is how tests/audit.test.ts found this. A real TypeError of
  // this shape is one short line.
  const hit = STRING_METHOD_RE.exec(hintable(message));
  if (!hit) return null;
  if (!source || !/\breaddir\b/.test(source)) return null;
  return (
    `readdir() returns entry objects, not strings — use \`${hit[1]}.name.${hit[2]}(…)\`, ` +
    `or glob('/dir/*.ext') which returns full paths.`
  );
}

/** The file a V8 stack frame refers to, or null if the line isn't a frame. */
function frameFile(line: string): string | null {
  const parenthesised = /^\s+at .*\((.+):\d+:\d+\)\s*$/.exec(line);
  if (parenthesised) return parenthesised[1];
  const bare = /^\s+at (.+):\d+:\d+\s*$/.exec(line);
  return bare ? bare[1] : null;
}

/**
 * Render an error for the model: the message, plus the stack frames that are
 * genuinely inside its own scripts.
 *
 * `modules` is the set of filenames the executor handed to `vm.Script` — i.e.
 * the VFS paths it actually loaded. A frame is kept only if its file is one of
 * them, and that exactness is the point.
 *
 * The previous version matched `/(scripts|tmp|inbox|out)/` as a substring
 * anywhere in the frame, intending "a VFS path". It let through any HOST path
 * containing those segments — and `out/` and `scripts/` are ordinary directory
 * names in a real deployment, while host `/tmp` collides with VFS `/tmp`
 * exactly. A host stack frame reaching sandboxed code discloses the host's
 * filesystem layout and module structure to the one party the whole design
 * exists to keep it from.
 */
export function describeError(e: unknown, modules?: ReadonlySet<string>): string {
  if (e instanceof ScriptContractError) return e.message;
  const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
  const stack = (e as { stack?: string })?.stack;
  // No module set means no way to tell a script frame from a host one, so no
  // frames. Silence is the only safe default here.
  if (typeof stack === "string" && modules && modules.size > 0) {
    const frames = stack
      .split("\n")
      .filter((l) => {
        const file = frameFile(l);
        return file !== null && modules.has(file);
      })
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
