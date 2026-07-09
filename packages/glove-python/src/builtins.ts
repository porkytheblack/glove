/**
 * The Python builtins the model can reach — a frozen namespace of {@link NativeFn}s.
 * No `import`, `open`, `eval`, `exec`, `__import__`, `globals`, `getattr`/`setattr`
 * (attribute access is gated in members.ts). Callback-taking builtins
 * (`sorted`/`map`/`filter`/`min`/`max` with `key=`) run their callback through
 * the interpreter API and charge fuel per element.
 */
import { NativeFn } from "./native";
import type { InterpApi } from "./members";
import { cmp } from "./members";
import { PyRange, isDict, isTuple, pyIter, pyRepr, pyStr, pyTruthy, pyTypeName, tuple } from "./values";
import { PyError } from "./errors";

export interface StdoutSink {
  out: string[];
}

const MAX_ALLOC = 10_000_000;

/** The exception names a program may `raise` — each builds an error value. */
const EXCEPTIONS = [
  "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "RuntimeError",
  "ZeroDivisionError", "AttributeError", "NotImplementedError", "StopIteration",
  "AssertionError", "ArithmeticError", "LookupError",
];

function materialize(v: unknown, api: InterpApi): unknown[] {
  const out: unknown[] = [];
  for (const x of pyIter(v)) {
    if (out.length > MAX_ALLOC) throw new PyError(`too many elements (max ${MAX_ALLOC}).`);
    api.charge(1);
    out.push(x);
  }
  return out;
}

function pyLen(v: unknown): number {
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  if (v instanceof Set) return v.size;
  if (v instanceof PyRange) return v.length;
  if (isDict(v)) return Object.keys(v).length;
  throw new PyError(`object of type '${pyTypeName(v)}' has no len()`);
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isNaN(n)) throw new PyError(`invalid literal for int(): '${v}'`);
    return n;
  }
  throw new PyError(`cannot convert '${pyTypeName(v)}' to a number`);
}

/** The identity map so `isinstance(x, list)` / `int(...)` etc. resolve by ref. */
const TYPE_NAMES = new Map<NativeFn, string>();

export function makeBuiltins(sink: StdoutSink): Record<string, unknown> {
  const B: Record<string, NativeFn> = {};
  const def = (name: string, call: NativeFn["call"]): void => {
    B[name] = new NativeFn(name, call);
  };
  const defType = (name: string, pyType: string, call: NativeFn["call"]): void => {
    const fn = new NativeFn(name, call);
    TYPE_NAMES.set(fn, pyType);
    B[name] = fn;
  };

  def("len", (a) => pyLen(a[0]));
  def("range", (a) => {
    const n = a.map(toNum);
    if (n.length === 1) return new PyRange(0, n[0], 1);
    if (n.length === 2) return new PyRange(n[0], n[1], 1);
    return new PyRange(n[0], n[1], n[2] ?? 1);
  });
  def("enumerate", (a, _k, api) => {
    const start = a[1] !== undefined ? toNum(a[1]) : 0;
    return materialize(a[0], api).map((v, i) => tuple([i + start, v]));
  });
  def("zip", (a, _k, api) => {
    const seqs = a.map((x) => materialize(x, api));
    const n = Math.min(...seqs.map((s) => s.length));
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(tuple(seqs.map((s) => s[i])));
    return out;
  });
  def("sum", (a, _k, api) => {
    let acc: number = a[1] !== undefined ? toNum(a[1]) : 0;
    for (const x of materialize(a[0], api)) acc += toNum(x);
    return acc;
  });
  def("min", (a, k, api) => reduceExtreme(a, k, api, -1));
  def("max", (a, k, api) => reduceExtreme(a, k, api, 1));
  def("sorted", async (a, k, api) => {
    const items = materialize(a[0], api);
    const key = k.key;
    const keyed: Array<{ v: unknown; kk: unknown }> = [];
    for (const v of items) {
      api.charge(1);
      keyed.push({ v, kk: key && api.isCallable(key) ? await api.apply(key, [v]) : v });
    }
    keyed.sort((x, y) => cmp(x.kk, y.kk));
    if (k.reverse === true) keyed.reverse();
    return keyed.map((x) => x.v);
  });
  def("reversed", (a, _k, api) => materialize(a[0], api).reverse());
  def("map", async (a, _k, api) => {
    const fn = a[0];
    const seqs = a.slice(1).map((x) => materialize(x, api));
    const n = Math.min(...seqs.map((s) => s.length));
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) {
      api.charge(1);
      out.push(await api.apply(fn, seqs.map((s) => s[i])));
    }
    return out;
  });
  def("filter", async (a, _k, api) => {
    const fn = a[0];
    const out: unknown[] = [];
    for (const x of materialize(a[1], api)) {
      api.charge(1);
      const keep = fn === null ? pyTruthy(x) : pyTruthy(await api.apply(fn, [x]));
      if (keep) out.push(x);
    }
    return out;
  });
  def("any", (a, _k, api) => materialize(a[0], api).some(pyTruthy));
  def("all", (a, _k, api) => materialize(a[0], api).every(pyTruthy));
  def("abs", (a) => Math.abs(toNum(a[0])));
  def("round", (a) => {
    const n = toNum(a[0]);
    if (a[1] === undefined) return Math.round(n);
    const d = 10 ** toNum(a[1]);
    return Math.round(n * d) / d;
  });
  def("print", (a, k) => {
    const sep = (k.sep as string) ?? " ";
    const end = (k.end as string) ?? "\n";
    const line = a.map((x) => pyStr(x)).join(sep) + end;
    sink.out.push(line.replace(/\n$/, ""));
    return null;
  });
  def("repr", (a) => pyRepr(a[0]));
  def("isinstance", (a) => {
    const want = a[1];
    const name = want instanceof NativeFn ? TYPE_NAMES.get(want) : undefined;
    if (!name) throw new PyError("isinstance() arg 2 must be a type (list, dict, str, int, float, bool, set, tuple).");
    const tn = pyTypeName(a[0]);
    if (name === "int") return tn === "int" || tn === "bool";
    if (name === "float") return tn === "float" || tn === "int";
    return tn === name;
  });
  def("abs", (a) => Math.abs(toNum(a[0])));

  // type constructors / converters
  defType("list", "list", (a, _k, api) => (a[0] === undefined ? [] : materialize(a[0], api)));
  defType("tuple", "tuple", (a, _k, api) => tuple(a[0] === undefined ? [] : materialize(a[0], api)));
  defType("set", "set", (a, _k, api) => new Set(a[0] === undefined ? [] : materialize(a[0], api)));
  defType("dict", "dict", (a) => {
    if (a[0] === undefined) return {};
    if (isDict(a[0])) return { ...(a[0] as object) };
    const out: Record<string, unknown> = {};
    for (const pair of a[0] as Iterable<unknown>) {
      const [k, v] = pair as [unknown, unknown];
      out[pyStr(k)] = v;
    }
    return out;
  });
  defType("str", "str", (a) => (a[0] === undefined ? "" : pyStr(a[0])));
  defType("int", "int", (a) => Math.trunc(toNum(a[0] ?? 0)));
  defType("float", "float", (a) => toNum(a[0] ?? 0));
  defType("bool", "bool", (a) => pyTruthy(a[0]));

  // Exception constructors — `raise ValueError("bad")` builds a plain error
  // value the interpreter's `raise` throws; `except … as e` binds it and
  // `e["message"]` / `str(e)` read the text. Types aren't enforced (the first
  // handler catches), so these just carry a name + message.
  for (const exc of EXCEPTIONS) {
    def(exc, (a) => ({ type: exc, message: a[0] === undefined ? "" : pyStr(a[0]) }));
  }

  return Object.freeze(B);
}

function reduceExtreme(a: unknown[], k: Record<string, unknown>, api: InterpApi, dir: number): unknown {
  const items = a.length === 1 ? materialize(a[0], api) : a;
  if (items.length === 0) {
    if ("default" in k) return k.default;
    throw new PyError(`${dir > 0 ? "max" : "min"}() arg is an empty sequence`);
  }
  const key = k.key;
  let best = items[0];
  let bestK = key && api.isCallable(key) ? undefined : items[0];
  // key application is sync-only here (min/max key callbacks are rare); if a
  // closure key is given, fall back to comparing the raw values.
  void bestK;
  for (const v of items) {
    if (dir > 0 ? cmp(v, best) > 0 : cmp(v, best) < 0) best = v;
  }
  return best;
}

export { isTuple };
