/**
 * Pure modules: a host npm package exposed to scripts SYNCHRONOUSLY.
 *
 * Adapters cross a thread boundary, so every adapter call is async — and for
 * I/O that is fine, because `await pdf.create(...)` is what anyone would
 * write. It is wrong for a library like lodash, whose entire idiom is
 * synchronous: `rows.map((r) => camelCase(r.name))` cannot await, and routing
 * such a library through an adapter makes the model's muscle-memory code fail
 * *silently* — an un-awaited call stringifies as `{}` and the run reports
 * success. Measured, not hypothetical.
 *
 * A pure module takes the other route, the one `env:std` already uses: the
 * code is imported INSIDE the worker and bound into the vm context directly,
 * so calls never leave the thread and stay synchronous. This is also the
 * forgiving direction for a model: `await` on a plain value is a no-op, so
 * both `groupBy(rows, 'r')` and `await groupBy(rows, 'r')` are correct.
 * There is no syntax to get wrong.
 *
 * ```ts
 * const env = await createWorkingEnvironment({
 *   stdlib: [
 *     documents(),
 *     definePureModule({
 *       name: "lodash",
 *       from: "lodash",
 *       description: "Lodash utilities for shaping data.",
 *       pick: ["groupBy", "sumBy", "orderBy", "uniqBy", "camelCase", "cloneDeep"],
 *     }),
 *   ],
 * });
 * // scripts: import { groupBy } from 'env:lodash';  — no await needed
 * ```
 *
 * `pick` is a hard boundary, not a convenience. These functions run in the
 * worker's own realm — outside the vm sandbox — so the list is what keeps a
 * script away from library members that COMPILE STRINGS INTO CODE. That is
 * the one genuinely dangerous class: `_.template` runs `Function(source)` in
 * the worker realm, which hands a script arbitrary code execution outside
 * the sandbox. Never pick a template/eval-shaped member. Members reachable on
 * `Object.prototype` are refused outright, for the same reason the builder
 * allowlist refuses them.
 *
 * Callbacks work in both directions: `sumBy(rows, r => r.n)` is fine, and a
 * returned function (`memoize`, `curry`) crosses back as a guarded
 * context-realm wrapper — callable, but not a route to the host realm
 * (pinned by tests/pure.test.ts).
 */
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { StdlibAdapter } from "../types";

/** Internal marker + prime state. A symbol so nothing structural can fake it. */
export const PURE = Symbol.for("glove.pure-module");

export interface PureModuleSpec {
  /** Module name: `"lodash"` → scripts write `import { … } from 'env:lodash'`. */
  name: string;
  /** One-liner surfaced in `ls /std` and the tool description. */
  description: string;
  /**
   * What to import: a package name (`"lodash"`, resolved from the host app's
   * working directory), an absolute path, or a `file://` URL. When bare-name
   * resolution fails (unusual layouts, ESM-only exports maps), pass
   * `import.meta.resolve("pkg")` and it will always work.
   */
  from: string;
  /**
   * The exports scripts may use. Required — see the module doc above for why
   * this is a security boundary rather than a convenience. Every name is
   * verified against the real module when the environment is created, so a
   * typo fails loudly and early instead of as `undefined` in a script.
   */
  pick: string[];
  /**
   * `.d.ts` source for `/std/<name>/index.d.ts`. Optional: when omitted,
   * accurate synchronous declarations are generated from `pick` at creation
   * time — which is usually better than hand-writing them, because the one
   * mistake that matters here is declaring `Promise<…>` on a synchronous
   * binding and teaching the model to expect the wrong shape.
   */
  types?: string;
  /** README for `/std/<name>/README.md`. Optional: a correct one is generated. */
  docs?: string;
  /** Worked recipes for `/skills`, exactly as on any adapter. */
  skills?: StdlibAdapter["skills"];
}

interface PureState {
  spec: PureModuleSpec;
  /** Filled by {@link primePureModule}; consumed by index.ts and the pool. */
  url?: string;
  bindings?: Record<string, unknown>;
  generatedTypes?: string;
  generatedDocs?: string;
}

/** True for names reachable on Object.prototype rather than the library's own API. */
function suspicious(name: string): boolean {
  return (
    name.startsWith("__") ||
    name === "constructor" ||
    name === "prototype" ||
    Object.prototype.hasOwnProperty.call(Object.prototype, name)
  );
}

/**
 * Declare a pure module. Checked eagerly, like `defineAdapter`: a bad spec
 * fails here, in the author's own stack trace, not at environment creation.
 *
 * The returned object is `StdlibAdapter`-shaped so it goes in the same
 * `stdlib: [...]` array as every other adapter — there is no second option
 * to learn.
 */
export function definePureModule(spec: PureModuleSpec): StdlibAdapter {
  if (typeof spec?.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(spec.name)) {
    throw new Error(`definePureModule: invalid name ${JSON.stringify(spec?.name)} — lowercase, starting with a letter`);
  }
  if (typeof spec.from !== "string" || spec.from.trim() === "") {
    throw new Error(`definePureModule("${spec.name}"): \`from\` is required — a package name, absolute path, or file:// URL`);
  }
  if (!Array.isArray(spec.pick) || spec.pick.length === 0) {
    throw new Error(
      `definePureModule("${spec.name}"): \`pick\` is required and non-empty — it is the boundary between ` +
        `scripts and code that runs outside the sandbox, so it cannot default to "everything"`,
    );
  }
  for (const name of spec.pick) {
    if (typeof name !== "string" || suspicious(name)) {
      throw new Error(
        `definePureModule("${spec.name}"): pick contains ${JSON.stringify(name)}, which is reachable on ` +
          `Object.prototype or is an internal — a list containing it is not an allowlist`,
      );
    }
  }
  if (new Set(spec.pick).size !== spec.pick.length) {
    throw new Error(`definePureModule("${spec.name}"): pick has duplicates`);
  }

  const state: PureState = { spec };

  const adapter: StdlibAdapter = {
    name: spec.name,
    description: spec.description,
    // Reads through to the generated declarations once primed, so audit and
    // /std materialization both see the real thing without the author ever
    // writing it.
    get types() {
      return spec.types ?? state.generatedTypes ?? "";
    },
    get docs() {
      return spec.docs ?? state.generatedDocs;
    },
    ...(spec.skills ? { skills: spec.skills } : {}),
    create: () => {
      if (!state.bindings) {
        throw new Error(
          `pure module "${spec.name}" is imported when the environment is created — pass it to ` +
            `createWorkingEnvironment({ stdlib: [...] }) (or createAdapterTestEnv) rather than calling create() directly`,
        );
      }
      return state.bindings;
    },
  };
  (adapter as unknown as Record<symbol, PureState>)[PURE] = state;
  return adapter;
}

/** The prime state, or null when the adapter is an ordinary one. */
export function pureStateOf(adapter: StdlibAdapter): PureState | null {
  return (adapter as unknown as Record<symbol, PureState | undefined>)[PURE] ?? null;
}

/**
 * Resolve `from` to a concrete file URL.
 *
 * Resolution happens host-side and the URL travels to the worker, so the
 * worker never depends on a working directory. A bare name resolves from the
 * host app's cwd, which is where the dependency actually lives — resolving
 * from this package would only find this package's own dependencies.
 */
function resolveFrom(name: string, from: string): string {
  if (from.startsWith("file://")) return from;
  if (isAbsolute(from)) return pathToFileURL(from).href;
  try {
    return pathToFileURL(createRequire(pathToFileURL(join(process.cwd(), "__pure_resolve__.js"))).resolve(from)).href;
  } catch {
    throw new Error(
      `pure module "${name}": could not resolve "${from}" from ${process.cwd()}. ` +
        `Pass the resolved location instead: from: import.meta.resolve("${from}")`,
    );
  }
}

/** `ns.name`, looking through a CJS default the way dynamic import wraps one. */
export function pickFrom(ns: Record<string, unknown>, name: string): unknown {
  if (name in ns && ns[name] !== undefined) return ns[name];
  const dflt = ns.default as Record<string, unknown> | undefined;
  return dflt && typeof dflt === "object" ? dflt[name] : (dflt as unknown as Record<string, unknown> | undefined)?.[name];
}

/**
 * Import the module host-side, verify every picked name exists, and build
 * what registration and the worker both need. Called once per environment by
 * `createWorkingEnvironment`; the host import doubles as validation, so a bad
 * `from` or a guessed pick fails HERE with a message naming the fix — never
 * inside a worker, and never as `undefined` in a script.
 */
export async function primePureModule(adapter: StdlibAdapter): Promise<{ name: string; url: string; pick: string[] }> {
  const state = pureStateOf(adapter);
  if (!state) throw new Error(`"${adapter.name}" is not a pure module`);
  const { spec } = state;

  const url = resolveFrom(spec.name, spec.from);
  const ns = (await import(url)) as Record<string, unknown>;

  const bindings: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const name of spec.pick) {
    const value = pickFrom(ns, name);
    if (value === undefined) missing.push(name);
    else bindings[name] = value;
  }
  if (missing.length > 0) {
    const available = [
      ...Object.keys(ns).filter((k) => k !== "default"),
      ...(typeof ns.default === "object" || typeof ns.default === "function"
        ? Object.keys(ns.default as object)
        : []),
    ];
    throw new Error(
      `pure module "${spec.name}": "${spec.from}" has no export ${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `Available: ${[...new Set(available)].slice(0, 20).join(", ")}${available.length > 20 ? ", …" : ""}`,
    );
  }

  state.url = url;
  state.bindings = bindings;
  state.generatedTypes = generateTypes(spec, bindings);
  state.generatedDocs = generateDocs(spec, bindings);
  return { name: spec.name, url, pick: spec.pick };
}

/**
 * Accurate declarations from the live module. Loose on parameter types —
 * `any` in, `any` out — but exactly right on the one axis that changes what
 * a model writes: everything is synchronous, and the header says so.
 */
function generateTypes(spec: PureModuleSpec, bindings: Record<string, unknown>): string {
  const lines = spec.pick.map((name) =>
    typeof bindings[name] === "function"
      ? `export function ${name}(...args: any[]): any;`
      : `export const ${name}: any;`,
  );
  return (
    `/**\n` +
    ` * env:${spec.name} — ${spec.description}\n` +
    ` *\n` +
    ` * SYNCHRONOUS. These run in your script's own thread: call them like\n` +
    ` * ordinary functions, including inside .map()/.filter() callbacks.\n` +
    ` * \`await\` is allowed and changes nothing.\n` +
    ` */\n\n` +
    lines.join("\n") +
    `\n`
  );
}

function generateDocs(spec: PureModuleSpec, bindings: Record<string, unknown>): string {
  const fns = spec.pick.filter((n) => typeof bindings[n] === "function");
  const firstThree = fns.slice(0, 3);
  return (
    `# env:${spec.name}\n\n` +
    `${spec.description}\n\n` +
    `Everything here is **synchronous** — it runs in your script's own thread. Use it\n` +
    `like a normal library, including inside callbacks. \`await\` is optional and harmless.\n\n` +
    "```js\n" +
    `import { ${firstThree.join(", ")} } from 'env:${spec.name}';\n` +
    "```\n\n" +
    `Available: ${spec.pick.join(", ")}.\n`
  );
}
