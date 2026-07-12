/**
 * The evaluator — an async, call-by-value tree-walker over the normalized AST,
 * with a FUEL budget. Mirrors glove-js/src/interp.ts:
 *
 *   1. Effects are exactly-once by construction — a tool call fires when (and
 *      only when) its Call node evaluates; evaluation order is program order.
 *   2. Every node is validated before anything runs (parse.ts), and every
 *      attribute/subscript access is mediated (members.ts).
 *
 * Runaway protection is a fuel counter (per node + per loop back-edge + per
 * comprehension element) plus a recursion-depth cap and an AbortSignal.
 */
import { PyError } from "./errors";
import { closest } from "glove-scratchpad/fns";
import type { Expr, Generator, Param, SliceNode, Stmt } from "./ast";
import { Scope } from "./scope";
import {
  callMethod,
  getAttr,
  getItem,
  getSlice,
  setAttr,
  setItem,
  type InterpApi,
} from "./members";
import { NativeFn } from "./native";
import { isDict, PyRange, pyEquals, pyIter, pyStr, pyTruthy, pyTypeName, tuple } from "./values";

export class BudgetError extends PyError {}

export interface EvalCtx {
  fuel: { remaining: number };
  depth: number;
  readonly maxDepth: number;
  readonly signal?: AbortSignal;
  readonly actor?: string;
  called: Map<string, number>;
}

export function chargeFuel(ctx: EvalCtx, n = 1): void {
  ctx.fuel.remaining -= n;
  if (ctx.fuel.remaining < 0) {
    throw new BudgetError(
      "computation budget exceeded — the program did too much work (a runaway loop, or too many elements). " +
        "Narrow earlier: filter/slice before mapping, use len() instead of materializing, or split the work across calls.",
    );
  }
}
function checkAbort(ctx: EvalCtx): void {
  if (ctx.signal?.aborted) throw new BudgetError("aborted");
}

export class Closure {
  constructor(
    readonly params: Param[],
    readonly body: Stmt[] | Expr,
    readonly isLambda: boolean,
    readonly scope: Scope,
    readonly name = "<lambda>",
  ) {}
}

class ReturnSignal {
  constructor(readonly value: unknown) {}
}
class BreakSignal {}
class ContinueSignal {}
/** A program's `raise` — the value raised. */
class UserRaise {
  constructor(readonly value: unknown) {}
}

const CONCAT_FREE = 256;
const MAX_ALLOC = 10_000_000;

export function isCallable(v: unknown): boolean {
  return v instanceof Closure || v instanceof NativeFn;
}

function apiFor(ctx: EvalCtx): InterpApi {
  return {
    apply: (fn, args) => applyFunction(fn, args, {}, ctx),
    isCallable,
    charge: (n) => chargeFuel(ctx, n),
    signal: ctx.signal,
    actor: ctx.actor,
  };
}

export async function applyFunction(
  fn: unknown,
  args: unknown[],
  kwargs: Record<string, unknown>,
  ctx: EvalCtx,
): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  if (fn instanceof NativeFn) {
    if (fn.toolName) ctx.called.set(fn.toolName, (ctx.called.get(fn.toolName) ?? 0) + 1);
    return fn.call(args, kwargs, apiFor(ctx));
  }
  if (fn instanceof Closure) {
    if (ctx.depth + 1 > ctx.maxDepth) {
      throw new BudgetError(`recursion too deep (max ${ctx.maxDepth}) — rewrite with a loop or a comprehension.`);
    }
    const local = fn.scope.child();
    bindParams(fn, args, kwargs, local);
    const inner: EvalCtx = { ...ctx, depth: ctx.depth + 1 };
    if (fn.isLambda) return evalExpr(fn.body as Expr, local, inner);
    try {
      await execBlock(fn.body as Stmt[], local, inner);
    } catch (sig) {
      if (sig instanceof ReturnSignal) return sig.value;
      throw sig;
    }
    return null;
  }
  throw new PyError(`'${pyTypeName(fn)}' object is not callable`);
}

function bindParams(fn: Closure, args: unknown[], kwargs: Record<string, unknown>, scope: Scope): void {
  const seen = new Set<string>();
  for (let i = 0; i < fn.params.length; i++) {
    const p = fn.params[i];
    if (i < args.length) {
      scope.set(p.name, args[i]);
    } else if (p.name in kwargs) {
      scope.set(p.name, kwargs[p.name]);
    } else if (p.default !== null) {
      // defaults are simple literals/names — evaluate in the defining scope
      scope.set(p.name, evalDefault(p.default, fn.scope));
    } else {
      throw new PyError(`${fn.name}() missing required argument: '${p.name}'`);
    }
    seen.add(p.name);
  }
  for (const k of Object.keys(kwargs)) {
    if (!seen.has(k)) throw new PyError(`${fn.name}() got an unexpected keyword argument '${k}'`);
  }
}

function evalDefault(node: Expr, scope: Scope): unknown {
  switch (node.kind) {
    case "Num": return node.value;
    case "Str": return node.value;
    case "Const": return node.value;
    case "List": return [];
    case "Dict": return {};
    case "Name": { const r = scope.lookup(node.id); return r.found ? r.value : null; }
    default: throw new PyError("default parameter values must be simple literals.");
  }
}

// ── statements ───────────────────────────────────────────────────────────────

async function execBlock(body: Stmt[], scope: Scope, ctx: EvalCtx): Promise<unknown> {
  // hoist function defs so they can call each other
  for (const s of body) if (s.kind === "FunctionDef") scope.set(s.name, new Closure(s.params, s.body, false, scope, s.name));
  let last: unknown;
  for (const s of body) last = await evalStmt(s, scope, ctx);
  return last;
}

async function evalStmt(node: Stmt, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  switch (node.kind) {
    case "ExprStmt":
      return evalExpr(node.value, scope, ctx);
    case "Assign": {
      const value = await evalExpr(node.value, scope, ctx);
      for (const t of node.targets) await assignTo(t, value, scope, ctx);
      return undefined;
    }
    case "AugAssign": {
      const cur = await evalExpr(node.target, scope, ctx);
      const rhs = await evalExpr(node.value, scope, ctx);
      await assignTo(node.target, binOp(node.op.replace("=", ""), cur, rhs, ctx), scope, ctx);
      return undefined;
    }
    case "FunctionDef":
      scope.set(node.name, new Closure(node.params, node.body, false, scope, node.name));
      return undefined;
    case "If":
      if (pyTruthy(await evalExpr(node.test, scope, ctx))) return execBlock(node.body, scope, ctx);
      return execBlock(node.orelse, scope, ctx);
    case "While": {
      let broke = false;
      while (pyTruthy(await evalExpr(node.test, scope, ctx))) {
        chargeFuel(ctx);
        checkAbort(ctx);
        try {
          await execBlock(node.body, scope, ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) { broke = true; break; }
          if (!(sig instanceof ContinueSignal)) throw sig;
        }
      }
      if (!broke) await execBlock(node.orelse, scope, ctx);
      return undefined;
    }
    case "For": {
      const iterable = await evalExpr(node.iter, scope, ctx);
      let broke = false;
      for (const item of pyIter(iterable)) {
        chargeFuel(ctx);
        checkAbort(ctx);
        await assignTo(node.target, item, scope, ctx);
        try {
          await execBlock(node.body, scope, ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) { broke = true; break; }
          if (!(sig instanceof ContinueSignal)) throw sig;
        }
      }
      if (!broke) await execBlock(node.orelse, scope, ctx);
      return undefined;
    }
    case "Return":
      throw new ReturnSignal(node.value ? await evalExpr(node.value, scope, ctx) : null);
    case "Break":
      throw new BreakSignal();
    case "Continue":
      throw new ContinueSignal();
    case "Pass":
      return undefined;
    case "Raise":
      throw new UserRaise(node.exc ? await evalExpr(node.exc, scope, ctx) : new PyError("exception"));
    case "Try":
      return execTry(node, scope, ctx);
    default:
      throw new PyError(`unsupported statement: ${(node as { kind: string }).kind}`);
  }
}

async function execTry(node: Stmt & { kind: "Try" }, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  try {
    await execBlock(node.body, scope, ctx);
    await execBlock(node.orelse, scope, ctx);
  } catch (err) {
    if (err instanceof BudgetError || err instanceof ReturnSignal || err instanceof BreakSignal || err instanceof ContinueSignal) {
      if (node.finalbody.length) await execBlock(node.finalbody, scope, ctx);
      throw err;
    }
    const caught = err instanceof UserRaise ? err.value : errorToValue(err);
    if (node.handlers.length === 0) {
      if (node.finalbody.length) await execBlock(node.finalbody, scope, ctx);
      throw err;
    }
    const handler = node.handlers[0]; // first handler wins (types not enforced in the subset)
    if (handler.name) scope.set(handler.name, caught);
    await execBlock(handler.body, scope, ctx);
  }
  if (node.finalbody.length) await execBlock(node.finalbody, scope, ctx);
  return undefined;
}

function errorToValue(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  return { type: err instanceof PyError ? "Error" : "Error", message: msg };
}

async function assignTo(target: Expr, value: unknown, scope: Scope, ctx: EvalCtx): Promise<void> {
  switch (target.kind) {
    case "Name":
      scope.set(target.id, value);
      return;
    case "Tuple":
    case "List": {
      const items = [...pyIter(value)];
      if (items.length !== target.elts.length) {
        throw new PyError(`cannot unpack ${items.length} values into ${target.elts.length} targets`);
      }
      for (let i = 0; i < target.elts.length; i++) await assignTo(target.elts[i], items[i], scope, ctx);
      return;
    }
    case "Attribute":
      setAttr(await evalExpr(target.value, scope, ctx), target.attr, value);
      return;
    case "Subscript": {
      const obj = await evalExpr(target.value, scope, ctx);
      if ((target.slice as SliceNode).kind === "Slice") throw new PyError("slice assignment is not supported.");
      setItem(obj, await evalExpr(target.slice as Expr, scope, ctx), value);
      return;
    }
    default:
      throw new PyError(`cannot assign to ${target.kind}`);
  }
}

// ── expressions ──────────────────────────────────────────────────────────────

async function evalExpr(node: Expr, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  switch (node.kind) {
    case "Num": return node.value;
    case "Str": return node.value;
    case "Const": return node.value;
    case "Name": {
      const r = scope.lookup(node.id);
      if (!r.found) {
        const hint = closest(node.id, scope.allNames());
        throw new PyError(`name '${node.id}' is not defined${hint ? ` — did you mean '${hint}'?` : ""}.`);
      }
      return r.value;
    }
    case "FString": {
      let out = "";
      for (const p of node.parts) out += typeof p === "string" ? p : pyStr(await evalExpr(p, scope, ctx));
      if (out.length > CONCAT_FREE) chargeFuel(ctx, out.length);
      return out;
    }
    case "List": return evalElts(node.elts, scope, ctx);
    case "Tuple": return tuple(await evalElts(node.elts, scope, ctx));
    case "Set": return new Set(await evalElts(node.elts, scope, ctx));
    case "Dict": {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < node.keys.length; i++) {
        out[pyStr(await evalExpr(node.keys[i], scope, ctx))] = await evalExpr(node.values[i], scope, ctx);
      }
      return out;
    }
    case "BoolOp": {
      let v: unknown = undefined;
      for (const e of node.values) {
        v = await evalExpr(e, scope, ctx);
        if (node.op === "and" && !pyTruthy(v)) return v;
        if (node.op === "or" && pyTruthy(v)) return v;
      }
      return v;
    }
    case "UnaryOp": {
      const v = await evalExpr(node.operand, scope, ctx);
      if (node.op === "not") return !pyTruthy(v);
      if (node.op === "-") return -(v as number);
      if (node.op === "+") return +(v as number);
      if (node.op === "~") return ~(v as number);
      throw new PyError(`unsupported unary operator '${node.op}'`);
    }
    case "BinOp": {
      const l = await evalExpr(node.left, scope, ctx);
      const r = await evalExpr(node.right, scope, ctx);
      return binOp(node.op, l, r, ctx);
    }
    case "Compare": return compare(node, scope, ctx);
    case "IfExp":
      return pyTruthy(await evalExpr(node.test, scope, ctx))
        ? evalExpr(node.body, scope, ctx)
        : evalExpr(node.orelse, scope, ctx);
    case "Attribute":
      return getAttr(await evalExpr(node.value, scope, ctx), node.attr, apiFor(ctx));
    case "Subscript": {
      const obj = await evalExpr(node.value, scope, ctx);
      const s = node.slice as SliceNode;
      if (s.kind === "Slice") {
        const lo = s.lower ? Number(await evalExpr(s.lower, scope, ctx)) : null;
        const hi = s.upper ? Number(await evalExpr(s.upper, scope, ctx)) : null;
        const st = s.step ? Number(await evalExpr(s.step, scope, ctx)) : null;
        return getSlice(obj, lo, hi, st);
      }
      return getItem(obj, await evalExpr(node.slice as Expr, scope, ctx));
    }
    case "Lambda":
      return new Closure(node.params, node.body, true, scope);
    case "Comp":
      return comprehension(node, scope, ctx);
    case "Call":
      return evalCall(node, scope, ctx);
    default:
      throw new PyError(`unsupported expression: ${(node as { kind: string }).kind}`);
  }
}

async function evalElts(elts: Expr[], scope: Scope, ctx: EvalCtx): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const e of elts) out.push(await evalExpr(e, scope, ctx));
  return out;
}

async function evalCall(node: Expr & { kind: "Call" }, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const func = node.func;
  const args: unknown[] = [];
  const kwargs: Record<string, unknown> = {};

  if (func.kind === "Attribute") {
    const obj = await evalExpr(func.value, scope, ctx);
    for (const a of node.args) args.push(await evalExpr(a, scope, ctx));
    for (const k of node.keywords) kwargs[k.name] = await evalExpr(k.value, scope, ctx);
    // a dict's own key is a value/tool (github.list_pull_requests); otherwise a
    // built-in method on the type (str/list/dict/set).
    if (isDict(obj) && Object.hasOwn(obj, func.attr)) {
      return applyFunction(getAttr(obj, func.attr, apiFor(ctx)), args, kwargs, ctx);
    }
    return callMethod(obj, func.attr, args, kwargs, apiFor(ctx));
  }

  const fn = await evalExpr(func, scope, ctx);
  for (const a of node.args) args.push(await evalExpr(a, scope, ctx));
  for (const k of node.keywords) kwargs[k.name] = await evalExpr(k.value, scope, ctx);
  return applyFunction(fn, args, kwargs, ctx);
}

async function comprehension(node: Expr & { kind: "Comp" }, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const out: unknown[] = [];
  const dict: Record<string, unknown> = {};
  const local = scope.child();

  const run = async (gi: number): Promise<void> => {
    if (gi >= node.generators.length) {
      chargeFuel(ctx);
      if (out.length > MAX_ALLOC) throw new PyError(`comprehension too large (max ${MAX_ALLOC}).`);
      if (node.ctype === "dict") {
        dict[pyStr(await evalExpr(node.key!, local, ctx))] = await evalExpr(node.elt, local, ctx);
      } else {
        out.push(await evalExpr(node.elt, local, ctx));
      }
      return;
    }
    const gen: Generator = node.generators[gi];
    const iterable = await evalExpr(gen.iter, local, ctx);
    for (const item of pyIter(iterable)) {
      chargeFuel(ctx);
      await assignTo(gen.target, item, local, ctx);
      let ok = true;
      for (const cond of gen.ifs) if (!pyTruthy(await evalExpr(cond, local, ctx))) { ok = false; break; }
      if (ok) await run(gi + 1);
    }
  };
  await run(0);

  if (node.ctype === "dict") return dict;
  if (node.ctype === "set") return new Set(out);
  return out; // list + gen (generators are materialized in this subset)
}

// ── operators ────────────────────────────────────────────────────────────────

function binOp(op: string, l: unknown, r: unknown, ctx: EvalCtx): unknown {
  switch (op) {
    case "+":
      if (typeof l === "string" && typeof r === "string") {
        if (l.length + r.length > CONCAT_FREE) chargeFuel(ctx, l.length + r.length);
        return l + r;
      }
      if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
      return (l as number) + (r as number);
    case "-":
      return (l as number) - (r as number);
    case "*":
      if (typeof l === "string" && typeof r === "number") return repeatStr(l, r, ctx);
      if (typeof r === "string" && typeof l === "number") return repeatStr(r, l, ctx);
      if (Array.isArray(l) && typeof r === "number") return repeatList(l, r, ctx);
      if (Array.isArray(r) && typeof l === "number") return repeatList(r, l, ctx);
      return (l as number) * (r as number);
    case "/": return (l as number) / (r as number);
    case "//": return Math.floor((l as number) / (r as number));
    case "%": {
      if (typeof l === "string") throw new PyError("%-formatting is not supported — use an f-string.");
      const a = l as number;
      const b = r as number;
      return ((a % b) + b) % b;
    }
    case "**": return (l as number) ** (r as number);
    case "&": return (l as number) & (r as number);
    case "|": return (l as number) | (r as number);
    case "^": return (l as number) ^ (r as number);
    case "<<": return (l as number) << (r as number);
    case ">>": return (l as number) >> (r as number);
    default:
      throw new PyError(`unsupported operator '${op}'`);
  }
}

function repeatStr(s: string, n: number, ctx: EvalCtx): string {
  const out = Math.max(0, n) * s.length;
  if (out > MAX_ALLOC) throw new PyError(`string would grow to ${out} chars — too large.`);
  chargeFuel(ctx, out);
  return s.repeat(Math.max(0, n));
}
function repeatList(a: unknown[], n: number, ctx: EvalCtx): unknown[] {
  const out = Math.max(0, n) * a.length;
  if (out > MAX_ALLOC) throw new PyError(`list would grow to ${out} elements — too large.`);
  chargeFuel(ctx, out);
  const res: unknown[] = [];
  for (let i = 0; i < n; i++) res.push(...a);
  return res;
}

async function compare(node: Expr & { kind: "Compare" }, scope: Scope, ctx: EvalCtx): Promise<boolean> {
  let left = await evalExpr(node.left, scope, ctx);
  for (let i = 0; i < node.ops.length; i++) {
    const right = await evalExpr(node.comparators[i], scope, ctx);
    if (!compareOne(node.ops[i], left, right)) return false;
    left = right;
  }
  return true;
}

function compareOne(op: string, l: unknown, r: unknown): boolean {
  switch (op) {
    case "==": return pyEquals(l, r);
    case "!=": return !pyEquals(l, r);
    case "<": return (l as number) < (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">": return (l as number) > (r as number);
    case ">=": return (l as number) >= (r as number);
    case "is": return l === r || (l == null && r == null);
    case "is not": return !(l === r || (l == null && r == null));
    case "in": return member(l, r);
    case "not in": return !member(l, r);
    default: throw new PyError(`unsupported comparison '${op}'`);
  }
}

function member(x: unknown, container: unknown): boolean {
  if (typeof container === "string") return typeof x === "string" && container.includes(x);
  if (Array.isArray(container)) return container.some((e) => pyEquals(e, x));
  if (container instanceof Set) return container.has(x);
  if (container instanceof PyRange) return typeof x === "number" && [...container].includes(x);
  if (isDict(container)) return typeof x === "string" && Object.hasOwn(container, x);
  throw new PyError(`argument of type '${pyTypeName(container)}' is not iterable`);
}

// ── entry ────────────────────────────────────────────────────────────────────

/** Run a full program; returns the completion value of the last statement (REPL
 *  semantics — the value of the last expression statement). */
export async function runProgram(body: Stmt[], root: Scope, ctx: EvalCtx): Promise<unknown> {
  for (const s of body) if (s.kind === "FunctionDef") root.set(s.name, new Closure(s.params, s.body, false, root, s.name));
  let last: unknown;
  for (const s of body) last = await evalStmt(s, root, ctx);
  return last;
}

/** Turn a thrown control value into a model-readable one-line message. */
export function formatError(err: unknown): string {
  if (err instanceof UserRaise) {
    const v = err.value;
    if (v && typeof v === "object" && "message" in (v as object)) return String((v as { message: unknown }).message);
    return `raised: ${pyStr(v)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
