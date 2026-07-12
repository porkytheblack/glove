/**
 * The Python value model, over plain JS values so tool results (JSON) are usable
 * with zero shaping:
 *
 *   int / float → number      str → string        bool → boolean
 *   None → null               list / tuple → array (JS array)
 *   dict → plain object (string keys, JSON-compatible)   set → Set
 *
 * Functions are a `Closure` (never a real JS function, so host code can't call
 * them synchronously). `range(...)` is a lazy {@link PyRange}. Tuples are arrays
 * tagged non-enumerably so `repr`/immutability messages can tell them apart —
 * functionally they behave like lists in this subset.
 */

/** A lazy range so `range(10**9)` doesn't materialize. */
export class PyRange {
  constructor(
    readonly start: number,
    readonly stop: number,
    readonly step: number,
  ) {}
  get length(): number {
    if (this.step === 0) return 0;
    return Math.max(0, Math.ceil((this.stop - this.start) / this.step));
  }
  *[Symbol.iterator](): Iterator<number> {
    if (this.step > 0) for (let i = this.start; i < this.stop; i += this.step) yield i;
    else if (this.step < 0) for (let i = this.start; i > this.stop; i += this.step) yield i;
  }
}

const TUPLE = Symbol("py.tuple");

/** Mark an array as a tuple (repr with parens; conceptually immutable). */
export function tuple(items: unknown[]): unknown[] {
  Object.defineProperty(items, TUPLE, { value: true, enumerable: false });
  return items;
}
export function isTuple(v: unknown): boolean {
  return Array.isArray(v) && (v as { [TUPLE]?: boolean })[TUPLE] === true;
}

/** A plain-object dict (not an array/Set/None/Closure/Range). */
export function isDict(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Set) &&
    !(v instanceof PyRange)
  );
}

/** Python truthiness: None/False/0/""/[]/{}/set() are falsy. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set) return v.size > 0;
  if (v instanceof PyRange) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

/** Structural equality (`==`). */
export function pyEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => pyEquals(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && pyEquals(a[k], b[k]));
  }
  return false;
}

/** Iterate a value Python-style: list/tuple by element, str by char, dict by
 *  key, set by member, range by number. */
export function pyIter(v: unknown): Iterable<unknown> {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v;
  if (v instanceof Set) return v;
  if (v instanceof PyRange) return v;
  if (isDict(v)) return Object.keys(v);
  throw new TypeError(`'${pyTypeName(v)}' object is not iterable`);
}

export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return isTuple(v) ? "tuple" : "list";
  if (v instanceof Set) return "set";
  if (v instanceof PyRange) return "range";
  if (isDict(v)) return "dict";
  return "object";
}

/** Python string repr — single quotes unless the string has a `'` and no `"`. */
function reprStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(q, "g"), "\\" + q)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return q + body + q;
}

/** Python `repr`/`str` for print + elision. */
export function pyRepr(v: unknown, seen = new Set<unknown>()): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return reprStr(v);
  if (seen.has(v)) return "...";
  if (Array.isArray(v)) {
    seen.add(v);
    const inner = v.map((x) => pyRepr(x, seen)).join(", ");
    seen.delete(v);
    return isTuple(v) ? (v.length === 1 ? `(${inner},)` : `(${inner})`) : `[${inner}]`;
  }
  if (v instanceof Set) {
    if (v.size === 0) return "set()";
    return `{${[...v].map((x) => pyRepr(x, seen)).join(", ")}}`;
  }
  if (v instanceof PyRange) return `range(${v.start}, ${v.stop}${v.step !== 1 ? `, ${v.step}` : ""})`;
  if (isDict(v)) {
    seen.add(v);
    const inner = Object.entries(v).map(([k, val]) => `${reprStr(k)}: ${pyRepr(val, seen)}`).join(", ");
    seen.delete(v);
    return `{${inner}}`;
  }
  return String(v);
}

/** `str()` — like repr but bare strings aren't quoted. */
export function pyStr(v: unknown): string {
  return typeof v === "string" ? v : pyRepr(v);
}
