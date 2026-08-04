/**
 * Capability error tagging.
 *
 * When something fails inside a script the model sees only a message. A bare
 * `Invalid PDF structure` says nothing about *which* call produced it; in a
 * script that touches four capabilities that costs a debugging round trip. So
 * every function reachable through an `env:*` module is wrapped to prefix its
 * failures with the capability path that raised them:
 *
 *     env:documents.pdf.merge: Invalid PDF structure
 *
 * The wrapper is transparent otherwise — same arity, same name, sync and
 * async alike — and only the message changes, so nothing that inspects error
 * types host-side is affected (the host-side `env.fs` handle is a different
 * object and is never tagged).
 */

import { BUILDER } from "../executor/protocol";

/** How deep to walk a namespace looking for functions to tag. */
const MAX_DEPTH = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isThenable(v: unknown): v is Promise<unknown> {
  return typeof (v as { then?: unknown } | null)?.then === "function";
}

/**
 * Prefix an error's message with the capability path, unless it already
 * carries one. The error's `name` is preserved — that plus the message is all
 * the realm bridge carries into a script anyway.
 */
function retag(label: string, e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  if (e.message.startsWith(`${label}: `) || e.message.startsWith("env:")) return e;
  const tagged = new Error(`${label}: ${e.message}`, { cause: e });
  tagged.name = e.name;
  // Keep the original stack: the frames that matter are the adapter's, and
  // rewriting them would point at this file instead.
  if (typeof e.stack === "string") tagged.stack = e.stack;
  return tagged;
}

function tagFn(label: string, fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    try {
      const out = fn.apply(this, args);
      return isThenable(out) ? out.then(undefined, (e: unknown) => Promise.reject(retag(label, e))) : out;
    } catch (e) {
      throw retag(label, e);
    }
  };
  // Preserve the observable shape of the original: `fn.length` is how a
  // script (or a doc generator) reads an arity, and `fn.name` shows up in
  // stack traces.
  Object.defineProperty(wrapped, "name", { value: fn.name, configurable: true });
  Object.defineProperty(wrapped, "length", { value: fn.length, configurable: true });
  return wrapped;
}

function tagValue(label: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  // A builder is a description carried on a symbol, not a callable. Walking
  // it would rebuild the object from its string keys — of which it has none —
  // and the description would be silently gone, leaving the script an empty
  // object where it expected a constructor. Its failures are tagged during
  // replay instead, which is where the calls actually happen.
  if (value !== null && typeof value === "object" && (value as Record<symbol, unknown>)[BUILDER] !== undefined) {
    return value;
  }
  if (typeof value === "function") return tagFn(label, value as (...args: unknown[]) => unknown);
  if (depth >= MAX_DEPTH || !isPlainObject(value)) return value;
  // A namespace that reappears (or is cyclic) keeps its first tagging.
  if (seen.has(value)) return value;
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = tagValue(`${label}.${key}`, value[key], depth + 1, seen);
  }
  return out;
}

/**
 * Wrap every function reachable in a module's bindings so its failures name
 * the capability. Returns a copy — the input is untouched.
 */
export function tagBindings(moduleName: string, bindings: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(bindings)) {
    out[key] = tagValue(`env:${moduleName}.${key}`, bindings[key], 1, seen);
  }
  return out;
}
