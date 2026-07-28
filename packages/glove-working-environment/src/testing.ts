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
