/**
 * Utilities shared by the fn-mode surfaces (glove-lisp's function mode,
 * glove-js): structural output elision and a small did-you-mean helper.
 *
 * These are generalized copies of `glove-lisp/src/values.ts#elide` and
 * `glove-lisp/src/env.ts#closest` — glove-lisp keeps its own (they carry
 * Lisp-specific value handling and were hardened through the live A/B runs);
 * these versions swap the Lisp value model for an `opaque` hook so any surface
 * can plug its own non-JSON citizens in. Consolidation is a later pass.
 */

export interface ElideLimits {
  /** Max array elements surfaced per level. Default 25. */
  maxItems: number;
  /** Max characters for a single string value. Default 300. */
  maxString: number;
  /** Max nesting depth surfaced. Default 6. */
  maxDepth: number;
}

export const DEFAULT_ELIDE: ElideLimits = { maxItems: 25, maxString: 300, maxDepth: 6 };

export interface ElideOptions extends ElideLimits {
  /** Print a non-JSON value opaquely (host functions, interpreter closures).
   *  Return undefined to fall through to the default handling. */
  opaque?: (v: unknown) => string | undefined;
  /** Surface-flavored suffix for the truncated-array marker, naming the idiom
   *  that keeps the full value in the session (e.g. "use .length, .slice(0, n),
   *  or const name = … to keep the full value in the session"). */
  keepHint?: string;
}

const DEFAULT_KEEP_HINT =
  "return a count, a small slice, or bind it to a session variable to keep the full value";

/**
 * Structure-preserving truncation of the value that returns to the model. The
 * point of a REPL surface is that big intermediates live in the session, not in
 * context — so what does cross the boundary is bounded. Arrays keep their first
 * N items plus an elision marker carrying the true count; long strings are cut
 * with a marker; functions print opaquely.
 */
export function elide(
  v: unknown,
  opts: Partial<ElideOptions> = {},
): { value: unknown; elided: boolean } {
  const limits: ElideOptions = { ...DEFAULT_ELIDE, ...opts };
  let elided = false;
  const walk = (x: unknown, depth: number): unknown => {
    if (x === undefined) return null;
    if (x === null || typeof x === "boolean" || typeof x === "number") return x;
    if (typeof x === "string") {
      if (x.length > limits.maxString) {
        elided = true;
        return `${x.slice(0, limits.maxString)}… (${x.length} chars total)`;
      }
      return x;
    }
    const printed = limits.opaque?.(x);
    if (printed !== undefined) return printed;
    if (typeof x === "function") return "#<fn>";
    if (x instanceof Date) return x.toISOString();
    if (x instanceof Set) return walk([...x], depth);
    if (x instanceof Map) return walk(Object.fromEntries(x), depth);
    if (depth >= limits.maxDepth) {
      elided = true;
      return Array.isArray(x) ? `… (${x.length} items, too deep)` : "… (nested value, too deep)";
    }
    if (Array.isArray(x)) {
      if (x.length > limits.maxItems) {
        elided = true;
        return [
          ...x.slice(0, limits.maxItems).map((el) => walk(el, depth + 1)),
          `… (+${x.length - limits.maxItems} more of ${x.length} total — ${limits.keepHint ?? DEFAULT_KEEP_HINT})`,
        ];
      }
      return x.map((el) => walk(el, depth + 1));
    }
    if (typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) out[k] = walk(val, depth + 1);
      return out;
    }
    return String(x);
  };
  const value = walk(v, 0);
  return { value, elided };
}

/** Small Levenshtein for "unknown name — did you mean …" suggestions. */
export function closest(name: string, candidates: string[], maxDistance = 3): string | undefined {
  let best: string | undefined;
  let bestD = maxDistance + 1;
  for (const c of candidates) {
    const d = levenshtein(name, c, bestD);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
