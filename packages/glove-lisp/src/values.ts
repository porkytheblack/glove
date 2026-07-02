/**
 * The value model. Deliberately JSON-native: lists are JS arrays, maps are
 * plain string-keyed objects, so rows coming back from a resource resolver ARE
 * Lisp data with zero shaping. Two non-JSON citizens exist only as *program*
 * vocabulary:
 *
 *   - {@link Keyword} (`:state`) — an interned lookup token. It coerces to its
 *     name wherever data is concerned (map keys, equality against strings), and
 *     is callable (`(:state row)` reads `row.state`), which is the idiom models
 *     reach for out of Clojure muscle memory.
 *   - {@link Sym} — an identifier in source, resolved against the environment.
 *
 * Truthiness is Clojure's: `nil` and `false` are falsey; everything else —
 * including 0, "" and [] — is truthy.
 */

export class Keyword {
  private constructor(readonly name: string) {}
  private static interned = new Map<string, Keyword>();
  static for(name: string): Keyword {
    let k = Keyword.interned.get(name);
    if (!k) {
      k = new Keyword(name);
      Keyword.interned.set(name, k);
    }
    return k;
  }
  toString(): string {
    return `:${this.name}`;
  }
  toJSON(): string {
    return this.name;
  }
}

export class Sym {
  constructor(readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

/** Branded onto Lambda / NativeFn prototypes (eval.ts) so the printer can
 *  recognise function objects without a circular import. */
export const FN_MARKER: unique symbol = Symbol("glove-lisp.fn");

export function isFnValue(v: unknown): boolean {
  return typeof v === "function" || (typeof v === "object" && v !== null && FN_MARKER in v);
}

/** A `(...)` form — evaluated as a call / special form. */
export class LList {
  constructor(readonly items: Form[]) {}
}

/** A `[...]` literal — evaluates to a JS array of its evaluated items. */
export class Vec {
  constructor(readonly items: Form[]) {}
}

/** A `{...}` literal — evaluates to a plain object (keys coerced to strings). */
export class MapLit {
  constructor(readonly pairs: Array<[Form, Form]>) {}
}

/** Anything the reader can produce. */
export type Form = LList | Vec | MapLit | Sym | Keyword | string | number | boolean | null;

/** Clojure truthiness: only nil and false are falsey. */
export function truthy(v: unknown): boolean {
  return v !== null && v !== undefined && v !== false;
}

/** Coerce a value used as a map key / lookup argument to a string key. */
export function asKey(v: unknown): string {
  if (v instanceof Keyword) return v.name;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new Error(
    `cannot use ${printForm(v)} as a map key — use a keyword (:name), string, or number`,
  );
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Keyword) && !(FN_MARKER in v)
  );
}

/**
 * Deep equality with one deliberate mercy: a Keyword equals the string of its
 * own name. Data arriving from resolvers is JSON (string enum values); a model
 * writing `(= (:state pr) :open)` out of Clojure habit means "open" — answering
 * `false` there would be a silent wrong answer, the exact failure class the
 * scratchpad work showed is the most corrosive.
 */
export function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Keyword) a = a.name;
  if (b instanceof Keyword) b = b.name;
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!eq(a[k], (b as Record<string, unknown>)[k])) return false;
    return true;
  }
  return false;
}

/** Print a value the way a Lisp REPL would (for error messages and echoes). */
export function printForm(v: unknown): string {
  if (v === null || v === undefined) return "nil";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Keyword) return v.toString();
  if (v instanceof Sym) return v.name;
  if (v instanceof LList) return `(${v.items.map(printForm).join(" ")})`;
  if (v instanceof Vec) return `[${v.items.map(printForm).join(" ")}]`;
  if (v instanceof MapLit) {
    return `{${v.pairs.map(([k, val]) => `${printForm(k)} ${printForm(val)}`).join(", ")}}`;
  }
  if (Array.isArray(v)) return `[${v.map(printForm).join(" ")}]`;
  if (isFnValue(v)) return "#<fn>";
  if (isPlainObject(v)) {
    return `{${Object.entries(v)
      .map(([k, val]) => `:${k} ${printForm(val)}`)
      .join(", ")}}`;
  }
  return String(v);
}

export interface ElideLimits {
  /** Max array elements surfaced per level. Default 25. */
  maxItems: number;
  /** Max characters for a single string value. Default 300. */
  maxString: number;
  /** Max nesting depth surfaced. Default 6. */
  maxDepth: number;
}

export const DEFAULT_ELIDE: ElideLimits = { maxItems: 25, maxString: 300, maxDepth: 6 };

/**
 * Structure-preserving truncation of the value that returns to the model. The
 * whole point of the surface is that big intermediates live in the session
 * environment, not in context — so what does cross the boundary is bounded.
 * Arrays keep their first N items plus an elision marker carrying the true
 * count; long strings are cut with a marker; functions print opaquely.
 */
export function elide(v: unknown, limits: ElideLimits = DEFAULT_ELIDE): { value: unknown; elided: boolean } {
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
    if (x instanceof Keyword) return x.name;
    if (isFnValue(x) || x instanceof Sym) return printForm(x);
    if (depth >= limits.maxDepth) {
      elided = true;
      return Array.isArray(x) ? `… (${x.length} items, too deep)` : "… (nested value, too deep)";
    }
    if (Array.isArray(x)) {
      if (x.length > limits.maxItems) {
        elided = true;
        return [
          ...x.slice(0, limits.maxItems).map((el) => walk(el, depth + 1)),
          `… (+${x.length - limits.maxItems} more of ${x.length} total — use (count …), (take n …), or (def name …) to keep the full value in the session)`,
        ];
      }
      return x.map((el) => walk(el, depth + 1));
    }
    if (isPlainObject(x)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) out[k] = walk(val, depth + 1);
      return out;
    }
    return printForm(x);
  };
  const value = walk(v, 0);
  return { value, elided };
}
