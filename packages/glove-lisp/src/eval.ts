/**
 * The evaluator — a strict, call-by-value tree-walker with a FUEL budget.
 *
 * Two properties matter more than speed:
 *
 *   1. **Effects are exactly-once by construction.** Evaluation order is the
 *      program's order; a resource call is invoked when (and only when) its
 *      form is evaluated. There is no planner that might lazily re-evaluate a
 *      FROM clause N times — the failure the SQL emulator needed a whole
 *      pre-resolution pass to prevent falls out of the semantics here.
 *   2. **The program is the syntax tree.** Every form is read (and can be
 *      inspected, gated, explained) before anything runs — homoiconicity gives
 *      the interpreter's security surface for free.
 *
 * Runaway protection is a fuel counter (charged per form evaluated and per
 * element in bulk stdlib ops) plus a recursion-depth cap: there is no `loop`,
 * `recur`, or `while` — iteration happens through bounded seq functions.
 */
import { closest, Env } from "./env";
import { FN_MARKER, Form, Keyword, LList, MapLit, printForm, Sym, truthy, Vec } from "./values";

export class LispError extends Error {}

export interface EvalCtx {
  fuel: { remaining: number };
  depth: number;
  readonly maxDepth: number;
  /** `def` targets the session root so definitions persist across calls. */
  readonly rootEnv: Env;
  /** Session-provided special forms (e.g. `stage`) that need unevaluated bodies. */
  readonly extraSpecials?: Record<string, (items: Form[], env: Env, ctx: EvalCtx) => Promise<unknown>>;
  readonly signal?: AbortSignal;
}

export function chargeFuel(ctx: EvalCtx, n = 1): void {
  ctx.fuel.remaining -= n;
  if (ctx.fuel.remaining < 0) {
    throw new LispError(
      "computation budget exceeded — the program did too much work. Narrow earlier: filter/take before mapping, " +
        "use (count …) instead of materializing, or split the work across calls with (def name …).",
    );
  }
}

export class NativeFn {
  constructor(
    readonly name: string,
    readonly fn: (args: unknown[], ctx: EvalCtx) => unknown | Promise<unknown>,
    /** Human arity blurb for error messages, e.g. `(map f coll)`. */
    readonly usage?: string,
  ) {}
}

export class Lambda {
  constructor(
    readonly params: string[],
    readonly rest: string | undefined,
    readonly body: Form[],
    readonly env: Env,
    readonly name = "fn",
  ) {}
}

// Brand both function shapes so values.ts can print them opaquely (and never
// mistake them for data maps) without a circular import.
(NativeFn.prototype as unknown as Record<symbol, boolean>)[FN_MARKER] = true;
(Lambda.prototype as unknown as Record<symbol, boolean>)[FN_MARKER] = true;

function usageSuffix(u?: string): string {
  return u ? ` — usage: ${u}` : "";
}

export async function apply(fnVal: unknown, args: unknown[], ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  if (ctx.signal?.aborted) throw new LispError("aborted");
  if (fnVal instanceof NativeFn) {
    try {
      return await fnVal.fn(args, ctx);
    } catch (err) {
      if (err instanceof LispError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new LispError(`${fnVal.name}: ${msg}${usageSuffix(fnVal.usage)}`);
    }
  }
  if (fnVal instanceof Lambda) {
    if (ctx.depth + 1 > ctx.maxDepth) {
      throw new LispError(`recursion too deep (max ${ctx.maxDepth}) — rewrite with map/filter/reduce instead of self-recursion`);
    }
    const min = fnVal.params.length;
    if (args.length < min || (!fnVal.rest && args.length > min)) {
      throw new LispError(
        `${fnVal.name} expects ${min}${fnVal.rest ? "+" : ""} argument(s), got ${args.length}`,
      );
    }
    const local = new Env(fnVal.env);
    fnVal.params.forEach((p, i) => local.set(p, args[i]));
    if (fnVal.rest) local.set(fnVal.rest, args.slice(min));
    const inner: EvalCtx = { ...ctx, depth: ctx.depth + 1 };
    let result: unknown = null;
    for (const form of fnVal.body) result = await evalForm(form, local, inner);
    return result;
  }
  if (fnVal instanceof Keyword) {
    const [m, dflt] = args;
    if (Array.isArray(m)) {
      throw new LispError(
        `(:${fnVal.name} …) was given a list of ${m.length} item(s), not a map — did you mean (map :${fnVal.name} the-list)?`,
      );
    }
    if (m === null || m === undefined) return dflt ?? null;
    if (typeof m === "object") {
      const v = (m as Record<string, unknown>)[fnVal.name];
      return v === undefined ? (dflt ?? null) : v;
    }
    throw new LispError(`(:${fnVal.name} …) expects a map, got ${printForm(m)}`);
  }
  throw new LispError(
    `${printForm(fnVal)} is not callable — the first item of a (…) form must be a function. To make a list, use [ … ] instead of ( … ).`,
  );
}

function expectVec(f: Form, what: string): Vec {
  if (!(f instanceof Vec)) throw new LispError(`${what} must be a [ … ] vector, got ${printForm(f)}`);
  return f;
}

function paramList(vec: Vec, name: string): { params: string[]; rest?: string } {
  const params: string[] = [];
  let rest: string | undefined;
  for (let i = 0; i < vec.items.length; i++) {
    const p = vec.items[i];
    if (!(p instanceof Sym)) throw new LispError(`${name}: parameters must be plain symbols, got ${printForm(p)}`);
    if (p.name === "&") {
      const r = vec.items[i + 1];
      if (!(r instanceof Sym) || i + 2 !== vec.items.length) {
        throw new LispError(`${name}: '&' must be followed by exactly one rest parameter`);
      }
      rest = r.name;
      return { params, rest };
    }
    params.push(p.name);
  }
  return { params, rest };
}

/** `->` / `->>` rewriting: thread `x` through each step as first/last argument. */
function thread(items: Form[], last: boolean): Form {
  if (items.length < 2) throw new LispError(`${last ? "->>" : "->"} needs a value followed by at least one step`);
  let cur = items[1];
  for (const step of items.slice(2)) {
    if (step instanceof LList) {
      const inner = step.items;
      cur = new LList(last ? [...inner, cur] : [inner[0], cur, ...inner.slice(1)]);
    } else {
      cur = new LList([step, cur]);
    }
  }
  return cur;
}

export async function evalForm(form: Form, env: Env, ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  if (ctx.signal?.aborted) throw new LispError("aborted");

  if (form === null || typeof form === "boolean" || typeof form === "number" || typeof form === "string") return form;
  if (form instanceof Keyword) return form;
  if (form instanceof Sym) {
    const r = env.lookup(form.name);
    if (!r.found) {
      if (form.name.startsWith(".")) {
        throw new LispError(
          `'${form.name}': Java interop is not available — use the library fns instead (starts-with?, ends-with?, includes?, lower-case, upper-case, split, replace).`,
        );
      }
      if (form.name === "execute_lisp" || form.name === "explain_lisp") {
        throw new LispError(
          `'${form.name}' is a TOOL, not a function — you are already inside it. Call the ${form.name} tool directly for your next program.`,
        );
      }
      const hint = closest(form.name, env.allNames());
      throw new LispError(
        `unknown symbol '${form.name}'${hint ? ` — did you mean '${hint}'?` : ""}. Run (tables) to list your capabilities and (describe :name) for one of them.`,
      );
    }
    return r.value;
  }
  if (form instanceof Vec) {
    const out: unknown[] = [];
    for (const item of form.items) out.push(await evalForm(item, env, ctx));
    return out;
  }
  if (form instanceof MapLit) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.pairs) {
      const key = k instanceof Keyword ? k.name : k instanceof Sym ? String(await evalForm(k, env, ctx)) : typeof k === "string" || typeof k === "number" ? String(k) : null;
      if (key === null) throw new LispError(`map keys must be keywords, strings, or numbers — got ${printForm(k)}`);
      out[key] = await evalForm(v, env, ctx);
    }
    return out;
  }

  // A `(…)` form: special form or application.
  const items = form.items;
  if (items.length === 0) return [];
  const head = items[0];

  if (head instanceof Sym) {
    switch (head.name) {
      case "quote": {
        if (items.length !== 2) throw new LispError("quote takes exactly one form");
        return quoteToValue(items[1]);
      }
      case "if": {
        if (items.length < 3 || items.length > 4) throw new LispError("if takes (if test then else?) — 2 or 3 forms after the test");
        const test = await evalForm(items[1], env, ctx);
        if (truthy(test)) return evalForm(items[2], env, ctx);
        return items.length === 4 ? evalForm(items[3], env, ctx) : null;
      }
      case "when": {
        if (items.length < 2) throw new LispError("when takes (when test body…)");
        const test = await evalForm(items[1], env, ctx);
        if (!truthy(test)) return null;
        let out: unknown = null;
        for (const f of items.slice(2)) out = await evalForm(f, env, ctx);
        return out;
      }
      case "cond": {
        const clauses = items.slice(1);
        if (clauses.length % 2 !== 0) throw new LispError("cond takes test/result pairs — (cond test1 r1 test2 r2 … :else fallback)");
        for (let i = 0; i < clauses.length; i += 2) {
          if (truthy(await evalForm(clauses[i], env, ctx))) return evalForm(clauses[i + 1], env, ctx);
        }
        return null;
      }
      case "do": {
        let out: unknown = null;
        for (const f of items.slice(1)) out = await evalForm(f, env, ctx);
        return out;
      }
      case "def": {
        if (items.length !== 3 || !(items[1] instanceof Sym)) {
          throw new LispError("def takes (def name value)");
        }
        const name = (items[1] as Sym).name;
        const value = await evalForm(items[2], env, ctx);
        ctx.rootEnv.set(name, value);
        return defSummary(name, value);
      }
      case "defn": {
        if (items.length < 4 || !(items[1] instanceof Sym)) {
          throw new LispError("defn takes (defn name [params] body…)");
        }
        const name = (items[1] as Sym).name;
        const vec = expectVec(items[2], `defn ${name}: the parameter list`);
        const { params, rest } = paramList(vec, `defn ${name}`);
        const fn = new Lambda(params, rest, items.slice(3), env, name);
        ctx.rootEnv.set(name, fn);
        return defSummary(name, fn);
      }
      case "fn": {
        if (items.length < 3) throw new LispError("fn takes (fn [params] body…)");
        const vec = expectVec(items[1], "fn: the parameter list");
        const { params, rest } = paramList(vec, "fn");
        return new Lambda(params, rest, items.slice(2), env);
      }
      case "let": {
        if (items.length < 3) throw new LispError("let takes (let [name value …] body…)");
        const vec = expectVec(items[1], "let: the binding list");
        if (vec.items.length % 2 !== 0) throw new LispError("let bindings must be name/value pairs — (let [a 1 b 2] …)");
        const local = new Env(env);
        for (let i = 0; i < vec.items.length; i += 2) {
          const n = vec.items[i];
          if (!(n instanceof Sym)) throw new LispError(`let: binding names must be plain symbols, got ${printForm(n)}`);
          local.set(n.name, await evalForm(vec.items[i + 1], local, ctx));
        }
        let out: unknown = null;
        for (const f of items.slice(2)) out = await evalForm(f, local, ctx);
        return out;
      }
      case "doseq": {
        // (doseq [x coll] body…) — evaluate body per element, for effects.
        if (items.length < 3) throw new LispError("doseq takes (doseq [x coll] body…)");
        const vec = expectVec(items[1], "doseq: the binding");
        if (vec.items.length !== 2 || !(vec.items[0] instanceof Sym)) {
          throw new LispError("doseq: the binding must be [name coll] — one name, one collection");
        }
        const seq = await evalForm(vec.items[1], env, ctx);
        const elements = Array.isArray(seq) ? seq : seq === null || seq === undefined ? [] : [seq];
        chargeFuel(ctx, elements.length);
        for (const el of elements) {
          const local = new Env(env);
          local.set((vec.items[0] as Sym).name, el);
          for (const f of items.slice(2)) await evalForm(f, local, ctx);
        }
        return null;
      }
      case "if-let":
      case "when-let": {
        // (if-let [name test] then else?) / (when-let [name test] body…)
        const kind = head.name;
        if (items.length < 3) throw new LispError(`${kind} takes (${kind} [name test] body…)`);
        const vec = expectVec(items[1], `${kind}: the binding`);
        if (vec.items.length !== 2 || !(vec.items[0] instanceof Sym)) {
          throw new LispError(`${kind}: the binding must be [name test] — one name, one value`);
        }
        const bound = await evalForm(vec.items[1], env, ctx);
        if (truthy(bound)) {
          const local = new Env(env);
          local.set((vec.items[0] as Sym).name, bound);
          if (kind === "if-let") return evalForm(items[2], local, ctx);
          let out: unknown = null;
          for (const f of items.slice(2)) out = await evalForm(f, local, ctx);
          return out;
        }
        return kind === "if-let" && items.length === 4 ? evalForm(items[3], env, ctx) : null;
      }
      case "and": {
        let out: unknown = true;
        for (const f of items.slice(1)) {
          out = await evalForm(f, env, ctx);
          if (!truthy(out)) return out;
        }
        return out;
      }
      case "or": {
        let out: unknown = null;
        for (const f of items.slice(1)) {
          out = await evalForm(f, env, ctx);
          if (truthy(out)) return out;
        }
        return out;
      }
      case "->":
        return evalForm(thread(items, false), env, ctx);
      case "->>":
        return evalForm(thread(items, true), env, ctx);
    }
    const extra = ctx.extraSpecials?.[head.name];
    if (extra) return extra(items.slice(1), env, ctx);
  }

  const fnVal = await evalForm(head, env, ctx);
  const args: unknown[] = [];
  for (const a of items.slice(1)) args.push(await evalForm(a, env, ctx));
  return apply(fnVal, args, ctx);
}

/** What `def` echoes back: a summary, never the (possibly huge) value itself. */
function defSummary(name: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { defined: name };
  if (Array.isArray(value)) out.count = value.length;
  else if (value instanceof Lambda || value instanceof NativeFn) out.kind = "function";
  else if (value !== null && typeof value === "object") out.kind = "map";
  else out.value = value;
  return out;
}

/** Quoted forms become plain data (symbols → strings, so '(a b) is usable data). */
function quoteToValue(form: Form): unknown {
  if (form instanceof Sym) return form.name;
  if (form instanceof Keyword) return form;
  if (form instanceof LList) return form.items.map(quoteToValue);
  if (form instanceof Vec) return form.items.map(quoteToValue);
  if (form instanceof MapLit) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.pairs) {
      const key = k instanceof Keyword ? k.name : k instanceof Sym ? k.name : String(k);
      out[key] = quoteToValue(v);
    }
    return out;
  }
  return form;
}
