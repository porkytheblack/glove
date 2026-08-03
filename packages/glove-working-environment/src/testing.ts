/**
 * Test support for stdlib adapter authors.
 *
 * Testing an adapter means testing it *from inside a script*, because that is
 * the only place it is ever used: through the realm bridge, with marshalled
 * arguments and results, against the guarded VFS. Reaching into `create()`
 * directly and calling the raw functions tests something the model never
 * touches. So the harness gives you a real environment with your adapter
 * registered and one method to run a script in it.
 *
 * ```ts
 * import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
 *
 * const t = await createAdapterTestEnv(images());
 * await t.fs.writeFile("/inbox/logo.png", bytes);
 *
 * const meta = await t.script(`
 *   import { describe } from 'env:images';
 *   export default async function main() { return describe('/inbox/logo.png'); }
 * `);
 * assert.equal(meta.format, "png");
 *
 * assertAdapterOk(await t.audit());   // docs/types actually match the bindings
 * ```
 */
import { createWorkingEnvironment, type WorkingEnvironment } from "./index";
import { createFsHandle } from "./builtins/fs";
import type { AdapterContext } from "./adapters/define";
import type { EnvFsHandle, EnvLimits, RunResult, StdlibAdapter, Vfs } from "./types";

export interface AdapterTestEnv {
  /** The live environment, with the adapter registered. */
  env: WorkingEnvironment;
  /** Host-side guarded filesystem handle — stage inputs, assert on outputs. */
  fs: EnvFsHandle;
  /**
   * Write a script into the tree and run it, returning what its default
   * export resolved to. Throws if the script fails, with stderr attached —
   * so a broken adapter shows up as a failed assertion, not a silent
   * `undefined`.
   */
  script<T = unknown>(source: string, args?: unknown): Promise<T>;
  /**
   * The same, but never throws: returns the full {@link RunResult} so you can
   * assert on failure messages. This is how you pin an adapter's error text.
   */
  runScript(source: string, args?: unknown): Promise<RunResult>;
  /** Check the adapter's docs and types against its actual bindings. */
  audit(): Promise<AdapterAudit>;
}

export interface CreateAdapterTestEnvOptions {
  /** Extra adapters to register alongside the one under test. */
  also?: StdlibAdapter[];
  limits?: Partial<EnvLimits>;
  filesystem?: Vfs;
}

/** Spin up an environment with `adapter` registered, ready to run scripts. */
export async function createAdapterTestEnv(
  adapter: StdlibAdapter,
  options: CreateAdapterTestEnvOptions = {},
): Promise<AdapterTestEnv> {
  const env = await createWorkingEnvironment({
    stdlib: [adapter, ...(options.also ?? [])],
    limits: options.limits,
    filesystem: options.filesystem,
  });

  let n = 0;
  const write = async (source: string): Promise<string> => {
    const path = `/scripts/__test_${++n}.js`;
    await env.fs.writeFile(path, source);
    return path;
  };

  return {
    env,
    fs: env.fs,

    async runScript(source: string, args: unknown = {}): Promise<RunResult> {
      let path: string;
      try {
        path = await write(source);
      } catch (e) {
        // A write-time contract/validation failure is a legitimate outcome to
        // assert on, so report it in the same shape a run failure takes.
        return {
          ok: false,
          result: undefined,
          stdout: "",
          stderr: "",
          durationMs: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      return env.runScript(path, args);
    },

    async script<T>(source: string, args: unknown = {}): Promise<T> {
      const path = await write(source);
      const run = await env.runScript(path, args);
      if (!run.ok) {
        const detail = [run.error, run.stderr && `stderr:\n${run.stderr}`].filter(Boolean).join("\n");
        throw new Error(`script failed: ${detail}`);
      }
      return run.result as T;
    },

    async audit(): Promise<AdapterAudit> {
      return auditAdapter(adapter, env);
    },
  };
}

// ------------------------------------------------------------------- audit

export interface AdapterAudit {
  name: string;
  /** True when there are no errors (warnings are advisory). */
  ok: boolean;
  /** Things that will actively mislead the model. */
  errors: string[];
  /** Things that make the adapter harder to use well. */
  warnings: string[];
  /** Top-level binding names the adapter exposes. */
  bindings: string[];
}

/** `export function foo(` / `export const foo:` / `export declare class Foo` … */
const EXPORTED_VALUE_RE = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

const IDENT_CHAR = /[\w$]/;

/**
 * Every callable signature in a `.d.ts`, by name, mapped to whether that
 * signature's declared return type is a Promise.
 *
 * Covers the three shapes an adapter's types actually use — `function f():
 * T`, the method form `f(): T` inside an interface, and `f: () => T` — by
 * finding each `(`, balance-scanning to its `)`, reading the name backwards
 * and the return type forwards. A signature whose generic parameters nest
 * (`f<T extends Map<K, V>>()`) is simply not found, which is the safe way to
 * fail: an unfound name is never reported.
 */
function callableSignatures(types: string): Map<string, boolean[]> {
  const found = new Map<string, boolean[]>();

  for (let i = 0; i < types.length; i++) {
    if (types[i] !== "(") continue;

    // Backwards: optional `<...>` generics, then the name, then an optional
    // `:` (which is what distinguishes `f: (x) => T` from `f(x): T`).
    let b = i - 1;
    while (b >= 0 && /\s/.test(types[b])) b--;
    if (types[b] === ">") {
      const open = types.lastIndexOf("<", b);
      if (open < 0 || types.slice(open, b).includes("(")) continue;
      b = open - 1;
      while (b >= 0 && /\s/.test(types[b])) b--;
    }
    if (types[b] === ":") {
      b--;
      while (b >= 0 && /\s/.test(types[b])) b--;
    }
    const end = b;
    while (b >= 0 && IDENT_CHAR.test(types[b])) b--;
    if (b === end) continue;
    const name = types.slice(b + 1, end + 1);
    if (name === "" || /^\d/.test(name)) continue;

    // Forwards: balance to the closing paren, then `:` or `=>`.
    let depth = 0;
    let j = i;
    for (; j < types.length; j++) {
      if (types[j] === "(") depth++;
      else if (types[j] === ")" && --depth === 0) break;
    }
    if (depth !== 0) continue;
    j++;
    while (j < types.length && /\s/.test(types[j])) j++;
    if (types[j] === ":") j++;
    else if (types.startsWith("=>", j)) j += 2;
    else continue;
    while (j < types.length && /\s/.test(types[j])) j++;

    const promise = types.startsWith("Promise", j) && !IDENT_CHAR.test(types[j + 7] ?? "");
    const seen = found.get(name);
    if (seen) seen.push(promise);
    else found.set(name, [promise]);
  }
  return found;
}

/** Every function reachable in the bindings tree, by name. */
function callableNames(bindings: Record<string, unknown>, depth = 0): Set<string> {
  const names = new Set<string>();
  if (depth > 3) return names;
  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === "function") names.add(key);
    else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      // Nested namespaces are marshalled binding-by-binding, so their
      // functions cross the thread boundary exactly like top-level ones.
      for (const nested of callableNames(value as Record<string, unknown>, depth + 1)) names.add(nested);
    }
  }
  return names;
}

/**
 * Check an adapter's self-description against what it actually exposes.
 *
 * The failure this catches is specific and expensive: the model reads
 * `/std/<name>/index.d.ts`, writes a script against a function documented
 * there, and gets `undefined is not a function` at runtime — or never
 * discovers a capability because it was implemented but not declared. Both
 * are invisible to ordinary unit tests, which import the bindings directly.
 */
export async function auditAdapter(adapter: StdlibAdapter, env?: WorkingEnvironment): Promise<AdapterAudit> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = typeof adapter?.name === "string" ? adapter.name : "(unnamed)";
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    errors.push(`name ${JSON.stringify(name)} is not a valid module name (lowercase, starting with a letter)`);
  }
  if (typeof adapter?.description !== "string" || adapter.description.trim() === "") {
    errors.push("description is empty — it is the only text shown next to the module in ls /std");
  } else if (adapter.description.length > 200) {
    warnings.push(`description is ${adapter.description.length} chars; it is a one-liner, keep it under ~200`);
  }
  const types = typeof adapter?.types === "string" ? adapter.types : "";
  if (types.trim() === "") errors.push("types is empty — the model has no way to learn the API");
  if (typeof adapter?.docs !== "string" || adapter.docs.trim() === "") {
    warnings.push("no docs — a README with two worked examples is the difference between a used and an ignored adapter");
  }

  // Instantiate through the same guarded handle the environment would use.
  let bindings: Record<string, unknown> = {};
  const owned = env ?? (await createWorkingEnvironment());
  try {
    const ctx: AdapterContext = { name, readOnly: false };
    const produced = (adapter.create as (vfs: EnvFsHandle, ctx: AdapterContext) => Record<string, unknown>)(
      owned.fs,
      ctx,
    );
    if (!produced || typeof produced !== "object") {
      errors.push(`create() returned ${produced === null ? "null" : typeof produced}, expected an object of bindings`);
    } else {
      bindings = produced;
    }
  } catch (e) {
    errors.push(`create() threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  const names = Object.keys(bindings);
  if (names.length === 0 && errors.length === 0) errors.push("create() returned no bindings");
  if (names.includes("default")) {
    errors.push("a binding named `default` is overwritten by the module namespace — rename it");
  }

  for (const key of names) {
    if (!new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(types)) {
      errors.push(`binding \`${key}\` is not mentioned in types — the model cannot discover it`);
    }
  }

  const declared = new Set<string>();
  for (const m of types.matchAll(EXPORTED_VALUE_RE)) declared.add(m[1]);
  for (const key of declared) {
    if (!names.includes(key)) {
      errors.push(`types declares \`${key}\` but create() does not return it — a script following the docs will crash`);
    }
  }

  // A capability call is cross-thread RPC, so it always resolves to a
  // promise no matter how the host implemented it. Types that say otherwise
  // are the expensive kind of wrong: the model reads `parse(s): Row[]`,
  // writes `const rows = parse(s)`, and gets a Promise where it expected an
  // array — usually surfacing much later as an empty result rather than an
  // error. Only flagged when EVERY declaration of that name is synchronous,
  // so overloads and same-named callback parameters cannot trip it.
  const signatures = callableSignatures(types);
  for (const key of callableNames(bindings)) {
    const declared = signatures.get(key);
    if (declared && declared.length > 0 && !declared.some(Boolean)) {
      errors.push(
        `binding \`${key}\` is declared with a synchronous return type — scripts call capabilities across a thread boundary, so it must be declared \`Promise<…>\` (a script that forgets to await gets a promise where the docs promised a value)`,
      );
    }
  }

  if (!names.includes("describe")) {
    warnings.push(
      "no describe(path) binding — format adapters should expose one so a model can summarize a binary artifact without reading bytes it cannot interpret",
    );
  }

  return { name, ok: errors.length === 0, errors, warnings, bindings: names };
}

/** Throw a readable report unless the audit passed. Warnings never throw. */
export function assertAdapterOk(audit: AdapterAudit): void {
  if (audit.ok) return;
  const lines = audit.errors.map((e) => `  ✗ ${e}`);
  throw new Error(`adapter "${audit.name}" failed its audit:\n${lines.join("\n")}`);
}

/**
 * Build a bare guarded VFS handle over a throwaway environment. For the rare
 * test that needs a handle without running scripts — prefer
 * {@link createAdapterTestEnv}, which exercises the realm bridge too.
 */
export async function createTestFsHandle(): Promise<EnvFsHandle> {
  const env = await createWorkingEnvironment();
  return env.fs;
}

export { createFsHandle };
export type { AdapterContext };
