/**
 * The sandbox boundary. Every `obj.attr` / `obj[i]` access and `obj.method(...)`
 * call passes through here. Python's classic escape is the dunder chain
 * (`().__class__.__bases__[0].__subclasses__()`), so the gate rejects ANY
 * attribute whose name starts with `_` — combined with values being plain JS
 * (no Python object graph to climb) and a fixed per-type method allowlist, a
 * program can't reach the host.
 *
 * Ergonomics: a dict row supports BOTH `p["count"]` and `p.count` (attribute
 * access reads the key) — matching how models write Python over JSON data.
 */
import { PyError } from "./errors";
import { closest } from "glove-scratchpad/fns";
import { isDict, PyRange, pyTypeName, pyStr, pyRepr, tuple, isTuple } from "./values";

export interface InterpApi {
  apply(fn: unknown, args: unknown[]): Promise<unknown>;
  isCallable(v: unknown): boolean;
  charge(n: number): void;
  /** For tool bindings — the active request's abort signal + actor. */
  signal?: AbortSignal;
  actor?: string;
}

function forbidden(attr: string): boolean {
  return attr.startsWith("_");
}

const STR_METHODS = new Set([
  "upper", "lower", "strip", "lstrip", "rstrip", "split", "rsplit", "splitlines", "join",
  "replace", "startswith", "endswith", "find", "rfind", "index", "count", "format",
  "title", "capitalize", "zfill", "ljust", "rjust", "center", "isdigit", "isalpha",
  "isalnum", "isspace", "islower", "isupper", "removeprefix", "removesuffix",
]);
const LIST_METHODS = new Set(["append", "extend", "pop", "insert", "remove", "index", "count", "sort", "reverse", "copy", "clear"]);
const DICT_METHODS = new Set(["get", "keys", "values", "items", "update", "pop", "setdefault", "copy", "clear", "__contains__"]);
const SET_METHODS = new Set(["add", "remove", "discard", "union", "intersection", "difference", "issubset", "issuperset", "copy", "clear"]);

/** Read `obj.attr` — a dict key, a bound method, or AttributeError. */
export function getAttr(obj: unknown, attr: string, api: InterpApi): unknown {
  if (forbidden(attr)) throw new PyError(`access to '${attr}' is not allowed.`);
  if (obj === null || obj === undefined) throw new PyError(`'NoneType' object has no attribute '${attr}'`);
  if (isDict(obj)) {
    if (Object.hasOwn(obj, attr)) return obj[attr];
    if (DICT_METHODS.has(attr)) return (...args: unknown[]) => callMethod(obj, attr, args, {}, api);
    const hint = closest(attr, Object.keys(obj));
    throw new PyError(`dict has no key '${attr}'${hint ? ` — did you mean '${hint}'?` : ""} (keys: ${Object.keys(obj).slice(0, 8).join(", ")})`);
  }
  if (hasMethod(obj, attr)) return (...args: unknown[]) => callMethod(obj, attr, args, {}, api);
  throw new PyError(`'${pyTypeName(obj)}' object has no attribute '${attr}'`);
}

function hasMethod(obj: unknown, attr: string): boolean {
  if (typeof obj === "string") return STR_METHODS.has(attr);
  if (Array.isArray(obj)) return LIST_METHODS.has(attr);
  if (obj instanceof Set) return SET_METHODS.has(attr);
  return false;
}

/** Assign `obj.attr = v` — only on dicts (attribute-as-key). */
export function setAttr(obj: unknown, attr: string, value: unknown): void {
  if (forbidden(attr)) throw new PyError(`access to '${attr}' is not allowed.`);
  if (isDict(obj)) {
    obj[attr] = value;
    return;
  }
  throw new PyError(`cannot set attribute '${attr}' on '${pyTypeName(obj)}'`);
}

function normIndex(i: number, len: number): number {
  return i < 0 ? len + i : i;
}

/** Read `obj[index]`. */
export function getItem(obj: unknown, index: unknown): unknown {
  if (typeof obj === "string") {
    const i = normIndex(Number(index), obj.length);
    if (i < 0 || i >= obj.length) throw new PyError("string index out of range");
    return obj[i];
  }
  if (Array.isArray(obj)) {
    const i = normIndex(Number(index), obj.length);
    if (i < 0 || i >= obj.length) throw new PyError("list index out of range");
    return obj[i];
  }
  if (isDict(obj)) {
    const key = typeof index === "string" ? index : pyStr(index);
    if (!Object.hasOwn(obj, key)) throw new PyError(`KeyError: ${pyRepr(index)}`);
    return obj[key];
  }
  throw new PyError(`'${pyTypeName(obj)}' object is not subscriptable`);
}

/** Read a slice `obj[lo:hi:step]`. */
export function getSlice(obj: unknown, lo: number | null, hi: number | null, step: number | null): unknown {
  const seq = obj as string | unknown[];
  if (typeof obj !== "string" && !Array.isArray(obj)) throw new PyError(`'${pyTypeName(obj)}' object is not sliceable`);
  const len = seq.length;
  const st = step ?? 1;
  if (st === 0) throw new PyError("slice step cannot be zero");
  let start = lo ?? (st > 0 ? 0 : len - 1);
  let stop = hi ?? (st > 0 ? len : -len - 1);
  if (start < 0) start = Math.max(st > 0 ? 0 : -1, len + start);
  if (stop < 0) stop = Math.max(st > 0 ? 0 : -1, len + stop);
  const out: unknown[] = [];
  if (st > 0) for (let i = start; i < stop && i < len; i += st) out.push(seq[i]);
  else for (let i = start; i > stop && i >= 0; i += st) out.push(seq[i]);
  return typeof obj === "string" ? out.join("") : out;
}

/** Assign `obj[index] = v`. */
export function setItem(obj: unknown, index: unknown, value: unknown): void {
  if (Array.isArray(obj)) {
    const i = normIndex(Number(index), obj.length);
    if (i < 0 || i >= obj.length) throw new PyError("list assignment index out of range");
    obj[i] = value;
    return;
  }
  if (isDict(obj)) {
    obj[typeof index === "string" ? index : pyStr(index)] = value;
    return;
  }
  throw new PyError(`'${pyTypeName(obj)}' object does not support item assignment`);
}

/** Call `obj.method(*args, **kwargs)`. */
export async function callMethod(
  obj: unknown,
  name: string,
  args: unknown[],
  kwargs: Record<string, unknown>,
  api: InterpApi,
): Promise<unknown> {
  if (forbidden(name)) throw new PyError(`access to '${name}' is not allowed.`);
  if (typeof obj === "string") return strMethod(obj, name, args);
  if (Array.isArray(obj)) return listMethod(obj, name, args, kwargs, api);
  if (isDict(obj)) return dictMethod(obj, name, args);
  if (obj instanceof Set) return setMethod(obj, name, args);
  throw new PyError(`'${pyTypeName(obj)}' object has no method '${name}'`);
}

function strMethod(s: string, name: string, args: unknown[]): unknown {
  const a0 = args[0] as string;
  switch (name) {
    case "upper": return s.toUpperCase();
    case "lower": return s.toLowerCase();
    case "strip": return a0 !== undefined ? trimChars(s, a0, true, true) : s.trim();
    case "lstrip": return a0 !== undefined ? trimChars(s, a0, true, false) : s.replace(/^\s+/, "");
    case "rstrip": return a0 !== undefined ? trimChars(s, a0, false, true) : s.replace(/\s+$/, "");
    case "split": return a0 === undefined ? s.split(/\s+/).filter(Boolean) : s.split(a0);
    case "rsplit": return a0 === undefined ? s.split(/\s+/).filter(Boolean) : s.split(a0);
    case "splitlines": return s.split(/\r?\n/);
    case "join": return (args[0] as unknown[]).map((x) => pyStr(x)).join(s);
    case "replace": return s.split(a0).join(args[1] as string);
    case "startswith": return s.startsWith(a0);
    case "endswith": return s.endsWith(a0);
    case "find": return s.indexOf(a0);
    case "rfind": return s.lastIndexOf(a0);
    case "index": { const i = s.indexOf(a0); if (i < 0) throw new PyError("substring not found"); return i; }
    case "count": return a0 === "" ? s.length + 1 : s.split(a0).length - 1;
    case "title": return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    case "capitalize": return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
    case "zfill": return s.padStart(Number(a0), "0");
    case "ljust": return s.padEnd(Number(a0), (args[1] as string) ?? " ");
    case "rjust": return s.padStart(Number(a0), (args[1] as string) ?? " ");
    case "removeprefix": return s.startsWith(a0) ? s.slice(a0.length) : s;
    case "removesuffix": return a0 && s.endsWith(a0) ? s.slice(0, -a0.length) : s;
    case "isdigit": return /^\d+$/.test(s);
    case "isalpha": return /^[A-Za-z]+$/.test(s);
    case "isalnum": return /^[A-Za-z0-9]+$/.test(s);
    case "isspace": return s.length > 0 && /^\s+$/.test(s);
    case "islower": return s === s.toLowerCase() && s !== s.toUpperCase();
    case "isupper": return s === s.toUpperCase() && s !== s.toLowerCase();
    case "format": return s; // format() unsupported — recommend f-strings
    default: throw new PyError(`str has no method '${name}'`);
  }
}

function trimChars(s: string, chars: string, left: boolean, right: boolean): string {
  const set = new Set(chars);
  let a = 0;
  let b = s.length;
  if (left) while (a < b && set.has(s[a])) a++;
  if (right) while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}

async function listMethod(
  arr: unknown[],
  name: string,
  args: unknown[],
  kwargs: Record<string, unknown>,
  api: InterpApi,
): Promise<unknown> {
  switch (name) {
    case "append": arr.push(args[0]); return null;
    case "extend": arr.push(...(args[0] as unknown[])); return null;
    case "pop": return args[0] === undefined ? arr.pop() : arr.splice(Number(args[0]), 1)[0];
    case "insert": arr.splice(Number(args[0]), 0, args[1]); return null;
    case "remove": { const i = arr.findIndex((x) => x === args[0]); if (i < 0) throw new PyError("list.remove(x): x not in list"); arr.splice(i, 1); return null; }
    case "index": { const i = arr.indexOf(args[0]); if (i < 0) throw new PyError("value not in list"); return i; }
    case "count": return arr.filter((x) => x === args[0]).length;
    case "reverse": arr.reverse(); return null;
    case "copy": return [...arr];
    case "clear": arr.length = 0; return null;
    case "sort": {
      const key = kwargs.key;
      const reverse = kwargs.reverse === true;
      await sortInPlace(arr, key, reverse, api);
      return null;
    }
    default: throw new PyError(`list has no method '${name}'`);
  }
}

async function sortInPlace(arr: unknown[], key: unknown, reverse: boolean, api: InterpApi): Promise<void> {
  const keyed: Array<{ v: unknown; k: unknown }> = [];
  for (const v of arr) {
    api.charge(1);
    keyed.push({ v, k: key && api.isCallable(key) ? await api.apply(key, [v]) : v });
  }
  keyed.sort((a, b) => cmp(a.k, b.k));
  if (reverse) keyed.reverse();
  for (let i = 0; i < arr.length; i++) arr[i] = keyed[i].v;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = pyStr(a);
  const bs = pyStr(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
export { cmp };

function dictMethod(d: Record<string, unknown>, name: string, args: unknown[]): unknown {
  switch (name) {
    case "get": return Object.hasOwn(d, args[0] as string) ? d[args[0] as string] : args[1] ?? null;
    case "keys": return Object.keys(d);
    case "values": return Object.values(d);
    case "items": return Object.entries(d).map(([k, v]) => tuple([k, v]));
    case "update": Object.assign(d, args[0]); return null;
    case "pop": { const k = args[0] as string; if (Object.hasOwn(d, k)) { const v = d[k]; delete d[k]; return v; } if (args.length > 1) return args[1]; throw new PyError(`KeyError: ${pyRepr(args[0])}`); }
    case "setdefault": { const k = args[0] as string; if (!Object.hasOwn(d, k)) d[k] = args[1] ?? null; return d[k]; }
    case "copy": return { ...d };
    case "clear": for (const k of Object.keys(d)) delete d[k]; return null;
    default: throw new PyError(`dict has no method '${name}'`);
  }
}

function setMethod(set: Set<unknown>, name: string, args: unknown[]): unknown {
  switch (name) {
    case "add": set.add(args[0]); return null;
    case "remove": if (!set.delete(args[0])) throw new PyError(`KeyError: ${pyRepr(args[0])}`); return null;
    case "discard": set.delete(args[0]); return null;
    case "union": return new Set([...set, ...(args[0] as Iterable<unknown>)]);
    case "intersection": { const o = new Set(args[0] as Iterable<unknown>); return new Set([...set].filter((x) => o.has(x))); }
    case "difference": { const o = new Set(args[0] as Iterable<unknown>); return new Set([...set].filter((x) => !o.has(x))); }
    case "issubset": { const o = new Set(args[0] as Iterable<unknown>); return [...set].every((x) => o.has(x)); }
    case "issuperset": { const o = new Set(args[0] as Iterable<unknown>); return [...o].every((x) => set.has(x)); }
    case "copy": return new Set(set);
    case "clear": set.clear(); return null;
    default: throw new PyError(`set has no method '${name}'`);
  }
}

// re-exports used by the interpreter's `in` operator, etc.
export { isTuple, PyRange };
