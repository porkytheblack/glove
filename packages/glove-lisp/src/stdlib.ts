/**
 * The pure standard library — the Clojure a model reaches for when it thinks
 * "data manipulation": map/filter/reduce, group-by/frequencies, sort-by,
 * max-key, get-in/assoc/merge, string helpers. Everything here is pure; all
 * effects live behind resource functions and `insert!`/`update!`/`delete!`
 * (session.ts).
 *
 * Two deliberate mercies over strict Clojure, both in the "silently right"
 * direction (see values.ts on why silent WRONG answers are the enemy):
 *   - `contains?` on a list checks membership (Clojure checks indices — a
 *     famous footgun that would read as a silent wrong answer here).
 *   - string functions are also registered under their `str/…` and
 *     `clojure.string/…` names, because that is how models spell them.
 *
 * Bulk operations charge fuel proportional to collection size, so the fuel
 * budget bounds real work, not just form count.
 */
import { apply, chargeFuel, EvalCtx, LispError, NativeFn } from "./eval";
import { asKey, eq, isPlainObject, Keyword, printForm, truthy } from "./values";

type Args = unknown[];

function num(v: unknown, fn: string): number {
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new LispError(`${fn}: expected a number, got ${printForm(v)}`);
  }
  return v;
}

function coll(v: unknown, fn: string): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  if (isPlainObject(v)) return Object.entries(v).map(([k, val]) => [k, val]);
  throw new LispError(`${fn}: expected a list, got ${printForm(v)} — wrap single values in [ … ]`);
}

function stringOf(v: unknown, fn: string): string {
  if (typeof v === "string") return v;
  if (v instanceof Keyword) return v.name;
  throw new LispError(`${fn}: expected a string, got ${printForm(v)}`);
}

/** Render a value for `str` / `println`: strings bare, everything else printed. */
function toDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (v instanceof Keyword) return v.name;
  return printForm(v);
}

function groupKey(v: unknown): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return v;
  if (v instanceof Keyword) return v.name;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return printForm(v);
}

function compareVals(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = groupKey(a);
  const sb = groupKey(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function arity(args: Args, fn: string, min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const want = min === max ? String(min) : `${min}–${max}`;
    throw new LispError(`${fn} takes ${want} argument(s), got ${args.length}`);
  }
}

async function callPred(f: unknown, el: unknown, ctx: EvalCtx): Promise<boolean> {
  return truthy(await apply(f, [el], ctx));
}

/** Every builtin, keyed by symbol name. */
export function stdlib(): Map<string, NativeFn> {
  const fns = new Map<string, NativeFn>();
  const def = (name: string, fn: (args: Args, ctx: EvalCtx) => unknown | Promise<unknown>, usage?: string) => {
    fns.set(name, new NativeFn(name, fn, usage));
  };

  // ── arithmetic / comparison ────────────────────────────────────────────────
  def("+", (a) => a.reduce<number>((s, v) => s + num(v, "+"), 0));
  def("*", (a) => a.reduce<number>((s, v) => s * num(v, "*"), 1));
  def("-", (a) => {
    if (a.length === 0) throw new LispError("- needs at least one argument");
    if (a.length === 1) return -num(a[0], "-");
    return a.slice(1).reduce<number>((s, v) => s - num(v, "-"), num(a[0], "-"));
  });
  def("/", (a) => {
    if (a.length < 2) throw new LispError("/ needs at least two arguments");
    return a.slice(1).reduce<number>((s, v) => {
      const d = num(v, "/");
      if (d === 0) throw new LispError("division by zero");
      return s / d;
    }, num(a[0], "/"));
  });
  def("mod", (a) => (arity(a, "mod", 2), num(a[0], "mod") % num(a[1], "mod")));
  def("inc", (a) => (arity(a, "inc", 1), num(a[0], "inc") + 1));
  def("dec", (a) => (arity(a, "dec", 1), num(a[0], "dec") - 1));
  def("abs", (a) => (arity(a, "abs", 1), Math.abs(num(a[0], "abs"))));
  def("round", (a) => (arity(a, "round", 1), Math.round(num(a[0], "round"))));
  def("floor", (a) => (arity(a, "floor", 1), Math.floor(num(a[0], "floor"))));
  def("ceil", (a) => (arity(a, "ceil", 1), Math.ceil(num(a[0], "ceil"))));
  def("max", (a) => {
    if (a.length === 0) throw new LispError("max needs at least one argument — for a list use (apply max the-list) or (max-key f the-list)");
    return a.map((v) => num(v, "max")).reduce((x, y) => Math.max(x, y));
  });
  def("min", (a) => {
    if (a.length === 0) throw new LispError("min needs at least one argument — for a list use (apply min the-list)");
    return a.map((v) => num(v, "min")).reduce((x, y) => Math.min(x, y));
  });

  const cmp = (name: string, ok: (d: number) => boolean) =>
    def(name, (a) => {
      if (a.length < 2) throw new LispError(`${name} needs at least two arguments`);
      for (let i = 1; i < a.length; i++) {
        if (!ok(compareVals(a[i - 1], a[i]))) return false;
      }
      return true;
    });
  cmp("<", (d) => d < 0);
  cmp("<=", (d) => d <= 0);
  cmp(">", (d) => d > 0);
  cmp(">=", (d) => d >= 0);

  def("=", (a) => {
    if (a.length < 2) throw new LispError("= needs at least two arguments");
    for (let i = 1; i < a.length; i++) if (!eq(a[0], a[i])) return false;
    return true;
  });
  def("not=", (a) => {
    if (a.length < 2) throw new LispError("not= needs at least two arguments");
    for (let i = 1; i < a.length; i++) if (!eq(a[0], a[i])) return true;
    return false;
  });
  def("not", (a) => (arity(a, "not", 1), !truthy(a[0])));
  def("nil?", (a) => (arity(a, "nil?", 1), a[0] === null || a[0] === undefined));
  def("some?", (a) => (arity(a, "some?", 1), a[0] !== null && a[0] !== undefined));
  def("boolean", (a) => (arity(a, "boolean", 1), truthy(a[0])));
  def("identity", (a) => (arity(a, "identity", 1), a[0]));

  // ── sequences ─────────────────────────────────────────────────────────────
  def("count", (a) => {
    arity(a, "count", 1);
    const v = a[0];
    if (v === null || v === undefined) return 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string") return v.length;
    if (isPlainObject(v)) return Object.keys(v).length;
    throw new LispError(`count: expected a list, string, or map, got ${printForm(v)}`);
  });
  def("first", (a) => (arity(a, "first", 1), coll(a[0], "first")[0] ?? null));
  def("last", (a) => {
    arity(a, "last", 1);
    const c = coll(a[0], "last");
    return c.length ? c[c.length - 1] : null;
  });
  def("rest", (a) => (arity(a, "rest", 1), coll(a[0], "rest").slice(1)));
  def("nth", (a) => {
    arity(a, "nth", 2, 3);
    const c = coll(a[0], "nth");
    const i = num(a[1], "nth");
    if (i < 0 || i >= c.length) {
      if (a.length === 3) return a[2];
      throw new LispError(`nth: index ${i} out of bounds for a list of ${c.length}`);
    }
    return c[i];
  });
  def("take", (a) => (arity(a, "take", 2), coll(a[1], "take").slice(0, Math.max(0, num(a[0], "take")))), "(take n coll)");
  def("drop", (a) => (arity(a, "drop", 2), coll(a[1], "drop").slice(Math.max(0, num(a[0], "drop")))), "(drop n coll)");
  def("reverse", (a) => (arity(a, "reverse", 1), [...coll(a[0], "reverse")].reverse()));
  def("concat", (a) => a.flatMap((v) => coll(v, "concat")));
  def("flatten", (a) => {
    arity(a, "flatten", 1);
    const out: unknown[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else out.push(v);
    };
    walk(coll(a[0], "flatten"));
    return out;
  });
  def("range", (a) => {
    arity(a, "range", 1, 2);
    const [from, to] = a.length === 2 ? [num(a[0], "range"), num(a[1], "range")] : [0, num(a[0], "range")];
    const n = Math.max(0, Math.floor(to - from));
    if (n > 100_000) throw new LispError(`range: ${n} elements is too many (max 100000)`);
    return Array.from({ length: n }, (_, i) => from + i);
  });
  def("empty?", (a) => {
    arity(a, "empty?", 1);
    const v = a[0];
    if (v === null || v === undefined) return true;
    if (Array.isArray(v) || typeof v === "string") return v.length === 0;
    if (isPlainObject(v)) return Object.keys(v).length === 0;
    return false;
  });
  def("not-empty", async (a, ctx) => {
    arity(a, "not-empty", 1);
    const isEmpty = truthy(await apply(fns.get("empty?")!, [a[0]], ctx));
    return isEmpty ? null : a[0];
  });

  def(
    "map",
    async (a, ctx) => {
      arity(a, "map", 2, 3);
      if (a.length === 2) {
        const c = coll(a[1], "map");
        chargeFuel(ctx, c.length);
        const out: unknown[] = [];
        for (const el of c) out.push(await apply(a[0], [el], ctx));
        return out;
      }
      const c1 = coll(a[1], "map");
      const c2 = coll(a[2], "map");
      const n = Math.min(c1.length, c2.length);
      chargeFuel(ctx, n);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(await apply(a[0], [c1[i], c2[i]], ctx));
      return out;
    },
    "(map f coll)",
  );
  def(
    "mapcat",
    async (a, ctx) => {
      arity(a, "mapcat", 2);
      const c = coll(a[1], "mapcat");
      chargeFuel(ctx, c.length);
      const out: unknown[] = [];
      for (const el of c) out.push(...coll(await apply(a[0], [el], ctx), "mapcat"));
      return out;
    },
    "(mapcat f coll)",
  );
  def(
    "filter",
    async (a, ctx) => {
      arity(a, "filter", 2);
      const c = coll(a[1], "filter");
      chargeFuel(ctx, c.length);
      const out: unknown[] = [];
      for (const el of c) if (await callPred(a[0], el, ctx)) out.push(el);
      return out;
    },
    "(filter pred coll)",
  );
  def(
    "remove",
    async (a, ctx) => {
      arity(a, "remove", 2);
      const c = coll(a[1], "remove");
      chargeFuel(ctx, c.length);
      const out: unknown[] = [];
      for (const el of c) if (!(await callPred(a[0], el, ctx))) out.push(el);
      return out;
    },
    "(remove pred coll)",
  );
  def(
    "reduce",
    async (a, ctx) => {
      arity(a, "reduce", 2, 3);
      const c = coll(a[a.length - 1], "reduce");
      chargeFuel(ctx, c.length);
      let acc: unknown;
      let start = 0;
      if (a.length === 3) acc = a[1];
      else {
        if (c.length === 0) throw new LispError("reduce over an empty list needs an initial value — (reduce f init coll)");
        acc = c[0];
        start = 1;
      }
      for (let i = start; i < c.length; i++) acc = await apply(a[0], [acc, c[i]], ctx);
      return acc;
    },
    "(reduce f init coll)",
  );
  def(
    "some",
    async (a, ctx) => {
      arity(a, "some", 2);
      const c = coll(a[1], "some");
      chargeFuel(ctx, c.length);
      for (const el of c) {
        const r = await apply(a[0], [el], ctx);
        if (truthy(r)) return r;
      }
      return null;
    },
    "(some pred coll)",
  );
  def(
    "every?",
    async (a, ctx) => {
      arity(a, "every?", 2);
      const c = coll(a[1], "every?");
      chargeFuel(ctx, c.length);
      for (const el of c) if (!(await callPred(a[0], el, ctx))) return false;
      return true;
    },
    "(every? pred coll)",
  );
  def(
    "take-while",
    async (a, ctx) => {
      arity(a, "take-while", 2);
      const c = coll(a[1], "take-while");
      const out: unknown[] = [];
      for (const el of c) {
        if (!(await callPred(a[0], el, ctx))) break;
        out.push(el);
      }
      return out;
    },
    "(take-while pred coll)",
  );
  def(
    "drop-while",
    async (a, ctx) => {
      arity(a, "drop-while", 2);
      const c = coll(a[1], "drop-while");
      let i = 0;
      while (i < c.length && (await callPred(a[0], c[i], ctx))) i++;
      return c.slice(i);
    },
    "(drop-while pred coll)",
  );

  def("sort", async (a, ctx) => {
    arity(a, "sort", 1, 2);
    const c = [...coll(a[a.length - 1], "sort")];
    chargeFuel(ctx, c.length);
    if (a.length === 1) return c.sort(compareVals);
    // A custom comparator can be an async Lambda, so sort by async binary
    // insertion; cap the size to keep the O(n log n) comparator calls bounded.
    const f = a[0];
    if (c.length > 2000) throw new LispError("sort with a custom comparator is limited to 2000 items — use sort-by with a key function instead");
    const out: unknown[] = [];
    for (const el of c) {
      let lo = 0;
      let hi = out.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = await apply(f, [el, out[mid]], ctx);
        if (typeof r !== "number") throw new LispError("sort: the comparator must return a number (negative/zero/positive)");
        if (r < 0) hi = mid;
        else lo = mid + 1;
      }
      out.splice(lo, 0, el);
    }
    return out;
  });
  def(
    "sort-by",
    async (a, ctx) => {
      arity(a, "sort-by", 2, 3);
      const c = coll(a[a.length - 1], "sort-by");
      chargeFuel(ctx, c.length);
      const keyed: Array<[unknown, unknown]> = [];
      for (const el of c) keyed.push([await apply(a[0], [el], ctx), el]);
      const desc = a.length === 3 && (a[1] === Keyword.for("desc") || a[1] === "desc");
      keyed.sort((x, y) => compareVals(x[0], y[0]) * (desc ? -1 : 1));
      return keyed.map(([, el]) => el);
    },
    "(sort-by keyfn coll) or (sort-by keyfn :desc coll)",
  );
  def("distinct", (a, ctx) => {
    arity(a, "distinct", 1);
    const c = coll(a[0], "distinct");
    chargeFuel(ctx, c.length);
    const out: unknown[] = [];
    for (const el of c) if (!out.some((x) => eq(x, el))) out.push(el);
    return out;
  });
  def(
    "group-by",
    async (a, ctx) => {
      arity(a, "group-by", 2);
      const c = coll(a[1], "group-by");
      chargeFuel(ctx, c.length);
      const out: Record<string, unknown[]> = {};
      for (const el of c) {
        const k = groupKey(await apply(a[0], [el], ctx));
        (out[k] ??= []).push(el);
      }
      return out;
    },
    "(group-by keyfn coll)",
  );
  def(
    "frequencies",
    async (a, ctx) => {
      arity(a, "frequencies", 1, 2);
      // (frequencies coll) or (frequencies keyfn coll) — the latter is the
      // "count per group" idiom models want for GROUP BY-style questions.
      const c = coll(a[a.length - 1], "frequencies");
      chargeFuel(ctx, c.length);
      const out: Record<string, number> = {};
      for (const el of c) {
        const k = groupKey(a.length === 2 ? await apply(a[0], [el], ctx) : el);
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    },
    "(frequencies coll) or (frequencies keyfn coll)",
  );
  const byKey = (name: string, better: (d: number) => boolean) =>
    def(
      name,
      async (a, ctx) => {
        arity(a, name, 2);
        const c = coll(a[1], name);
        chargeFuel(ctx, c.length);
        if (c.length === 0) return null;
        let best = c[0];
        let bestK = await apply(a[0], [c[0]], ctx);
        for (const el of c.slice(1)) {
          const k = await apply(a[0], [el], ctx);
          if (better(compareVals(k, bestK))) {
            best = el;
            bestK = k;
          }
        }
        return best;
      },
      `(${name} keyfn coll) — the element with the ${name.startsWith("max") ? "largest" : "smallest"} key`,
    );
  byKey("max-key", (d) => d > 0);
  byKey("min-key", (d) => d < 0);
  fns.set("max-by", new NativeFn("max-by", fns.get("max-key")!.fn, fns.get("max-key")!.usage));
  fns.set("min-by", new NativeFn("min-by", fns.get("min-key")!.fn, fns.get("min-key")!.usage));

  def("sum", (a, ctx) => {
    arity(a, "sum", 1);
    const c = coll(a[0], "sum");
    chargeFuel(ctx, c.length);
    return c.reduce<number>((s, v) => s + num(v, "sum"), 0);
  });
  def("avg", (a, ctx) => {
    arity(a, "avg", 1);
    const c = coll(a[0], "avg");
    chargeFuel(ctx, c.length);
    if (c.length === 0) return null;
    return c.reduce<number>((s, v) => s + num(v, "avg"), 0) / c.length;
  });
  def("contains?", (a) => {
    arity(a, "contains?", 2);
    const [c, v] = a;
    if (Array.isArray(c)) return c.some((x) => eq(x, v));
    if (typeof c === "string") return c.includes(stringOf(v, "contains?"));
    if (isPlainObject(c)) return Object.prototype.hasOwnProperty.call(c, asKey(v));
    return false;
  });
  def("zipmap", (a) => {
    arity(a, "zipmap", 2);
    const ks = coll(a[0], "zipmap");
    const vs = coll(a[1], "zipmap");
    const out: Record<string, unknown> = {};
    for (let i = 0; i < Math.min(ks.length, vs.length); i++) out[asKey(ks[i])] = vs[i];
    return out;
  });
  def("apply", async (a, ctx) => {
    if (a.length < 2) throw new LispError("apply takes (apply f args-list)");
    const rest = coll(a[a.length - 1], "apply");
    return apply(a[0], [...a.slice(1, -1), ...rest], ctx);
  });
  def("comp", (a) => {
    const fnsList = [...a];
    return new NativeFn("comp", async (args, ctx) => {
      let v: unknown = fnsList.length ? await apply(fnsList[fnsList.length - 1], args, ctx) : args[0];
      for (let i = fnsList.length - 2; i >= 0; i--) v = await apply(fnsList[i], [v], ctx);
      return v;
    });
  });
  def("partial", (a) => {
    if (a.length < 1) throw new LispError("partial takes (partial f args…)");
    const [f, ...bound] = a;
    return new NativeFn("partial", (args, ctx) => apply(f, [...bound, ...args], ctx));
  });

  // ── maps ──────────────────────────────────────────────────────────────────
  def("get", (a) => {
    arity(a, "get", 2, 3);
    const [m, k, dflt] = a;
    if (m === null || m === undefined) return dflt ?? null;
    if (Array.isArray(m)) {
      const i = typeof k === "number" ? k : NaN;
      return Number.isInteger(i) && i >= 0 && i < m.length ? m[i] : (dflt ?? null);
    }
    if (isPlainObject(m)) {
      const v = m[asKey(k)];
      return v === undefined ? (dflt ?? null) : v;
    }
    return dflt ?? null;
  });
  def("get-in", (a) => {
    arity(a, "get-in", 2, 3);
    const path = coll(a[1], "get-in");
    let cur: unknown = a[0];
    for (const k of path) {
      if (cur === null || cur === undefined) return a[2] ?? null;
      if (Array.isArray(cur)) cur = typeof k === "number" ? cur[k] : undefined;
      else if (isPlainObject(cur)) cur = cur[asKey(k)];
      else return a[2] ?? null;
    }
    return cur === undefined ? (a[2] ?? null) : cur;
  });
  def("assoc", (a) => {
    if (a.length < 3 || a.length % 2 === 0) throw new LispError("assoc takes (assoc map key value …pairs)");
    const m = a[0] === null || a[0] === undefined ? {} : a[0];
    if (!isPlainObject(m)) throw new LispError(`assoc: expected a map, got ${printForm(a[0])}`);
    const out = { ...m };
    for (let i = 1; i < a.length; i += 2) out[asKey(a[i])] = a[i + 1];
    return out;
  });
  def("dissoc", (a) => {
    if (a.length < 2) throw new LispError("dissoc takes (dissoc map key …)");
    const m = a[0];
    if (!isPlainObject(m)) throw new LispError(`dissoc: expected a map, got ${printForm(m)}`);
    const out = { ...m };
    for (const k of a.slice(1)) delete out[asKey(k)];
    return out;
  });
  def("merge", (a) => {
    const out: Record<string, unknown> = {};
    for (const m of a) {
      if (m === null || m === undefined) continue;
      if (!isPlainObject(m)) throw new LispError(`merge: expected maps, got ${printForm(m)}`);
      Object.assign(out, m);
    }
    return out;
  });
  def("select-keys", (a) => {
    arity(a, "select-keys", 2);
    const m = a[0];
    if (m === null || m === undefined) return {};
    if (!isPlainObject(m)) throw new LispError(`select-keys: expected a map, got ${printForm(m)}`);
    const out: Record<string, unknown> = {};
    for (const k of coll(a[1], "select-keys")) {
      const key = asKey(k);
      if (m[key] !== undefined) out[key] = m[key];
    }
    return out;
  });
  def(
    "update",
    async (a, ctx) => {
      if (a.length < 3) throw new LispError("update takes (update map key f args…)");
      const m = a[0];
      if (!isPlainObject(m)) throw new LispError(`update: expected a map, got ${printForm(m)}`);
      const key = asKey(a[1]);
      const out = { ...m };
      out[key] = await apply(a[2], [m[key] ?? null, ...a.slice(3)], ctx);
      return out;
    },
    "(update map key f)",
  );
  def("keys", (a) => {
    arity(a, "keys", 1);
    const m = a[0];
    if (m === null || m === undefined) return [];
    if (!isPlainObject(m)) throw new LispError(`keys: expected a map, got ${printForm(m)}`);
    return Object.keys(m);
  });
  def("vals", (a) => {
    arity(a, "vals", 1);
    const m = a[0];
    if (m === null || m === undefined) return [];
    if (!isPlainObject(m)) throw new LispError(`vals: expected a map, got ${printForm(m)}`);
    return Object.values(m);
  });

  // ── strings ───────────────────────────────────────────────────────────────
  def("str", (a) => a.map(toDisplay).join(""));
  def("upper-case", (a) => (arity(a, "upper-case", 1), stringOf(a[0], "upper-case").toUpperCase()));
  def("lower-case", (a) => (arity(a, "lower-case", 1), stringOf(a[0], "lower-case").toLowerCase()));
  def("capitalize", (a) => {
    arity(a, "capitalize", 1);
    const s = stringOf(a[0], "capitalize");
    return s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
  });
  def("trim", (a) => (arity(a, "trim", 1), stringOf(a[0], "trim").trim()));
  def("includes?", (a) => (arity(a, "includes?", 2), stringOf(a[0], "includes?").includes(stringOf(a[1], "includes?"))));
  def("starts-with?", (a) => (arity(a, "starts-with?", 2), stringOf(a[0], "starts-with?").startsWith(stringOf(a[1], "starts-with?"))));
  def("ends-with?", (a) => (arity(a, "ends-with?", 2), stringOf(a[0], "ends-with?").endsWith(stringOf(a[1], "ends-with?"))));
  def("split", (a) => (arity(a, "split", 2), stringOf(a[0], "split").split(stringOf(a[1], "split"))));
  def("join", (a) => {
    arity(a, "join", 1, 2);
    if (a.length === 1) return coll(a[0], "join").map(toDisplay).join("");
    return coll(a[1], "join").map(toDisplay).join(stringOf(a[0], "join"));
  });
  def("replace", (a) => {
    arity(a, "replace", 3);
    return stringOf(a[0], "replace").split(stringOf(a[1], "replace")).join(stringOf(a[2], "replace"));
  });
  def("subs", (a) => {
    arity(a, "subs", 2, 3);
    const s = stringOf(a[0], "subs");
    return a.length === 3 ? s.slice(num(a[1], "subs"), num(a[2], "subs")) : s.slice(num(a[1], "subs"));
  });
  // Models spell string fns as str/… or clojure.string/… — honor the instinct.
  for (const short of ["upper-case", "lower-case", "capitalize", "trim", "includes?", "starts-with?", "ends-with?", "split", "join", "replace", "trim"]) {
    const target = fns.get(short)!;
    fns.set(`str/${short}`, target);
    fns.set(`clojure.string/${short}`, target);
  }
  fns.set("string/join", fns.get("join")!);

  // `println` — returns nil, output lands on the session's stdout buffer.
  def("println", (a, ctx) => {
    const line = a.map(toDisplay).join(" ");
    const sink = (ctx as EvalCtx & { stdout?: string[] }).stdout;
    if (sink) sink.push(line);
    return null;
  });
  fns.set("prn", fns.get("println")!);
  fns.set("print", fns.get("println")!);

  return fns;
}
