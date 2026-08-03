/**
 * The script contract: every runnable script must default-export a function.
 * The error strings here are the guardrail UX — they name the problem and
 * show the fix.
 */

export class ScriptContractError extends Error {
  constructor(
    public readonly path: string,
    public readonly contractMessage: string,
  ) {
    super(`${path}: ${contractMessage}`);
  }
}

/**
 * A module namespace reduced to what the contract and `.d.ts` generation need.
 *
 * Scripts are evaluated in a worker thread, so the namespace itself never
 * reaches the host — a function cannot cross a thread boundary. Everything
 * either check actually consults is a string or a boolean, so this crosses
 * intact and the checks stay exactly as strict.
 */
export interface ModuleContract {
  hasDefault: boolean;
  /** `typeof ns.default`, or "array"/"null" — only read when it is not a function. */
  defaultKind: string;
  /** `fn.name` when the default is a function. */
  defaultName?: string;
  /** `Function.prototype.toString.call(fn)` when the default is a function. */
  defaultSource?: string;
  /** Export names other than `default`. */
  namedExports: string[];
}

/** Reduce a live namespace to its contract. Called inside the worker. */
export function contractOf(ns: Record<string, unknown>): ModuleContract {
  const hasDefault = "default" in ns;
  const value = ns.default;
  const isFn = typeof value === "function";
  return {
    hasDefault,
    defaultKind: typeOf(value),
    ...(isFn
      ? {
          defaultName: (value as { name?: string }).name ?? "",
          defaultSource: Function.prototype.toString.call(value as (...a: unknown[]) => unknown),
        }
      : {}),
    namedExports: Object.keys(ns).filter((k) => k !== "default"),
  };
}

/**
 * Returns `null` when the module satisfies the default-export contract,
 * otherwise the exact guardrail message.
 */
export function defaultExportError(contract: ModuleContract): string | null {
  if (contract.hasDefault) {
    if (contract.defaultKind === "function") return null;
    return `default export is a ${contract.defaultKind}; expected a function of shape async (args) => result.`;
  }
  const named = contract.namedExports;
  if (named.length > 0) {
    return `script exports { ${named.join(", ")} } but no default. Add "export default ${named[0]}" or wrap in a default function. Scripts must export default async function(args) { ... }`;
  }
  return `script has no default export. Scripts must export default async function(args) { ... } — top-level program-style scripts are not supported.`;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
