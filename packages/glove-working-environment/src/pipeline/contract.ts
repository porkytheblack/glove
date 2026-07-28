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
 * Returns `null` when the module namespace satisfies the default-export
 * contract, otherwise the exact guardrail message.
 */
export function defaultExportError(ns: Record<string, unknown>): string | null {
  if ("default" in ns) {
    if (typeof ns.default === "function") return null;
    return `default export is a ${typeOf(ns.default)}; expected a function of shape async (args) => result.`;
  }
  const named = Object.keys(ns).filter((k) => k !== "default");
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
