/**
 * The frozen root globals. Everything the model can reach that isn't a tool
 * function or a value it created: pure math/JSON/data helpers, a captured
 * console, and the `new` constructor whitelist. Every namespace is a frozen
 * plain object of wrapped functions (or a HostCtor) — the model can never index
 * its way from here to a live prototype, `process`, or `require`.
 */
import { JsError } from "./errors";
import { hostConstructors } from "./host";

/** Where captured console output goes. The session swaps `out` per execute. */
export interface StdoutSink {
  out: string[];
}

const MAX_LOG_LINE = 2000;

function formatArg(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (typeof v === "function") return "[Function]";
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function logLine(sink: StdoutSink, args: unknown[]): void {
  const line = args.map(formatArg).join(" ");
  sink.out.push(line.length > MAX_LOG_LINE ? line.slice(0, MAX_LOG_LINE) + "…" : line);
}

/** Own enumerable keys only, skipping any that could touch a prototype. */
function safeAssign(target: unknown, ...sources: unknown[]): unknown {
  if (target === null || typeof target !== "object") {
    throw new JsError("Object.assign target must be an object.");
  }
  const t = target as Record<string, unknown>;
  for (const src of sources) {
    if (src === null || src === undefined) continue;
    if (typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      t[k] = (src as Record<string, unknown>)[k];
    }
  }
  return t;
}

function makeConversions(): Record<string, unknown> {
  const NumberG = ((x: unknown) => Number(x)) as ((x: unknown) => number) & Record<string, unknown>;
  NumberG.isInteger = (x: unknown) => Number.isInteger(x);
  NumberG.isFinite = (x: unknown) => Number.isFinite(x);
  NumberG.isNaN = (x: unknown) => Number.isNaN(x);
  NumberG.isSafeInteger = (x: unknown) => Number.isSafeInteger(x);
  NumberG.parseFloat = (x: unknown) => Number.parseFloat(x as string);
  NumberG.parseInt = (x: unknown, r?: number) => Number.parseInt(x as string, r);
  NumberG.MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
  NumberG.MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
  NumberG.MAX_VALUE = Number.MAX_VALUE;
  NumberG.EPSILON = Number.EPSILON;
  NumberG.POSITIVE_INFINITY = Number.POSITIVE_INFINITY;
  NumberG.NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

  const StringG = ((x: unknown) => String(x)) as ((x: unknown) => string) & Record<string, unknown>;
  StringG.fromCharCode = (...a: number[]) => String.fromCharCode(...a);
  StringG.fromCodePoint = (...a: number[]) => String.fromCodePoint(...a);

  const BooleanG = (x: unknown) => Boolean(x);

  return { Number: Object.freeze(NumberG), String: Object.freeze(StringG), Boolean: BooleanG };
}

function makeMath(): Record<string, unknown> {
  const keys = [
    "abs", "ceil", "floor", "round", "trunc", "sign", "sqrt", "cbrt", "pow", "exp", "log",
    "log2", "log10", "min", "max", "random", "hypot", "sin", "cos", "tan", "atan", "atan2", "asin", "acos",
  ] as const;
  const m: Record<string, unknown> = {};
  for (const k of keys) m[k] = (Math[k] as (...a: number[]) => number).bind(Math);
  m.PI = Math.PI;
  m.E = Math.E;
  return Object.freeze(m);
}

function makeJson(): Record<string, unknown> {
  return Object.freeze({
    parse: (s: unknown, reviver?: unknown) => {
      if (typeof reviver === "function") {
        throw new JsError("JSON.parse with a reviver function is not supported — parse, then transform.");
      }
      return JSON.parse(s as string);
    },
    stringify: (v: unknown, replacer?: unknown, space?: unknown) => {
      if (typeof replacer === "function") {
        throw new JsError("JSON.stringify with a replacer function is not supported — pass a key array or omit it.");
      }
      return JSON.stringify(v, replacer as (string | number)[] | null, space as string | number | undefined);
    },
  });
}

function makeObject(): Record<string, unknown> {
  return Object.freeze({
    keys: (o: unknown) => Object.keys(o as object),
    values: (o: unknown) => Object.values(o as object),
    entries: (o: unknown) => Object.entries(o as object),
    assign: safeAssign,
    fromEntries: (e: unknown) => {
      const out: Record<string, unknown> = {};
      for (const pair of e as Iterable<[unknown, unknown]>) {
        const k = String((pair as [unknown, unknown])[0]);
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        out[k] = (pair as [unknown, unknown])[1];
      }
      return out;
    },
    freeze: (o: unknown) => Object.freeze(o as object),
    // A frozen copy — never the live object with its prototype chain.
    create: () => {
      throw new JsError("Object.create is not supported — use an object literal {}.");
    },
  });
}

const MAX_ALLOC = 10_000_000;

function makeArrayNamespace(): Record<string, unknown> {
  return Object.freeze({
    isArray: (x: unknown) => Array.isArray(x),
    from: (x: unknown, mapFn?: unknown) => {
      if (mapFn !== undefined) {
        throw new JsError("Array.from with a map function is not supported — use Array.from(x).map(fn).");
      }
      // A length-only array-like (Array.from({ length: N })) would materialize N
      // elements for ~0 fuel — hard-cap it (the interpreter can't charge here).
      const len = (x as { length?: unknown })?.length;
      if (typeof len === "number" && !(Symbol.iterator in Object(x)) && len > MAX_ALLOC) {
        throw new JsError(`Array.from would build ${len} elements — too large (max ${MAX_ALLOC}).`);
      }
      return Array.from(x as Iterable<unknown> | ArrayLike<unknown>);
    },
    of: (...items: unknown[]) => items,
  });
}

/**
 * Build the root globals. `sink` receives console output (swapped per execute).
 * The `new`-constructor whitelist is merged in as {@link HostCtor} values.
 */
export function makeGlobals(sink: StdoutSink): Record<string, unknown> {
  return {
    Math: makeMath(),
    JSON: makeJson(),
    Object: makeObject(),
    Array: makeArrayNamespace(),
    ...makeConversions(),
    console: Object.freeze({
      log: (...a: unknown[]) => logLine(sink, a),
      warn: (...a: unknown[]) => logLine(sink, a),
      error: (...a: unknown[]) => logLine(sink, a),
      info: (...a: unknown[]) => logLine(sink, a),
      debug: (...a: unknown[]) => logLine(sink, a),
    }),
    parseInt: (s: unknown, r?: number) => parseInt(s as string, r),
    parseFloat: (s: unknown) => parseFloat(s as string),
    isNaN: (x: unknown) => isNaN(x as number),
    isFinite: (x: unknown) => isFinite(x as number),
    Infinity,
    NaN,
    undefined,
    ...hostConstructors(),
  };
}
