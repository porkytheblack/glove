/**
 * The sandbox boundary. Every `obj.prop` read and `obj.method(...)` call in a
 * program passes through here — this file decides what the model's code can
 * reach on a value. Get it wrong and a constructor-chain escape
 * (`[].constructor.constructor("return process")()`) hands the model the host.
 *
 * Rules, in order:
 *   1. A forbidden key (`constructor`, `__proto__`, `prototype`, `call`, …) is
 *      rejected on read AND call, on every value. This is the escape gate.
 *   2. Plain objects expose their OWN properties only — never a prototype walk.
 *   3. Strings / numbers / arrays / Set / Map / Date / RegExp get a fixed
 *      method allowlist. Non-callback methods delegate to intrinsics captured at
 *      module load; callback methods (map/filter/reduce/sort/…) are reimplemented
 *      async so an interpreter closure can be the callback, charging fuel per
 *      element.
 *   4. A missing member reads as `undefined` (JS semantics); CALLING a missing
 *      member throws a did-you-mean.
 *
 * Nothing here ever returns a live prototype, constructor, or bound host
 * function that isn't a pure data operation.
 */
import { JsError } from "./errors";
import { closest } from "glove-scratchpad/fns";
import { HostCtor } from "./host";

/** The interpreter surface the reimplemented methods need. Passed in to avoid a
 *  runtime import cycle (interp.ts imports this module). */
export interface InterpApi {
  /** Apply a callback (interpreter closure or native fn) to args. */
  apply(fn: unknown, args: unknown[]): Promise<unknown>;
  /** Is this value something {@link apply} can call? */
  isCallable(v: unknown): boolean;
  /** Charge N fuel units; throws when the budget is exhausted. */
  charge(n: number): void;
}

/** Keys that are never readable or callable — the escape gate. */
const FORBIDDEN = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "call",
  "apply",
  "bind",
  "caller",
  "arguments",
]);

// Intrinsics captured once at module load — the model has no path to these
// prototypes, so even if it could mutate a builtin it couldn't reach ours.
const StrProto = String.prototype;
const NumProto = Number.prototype;
const ArrProto = Array.prototype;

function callStr(name: string, recv: string, args: unknown[]): unknown {
  return (StrProto[name as keyof typeof StrProto] as (...a: unknown[]) => unknown).apply(recv, args);
}
function callNum(name: string, recv: number, args: unknown[]): unknown {
  return (NumProto[name as keyof typeof NumProto] as (...a: unknown[]) => unknown).apply(recv, args);
}
function callArr(name: string, recv: unknown[], args: unknown[]): unknown {
  return (ArrProto[name as keyof typeof ArrProto] as (...a: unknown[]) => unknown).apply(recv, args);
}

const STRING_METHODS = new Set([
  "at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes", "indexOf",
  "lastIndexOf", "normalize", "padStart", "padEnd", "repeat", "slice", "split", "startsWith",
  "substring", "substr", "toLowerCase", "toUpperCase", "toString", "trim", "trimStart", "trimEnd",
  "match", "matchAll", "search", "valueOf",
]);
const STRING_FN_REPLACERS = new Set(["replace", "replaceAll"]);

const NUMBER_METHODS = new Set(["toFixed", "toPrecision", "toString", "valueOf"]);

// Array methods that take a callback — reimplemented async below.
const ARRAY_CB_METHODS = new Set([
  "map", "filter", "forEach", "find", "findIndex", "findLast", "findLastIndex",
  "some", "every", "reduce", "reduceRight", "flatMap", "sort",
]);
// Array methods with no callback — delegate to the intrinsic.
const ARRAY_PLAIN_METHODS = new Set([
  "at", "concat", "fill", "flat", "includes", "indexOf", "join", "lastIndexOf", "pop", "push",
  "reverse", "shift", "slice", "splice", "unshift", "toString",
]);

const SET_METHODS = new Set(["has", "add", "delete", "clear", "values", "keys", "entries", "forEach"]);
const MAP_METHODS = new Set(["get", "set", "has", "delete", "clear", "values", "keys", "entries", "forEach"]);
const DATE_METHODS = new Set([
  "getTime", "valueOf", "toISOString", "toString", "toDateString", "toJSON",
  "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getSeconds", "getMilliseconds",
  "getUTCFullYear", "getUTCMonth", "getUTCDate", "getUTCHours",
]);
const REGEXP_METHODS = new Set(["test", "exec", "toString"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  if (v instanceof Set || v instanceof Map || v instanceof Date || v instanceof RegExp) return false;
  return true;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Set) return "Set";
  if (v instanceof Map) return "Map";
  if (v instanceof Date) return "Date";
  if (v instanceof RegExp) return "RegExp";
  return typeof v;
}

function assertKey(key: string): void {
  if (FORBIDDEN.has(key)) {
    throw new JsError(`access to '${key}' is not allowed.`);
  }
}

function assertObject(obj: unknown, key: string): void {
  if (obj === null || obj === undefined) {
    throw new JsError(`cannot read '${key}' of ${obj === null ? "null" : "undefined"}.`);
  }
}

/** Method names available on a value — for did-you-mean on a missing call. */
function methodNames(obj: unknown): string[] {
  if (typeof obj === "string") return [...STRING_METHODS, ...STRING_FN_REPLACERS, "length"];
  if (typeof obj === "number") return [...NUMBER_METHODS];
  if (Array.isArray(obj)) return [...ARRAY_CB_METHODS, ...ARRAY_PLAIN_METHODS, "length"];
  if (obj instanceof Set) return [...SET_METHODS, "size"];
  if (obj instanceof Map) return [...MAP_METHODS, "size"];
  if (obj instanceof Date) return [...DATE_METHODS];
  if (obj instanceof RegExp) return [...REGEXP_METHODS, "source", "flags", "global", "lastIndex"];
  if (isPlainObject(obj)) return Object.keys(obj);
  return [];
}

/** A non-callback data property, or `MISSING`. Never a method. */
const MISSING = Symbol("missing");

function readDataProp(obj: unknown, key: string): unknown | typeof MISSING {
  if (obj instanceof HostCtor) {
    return Object.hasOwn(obj.statics, key) ? obj.statics[key] : MISSING;
  }
  if (typeof obj === "function") {
    // Host namespace functions (Number, String, …) carry their statics as own
    // properties; forbidden keys are already blocked upstream.
    return Object.hasOwn(obj, key) ? (obj as unknown as Record<string, unknown>)[key] : MISSING;
  }
  if (typeof obj === "string") {
    if (key === "length") return obj.length;
    const i = asIndex(key);
    if (i !== null) return obj[i];
    return MISSING;
  }
  if (Array.isArray(obj)) {
    if (Object.hasOwn(obj, key)) return (obj as unknown as Record<string, unknown>)[key];
    return MISSING;
  }
  if (obj instanceof Set || obj instanceof Map) {
    if (key === "size") return obj.size;
    return MISSING;
  }
  if (obj instanceof RegExp) {
    if (key === "source") return obj.source;
    if (key === "flags") return obj.flags;
    if (key === "global") return obj.global;
    if (key === "lastIndex") return obj.lastIndex;
    return MISSING;
  }
  if (isPlainObject(obj)) {
    if (Object.hasOwn(obj, key)) return obj[key];
    return MISSING;
  }
  return MISSING;
}

function asIndex(key: string): number | null {
  if (!/^\d+$/.test(key)) return null;
  return Number(key);
}

/** Assign `obj[key] = val`, blocking the escape keys and frozen/opaque targets. */
export function setMember(obj: unknown, key: string, val: unknown): unknown {
  assertKey(key);
  assertObject(obj, key);
  if (Array.isArray(obj)) {
    (obj as unknown as Record<string, unknown>)[key] = val;
    return val;
  }
  if (isPlainObject(obj)) {
    if (Object.isFrozen(obj)) throw new JsError(`cannot assign '${key}' — this object is read-only.`);
    obj[key] = val;
    return val;
  }
  throw new JsError(`cannot set property '${key}' on ${typeName(obj)}.`);
}

/** Delete `obj[key]`, blocking the escape keys. */
export function deleteMember(obj: unknown, key: string): boolean {
  assertKey(key);
  assertObject(obj, key);
  if (Array.isArray(obj) || isPlainObject(obj)) {
    if (Object.isFrozen(obj as object)) throw new JsError(`cannot delete '${key}' — this object is read-only.`);
    return delete (obj as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Read a member for a MemberExpression that is NOT in call position. Returns a
 * data value, a bound async method (so `const f = arr.map; f(cb)` works), or
 * `undefined` for a missing member (JS read semantics).
 */
export function getMember(obj: unknown, key: string, api: InterpApi): unknown {
  assertKey(key);
  assertObject(obj, key);
  const data = readDataProp(obj, key);
  if (data !== MISSING) return data;
  if (hasMethod(obj, key)) {
    return (...args: unknown[]) => callMember(obj, key, args, api);
  }
  return undefined;
}

function hasMethod(obj: unknown, key: string): boolean {
  if (typeof obj === "string") return STRING_METHODS.has(key) || STRING_FN_REPLACERS.has(key);
  if (typeof obj === "number") return NUMBER_METHODS.has(key);
  if (Array.isArray(obj)) return ARRAY_CB_METHODS.has(key) || ARRAY_PLAIN_METHODS.has(key);
  if (obj instanceof Set) return SET_METHODS.has(key);
  if (obj instanceof Map) return MAP_METHODS.has(key);
  if (obj instanceof Date) return DATE_METHODS.has(key);
  if (obj instanceof RegExp) return REGEXP_METHODS.has(key);
  return false;
}

/** Call `obj.key(...args)`. The single dispatch the interpreter uses for a
 *  method call; throws a did-you-mean when the method doesn't exist. */
export async function callMember(
  obj: unknown,
  key: string,
  args: unknown[],
  api: InterpApi,
): Promise<unknown> {
  assertKey(key);
  assertObject(obj, key);

  // A callable own data property (a plain object holding a function/closure).
  const data = readDataProp(obj, key);
  if (data !== MISSING) {
    if (api.isCallable(data)) return api.apply(data, args);
    throw new JsError(`${typeName(obj)} property '${key}' is not a function.`);
  }

  if (typeof obj === "string") return callStringMethod(obj, key, args, api);
  if (typeof obj === "number") {
    if (NUMBER_METHODS.has(key)) return callNum(key, obj, args);
  }
  if (Array.isArray(obj)) return callArrayMethod(obj, key, args, api);
  if (obj instanceof Set) return callSetMethod(obj, key, args);
  if (obj instanceof Map) return callMapMethod(obj, key, args);
  if (obj instanceof Date) {
    if (DATE_METHODS.has(key)) {
      return (obj[key as keyof Date] as (...a: unknown[]) => unknown).apply(obj, args);
    }
  }
  if (obj instanceof RegExp) {
    if (REGEXP_METHODS.has(key)) {
      return (obj[key as keyof RegExp] as (...a: unknown[]) => unknown).apply(obj, args);
    }
  }

  const hint = closest(key, methodNames(obj));
  throw new JsError(
    `${typeName(obj)} has no method '${key}'${hint ? ` — did you mean '${hint}'?` : ""}.`,
  );
}

function callStringMethod(str: string, key: string, args: unknown[], api: InterpApi): unknown {
  if (STRING_FN_REPLACERS.has(key)) {
    if (api.isCallable(args[1])) {
      throw new JsError(
        `${key} with a function replacer is not supported — pass a string or a RegExp (with a string replacement).`,
      );
    }
    return callStr(key, str, args);
  }
  if (key === "matchAll") return [...str.matchAll(args[0] as RegExp)];
  if (STRING_METHODS.has(key)) return callStr(key, str, args);
  const hint = closest(key, methodNames(str));
  throw new JsError(`string has no method '${key}'${hint ? ` — did you mean '${hint}'?` : ""}.`);
}

async function callArrayMethod(
  arr: unknown[],
  key: string,
  args: unknown[],
  api: InterpApi,
): Promise<unknown> {
  if (ARRAY_PLAIN_METHODS.has(key)) return callArr(key, arr, args);
  if (!ARRAY_CB_METHODS.has(key)) {
    const hint = closest(key, methodNames(arr));
    throw new JsError(`array has no method '${key}'${hint ? ` — did you mean '${hint}'?` : ""}.`);
  }
  const cb = args[0];
  if (key !== "sort" && !api.isCallable(cb)) {
    throw new JsError(`array.${key} expects a function as its first argument.`);
  }
  const call = (el: unknown, i: number): Promise<unknown> => {
    api.charge(1);
    return api.apply(cb, [el, i, arr]);
  };
  switch (key) {
    case "map": {
      const out: unknown[] = [];
      for (let i = 0; i < arr.length; i++) out.push(await call(arr[i], i));
      return out;
    }
    case "flatMap": {
      const out: unknown[] = [];
      for (let i = 0; i < arr.length; i++) {
        const r = await call(arr[i], i);
        if (Array.isArray(r)) out.push(...r);
        else out.push(r);
      }
      return out;
    }
    case "filter": {
      const out: unknown[] = [];
      for (let i = 0; i < arr.length; i++) if (await call(arr[i], i)) out.push(arr[i]);
      return out;
    }
    case "forEach": {
      for (let i = 0; i < arr.length; i++) await call(arr[i], i);
      return undefined;
    }
    case "find": {
      for (let i = 0; i < arr.length; i++) if (await call(arr[i], i)) return arr[i];
      return undefined;
    }
    case "findIndex": {
      for (let i = 0; i < arr.length; i++) if (await call(arr[i], i)) return i;
      return -1;
    }
    case "findLast": {
      for (let i = arr.length - 1; i >= 0; i--) if (await call(arr[i], i)) return arr[i];
      return undefined;
    }
    case "findLastIndex": {
      for (let i = arr.length - 1; i >= 0; i--) if (await call(arr[i], i)) return i;
      return -1;
    }
    case "some": {
      for (let i = 0; i < arr.length; i++) if (await call(arr[i], i)) return true;
      return false;
    }
    case "every": {
      for (let i = 0; i < arr.length; i++) if (!(await call(arr[i], i))) return false;
      return true;
    }
    case "reduce":
      return reduceArray(arr, args, api, false);
    case "reduceRight":
      return reduceArray(arr, args, api, true);
    case "sort":
      return sortArray(arr, cb, api);
    default:
      /* unreachable */
      return undefined;
  }
}

async function reduceArray(
  arr: unknown[],
  args: unknown[],
  api: InterpApi,
  right: boolean,
): Promise<unknown> {
  const cb = args[0];
  const hasInit = args.length >= 2;
  const idx = right ? [...arr.keys()].reverse() : [...arr.keys()];
  let acc: unknown;
  let start = 0;
  if (hasInit) acc = args[1];
  else {
    if (idx.length === 0) throw new JsError("reduce of empty array with no initial value.");
    acc = arr[idx[0]];
    start = 1;
  }
  for (let k = start; k < idx.length; k++) {
    const i = idx[k];
    api.charge(1);
    acc = await api.apply(cb, [acc, arr[i], i, arr]);
  }
  return acc;
}

/** Async-comparator-aware stable merge sort. Returns a new sorted array (the
 *  interpreter surface treats sort as returning its result). */
async function sortArray(arr: unknown[], cb: unknown, api: InterpApi): Promise<unknown[]> {
  if (cb === undefined) return [...arr].sort();
  if (!api.isCallable(cb)) throw new JsError("array.sort expects a comparator function.");
  const cmp = async (a: unknown, b: unknown): Promise<number> => {
    api.charge(1);
    const r = await api.apply(cb, [a, b]);
    return typeof r === "number" ? r : Number(r) || 0;
  };
  const merge = async (l: unknown[], r: unknown[]): Promise<unknown[]> => {
    const out: unknown[] = [];
    let i = 0;
    let j = 0;
    while (i < l.length && j < r.length) {
      if ((await cmp(l[i], r[j])) <= 0) out.push(l[i++]);
      else out.push(r[j++]);
    }
    while (i < l.length) out.push(l[i++]);
    while (j < r.length) out.push(r[j++]);
    return out;
  };
  const sort = async (xs: unknown[]): Promise<unknown[]> => {
    if (xs.length <= 1) return xs;
    const mid = xs.length >> 1;
    return merge(await sort(xs.slice(0, mid)), await sort(xs.slice(mid)));
  };
  return sort([...arr]);
}

function callSetMethod(set: Set<unknown>, key: string, args: unknown[]): unknown {
  switch (key) {
    case "has": return set.has(args[0]);
    case "add": return set.add(args[0]);
    case "delete": return set.delete(args[0]);
    case "clear": set.clear(); return undefined;
    case "values":
    case "keys": return [...set.values()];
    case "entries": return [...set.entries()];
    case "forEach": return undefined; // callback form intentionally omitted — use for…of
    default: throw new JsError(`Set has no method '${key}'.`);
  }
}

function callMapMethod(map: Map<unknown, unknown>, key: string, args: unknown[]): unknown {
  switch (key) {
    case "get": return map.get(args[0]);
    case "set": return map.set(args[0], args[1]);
    case "has": return map.has(args[0]);
    case "delete": return map.delete(args[0]);
    case "clear": map.clear(); return undefined;
    case "keys": return [...map.keys()];
    case "values": return [...map.values()];
    case "entries": return [...map.entries()];
    case "forEach": return undefined;
    default: throw new JsError(`Map has no method '${key}'.`);
  }
}
