/**
 * The evaluator — an async, call-by-value tree-walker over the acorn AST, with
 * a FUEL budget. Mirrors glove-lisp/src/eval.ts:
 *
 *   1. **Effects are exactly-once by construction.** Evaluation order is the
 *      program's order; a tool call fires when (and only when) its form is
 *      evaluated. There is no planner to re-run a relation.
 *   2. **The program is the syntax tree.** Every node is validated before
 *      anything runs (parse.ts), and every member access is mediated
 *      (members.ts) — the security surface is explicit, not emergent.
 *
 * Runaway protection is a fuel counter (charged per node and per loop
 * back-edge) plus a recursion-depth cap. Async throughout, so `await` is a
 * pass-through and any tool promise is resolved before its value is used
 * (implicit await).
 */
import { JsError } from "./errors";
import { closest } from "glove-scratchpad/fns";
import type { AstNode } from "./parse";
import { Scope } from "./scope";
import { getMember, setMember, deleteMember, callMember, type InterpApi } from "./members";
import { HostCtor } from "./host";

/** Raised by fuel exhaustion / abort — NOT catchable by a program's try/catch. */
export class BudgetError extends JsError {}

export interface EvalCtx {
  fuel: { remaining: number };
  depth: number;
  readonly maxDepth: number;
  readonly signal?: AbortSignal;
}

export function chargeFuel(ctx: EvalCtx, n = 1): void {
  ctx.fuel.remaining -= n;
  if (ctx.fuel.remaining < 0) {
    throw new BudgetError(
      "computation budget exceeded — the program did too much work (a runaway loop, or too many elements). " +
        "Narrow earlier: filter/slice before mapping, use .length instead of materializing, or split the work across calls with a const.",
    );
  }
}

function checkAbort(ctx: EvalCtx): void {
  if (ctx.signal?.aborted) throw new BudgetError("aborted");
}

/** An interpreter closure (arrow or function). Never a real JS function, so it
 *  can't be handed to host code that might call it synchronously. */
export class Closure {
  constructor(
    readonly params: AstNode[],
    readonly body: AstNode,
    /** Arrow with an expression body — implicit return. */
    readonly exprBody: boolean,
    readonly scope: Scope,
    readonly name = "anonymous",
  ) {}
}

// Non-local control flow, invisible to a program's try/catch.
class ReturnSignal {
  constructor(readonly value: unknown) {}
}
class BreakSignal {}
class ContinueSignal {}
/** A program's `throw x` — the value the model threw. */
class UserThrow {
  constructor(readonly value: unknown) {}
}

const BANNED_IDENTIFIERS: Record<string, string> = {
  eval: "eval is not available in this REPL.",
  Function: "the Function constructor is not available.",
  globalThis: "globalThis is not available.",
  window: "window is not available.",
  global: "global is not available.",
  process: "process is not available.",
  require: "require is not available — this REPL has no module system.",
  arguments: "the arguments object is not available — use a rest parameter (...args).",
};

export function isCallable(v: unknown): boolean {
  return v instanceof Closure || typeof v === "function" || v instanceof HostCtor;
}

function apiFor(ctx: EvalCtx): InterpApi {
  return {
    apply: (fn, args) => applyFunction(fn, args, ctx),
    isCallable,
    charge: (n) => chargeFuel(ctx, n),
  };
}

/** Apply a callable to already-evaluated args. Host promises are awaited here,
 *  which is what makes `await` optional throughout the language. */
export async function applyFunction(fn: unknown, args: unknown[], ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  if (fn instanceof Closure) {
    if (ctx.depth + 1 > ctx.maxDepth) {
      throw new BudgetError(
        `call stack too deep (max ${ctx.maxDepth}) — rewrite deep recursion with array methods or an explicit loop.`,
      );
    }
    const local = fn.scope.child();
    bindParams(fn.params, args, local, ctx);
    const inner: EvalCtx = { ...ctx, depth: ctx.depth + 1 };
    if (fn.exprBody) return evalExpr(fn.body, local, inner);
    try {
      await execBlockBody((fn.body.body as AstNode[]) ?? [], local, inner);
    } catch (sig) {
      if (sig instanceof ReturnSignal) return sig.value;
      throw sig;
    }
    return undefined;
  }
  if (typeof fn === "function") {
    return await (fn as (...a: unknown[]) => unknown)(...args);
  }
  if (fn instanceof HostCtor) {
    if (fn.callable) return fn.callable(args);
    throw new JsError(`${fn.name} must be called with new — write new ${fn.name}(...).`);
  }
  throw new JsError(`${describe(fn)} is not a function.`);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "object") return Array.isArray(v) ? "an array" : "an object";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

function bindParams(params: AstNode[], args: unknown[], scope: Scope, ctx: EvalCtx): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p.type === "RestElement") {
      bindPattern(p.argument as AstNode, args.slice(i), scope, true, ctx);
      return;
    }
    bindPattern(p, args[i], scope, true, ctx);
  }
}

/** Bind a destructuring pattern (or plain identifier) to a value. `declareConst`
 *  chooses const vs let for freshly declared names. */
function bindPattern(
  pattern: AstNode,
  value: unknown,
  scope: Scope,
  declareConst: boolean,
  ctx: EvalCtx,
): void {
  switch (pattern.type) {
    case "Identifier": {
      const name = pattern.name as string;
      if (name in BANNED_IDENTIFIERS) throw new JsError(BANNED_IDENTIFIERS[name]);
      scope.declare(name, value, declareConst);
      return;
    }
    case "AssignmentPattern": {
      const v = value === undefined ? evalDefaultSync(pattern.right as AstNode, scope) : value;
      bindPattern(pattern.left as AstNode, v, scope, declareConst, ctx);
      return;
    }
    case "ArrayPattern": {
      const seq = value == null ? [] : Array.isArray(value) ? value : [...(value as Iterable<unknown>)];
      const els = pattern.elements as (AstNode | null)[];
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        if (el.type === "RestElement") {
          bindPattern(el.argument as AstNode, seq.slice(i), scope, declareConst, ctx);
          return;
        }
        bindPattern(el, seq[i], scope, declareConst, ctx);
      }
      return;
    }
    case "ObjectPattern": {
      const obj = (value ?? {}) as Record<string, unknown>;
      const taken = new Set<string>();
      for (const prop of pattern.properties as AstNode[]) {
        if (prop.type === "RestElement") {
          const rest: Record<string, unknown> = {};
          for (const k of Object.keys(obj)) if (!taken.has(k)) rest[k] = obj[k];
          bindPattern(prop.argument as AstNode, rest, scope, declareConst, ctx);
          continue;
        }
        const key = propKeyName(prop);
        taken.add(key);
        bindPattern(prop.value as AstNode, obj?.[key], scope, declareConst, ctx);
      }
      return;
    }
    default:
      throw new JsError(`unsupported binding pattern: ${pattern.type}`);
  }
}

// A default value in a pattern is evaluated lazily; patterns are bound
// synchronously, so defaults must be simple (no awaited tool calls in a default).
function evalDefaultSync(node: AstNode, scope: Scope): unknown {
  // Common cheap cases only; anything async in a default is a rare footgun.
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") {
    const r = scope.lookup(node.name as string);
    return r.found ? r.value : undefined;
  }
  if (node.type === "ArrayExpression" && (node.elements as AstNode[]).length === 0) return [];
  if (node.type === "ObjectExpression" && (node.properties as AstNode[]).length === 0) return {};
  throw new JsError("default parameter/binding values must be simple literals ([], {}, a constant, or a name).");
}

function propKeyName(prop: AstNode): string {
  const k = prop.key as AstNode;
  if (prop.computed) {
    if (k.type === "Literal") return String(k.value);
    throw new JsError("computed keys in destructuring patterns must be string literals.");
  }
  if (k.type === "Identifier") return k.name as string;
  if (k.type === "Literal") return String(k.value);
  throw new JsError("unsupported property key in destructuring.");
}

// ── statements ─────────────────────────────────────────────────────────────

async function execBlockBody(body: AstNode[], scope: Scope, ctx: EvalCtx): Promise<unknown> {
  hoistFunctions(body, scope, ctx);
  let last: unknown;
  for (const stmt of body) last = await evalStmt(stmt, scope, ctx);
  return last;
}

function hoistFunctions(body: AstNode[], scope: Scope, ctx: EvalCtx): void {
  for (const stmt of body) {
    if (stmt.type === "FunctionDeclaration") {
      const name = (stmt.id as AstNode).name as string;
      scope.declare(name, makeClosure(stmt, scope), false);
    }
  }
  void ctx;
}

function makeClosure(node: AstNode, scope: Scope): Closure {
  const body = node.body as AstNode;
  const exprBody = node.type === "ArrowFunctionExpression" && body.type !== "BlockStatement";
  const name = (node.id as AstNode | undefined)?.name as string | undefined;
  return new Closure(node.params as AstNode[], body, exprBody, scope, name ?? "anonymous");
}

async function evalStmt(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  switch (node.type) {
    case "ExpressionStatement":
      return evalExpr(node.expression as AstNode, scope, ctx);
    case "VariableDeclaration": {
      const isConst = node.kind === "const";
      for (const decl of node.declarations as AstNode[]) {
        const value = decl.init ? await evalExpr(decl.init as AstNode, scope, ctx) : undefined;
        bindPattern(decl.id as AstNode, value, scope, isConst, ctx);
      }
      return undefined;
    }
    case "FunctionDeclaration":
      return undefined; // already hoisted
    case "BlockStatement":
      return execBlockBody(node.body as AstNode[], scope.child(), ctx);
    case "EmptyStatement":
      return undefined;
    case "IfStatement": {
      if (truthy(await evalExpr(node.test as AstNode, scope, ctx))) {
        return evalStmt(node.consequent as AstNode, scope, ctx);
      } else if (node.alternate) {
        return evalStmt(node.alternate as AstNode, scope, ctx);
      }
      return undefined;
    }
    case "WhileStatement": {
      let last: unknown;
      while (truthy(await evalExpr(node.test as AstNode, scope, ctx))) {
        chargeFuel(ctx);
        checkAbort(ctx);
        try {
          last = await evalStmt(node.body as AstNode, scope.child(), ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) break;
          if (sig instanceof ContinueSignal) continue;
          throw sig;
        }
      }
      return last;
    }
    case "DoWhileStatement": {
      let last: unknown;
      do {
        chargeFuel(ctx);
        checkAbort(ctx);
        try {
          last = await evalStmt(node.body as AstNode, scope.child(), ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) break;
          if (sig instanceof ContinueSignal) continue;
          throw sig;
        }
      } while (truthy(await evalExpr(node.test as AstNode, scope, ctx)));
      return last;
    }
    case "ForStatement": {
      const forScope = scope.child();
      let last: unknown;
      if (node.init) {
        if ((node.init as AstNode).type === "VariableDeclaration") await evalStmt(node.init as AstNode, forScope, ctx);
        else await evalExpr(node.init as AstNode, forScope, ctx);
      }
      while (node.test ? truthy(await evalExpr(node.test as AstNode, forScope, ctx)) : true) {
        chargeFuel(ctx);
        checkAbort(ctx);
        try {
          last = await evalStmt(node.body as AstNode, forScope.child(), ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) break;
          if (!(sig instanceof ContinueSignal)) throw sig;
        }
        if (node.update) await evalExpr(node.update as AstNode, forScope, ctx);
      }
      return last;
    }
    case "ForOfStatement": {
      const iterable = await evalExpr(node.right as AstNode, scope, ctx);
      const seq = toIterable(iterable);
      let last: unknown;
      for (const item of seq) {
        chargeFuel(ctx);
        checkAbort(ctx);
        const iterScope = scope.child();
        const left = node.left as AstNode;
        if (left.type === "VariableDeclaration") {
          bindPattern((left.declarations as AstNode[])[0].id as AstNode, item, iterScope, left.kind === "const", ctx);
        } else {
          await assignTo(left, item, iterScope, ctx);
        }
        try {
          last = await evalStmt(node.body as AstNode, iterScope, ctx);
        } catch (sig) {
          if (sig instanceof BreakSignal) break;
          if (!(sig instanceof ContinueSignal)) throw sig;
        }
      }
      return last;
    }
    case "ReturnStatement":
      throw new ReturnSignal(node.argument ? await evalExpr(node.argument as AstNode, scope, ctx) : undefined);
    case "BreakStatement":
      throw new BreakSignal();
    case "ContinueStatement":
      throw new ContinueSignal();
    case "ThrowStatement":
      throw new UserThrow(await evalExpr(node.argument as AstNode, scope, ctx));
    case "TryStatement":
      return execTry(node, scope, ctx);
    case "SwitchStatement":
      return execSwitch(node, scope, ctx);
    default:
      throw new JsError(`unsupported statement: ${node.type}`);
  }
}

async function execTry(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  let value: unknown;
  try {
    value = await evalStmt(node.block as AstNode, scope.child(), ctx);
  } catch (err) {
    if (err instanceof BudgetError || err instanceof ReturnSignal || err instanceof BreakSignal || err instanceof ContinueSignal) {
      throw err; // control flow + budget are never catchable by a program
    }
    const handler = node.handler as AstNode | null;
    if (!handler) {
      if (node.finalizer) await evalStmt(node.finalizer as AstNode, scope.child(), ctx);
      throw err;
    }
    const caughtValue = err instanceof UserThrow ? err.value : errorToValue(err);
    const catchScope = scope.child();
    if (handler.param) bindPattern(handler.param as AstNode, caughtValue, catchScope, false, ctx);
    value = await evalStmt(handler.body as AstNode, catchScope, ctx);
  }
  if (node.finalizer) await evalStmt(node.finalizer as AstNode, scope.child(), ctx);
  return value;
}

/** A host error handed to a program's catch reads as a plain `{ name, message }`. */
function errorToValue(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return err;
}

async function execSwitch(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const disc = await evalExpr(node.discriminant as AstNode, scope, ctx);
  const swScope = scope.child();
  const cases = node.cases as AstNode[];
  let matched = -1;
  for (let i = 0; i < cases.length; i++) {
    const test = cases[i].test as AstNode | null;
    if (test && strictEquals(disc, await evalExpr(test, swScope, ctx))) {
      matched = i;
      break;
    }
  }
  if (matched === -1) matched = cases.findIndex((c) => c.test === null);
  if (matched === -1) return undefined;
  let last: unknown;
  try {
    for (let i = matched; i < cases.length; i++) {
      for (const stmt of cases[i].consequent as AstNode[]) last = await evalStmt(stmt, swScope, ctx);
    }
  } catch (sig) {
    if (sig instanceof BreakSignal) return last;
    throw sig;
  }
  return last;
}

// ── expressions ────────────────────────────────────────────────────────────

async function evalExpr(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  chargeFuel(ctx);
  checkAbort(ctx);
  switch (node.type) {
    case "Literal":
      return node.regex ? new RegExp((node.regex as { pattern: string; flags: string }).pattern, (node.regex as { flags: string }).flags) : node.value;
    case "Identifier": {
      const name = node.name as string;
      if (name in BANNED_IDENTIFIERS) throw new JsError(BANNED_IDENTIFIERS[name]);
      const r = scope.lookup(name);
      if (!r.found) {
        const hint = closestName(name, scope);
        throw new JsError(`'${name}' is not defined${hint ? ` — did you mean '${hint}'?` : ""}.`);
      }
      return r.value;
    }
    case "TemplateLiteral":
      return evalTemplate(node, scope, ctx);
    case "ArrayExpression": {
      const out: unknown[] = [];
      for (const el of node.elements as (AstNode | null)[]) {
        if (!el) { out.push(undefined); continue; }
        if (el.type === "SpreadElement") out.push(...toIterable(await evalExpr(el.argument as AstNode, scope, ctx)));
        else out.push(await evalExpr(el, scope, ctx));
      }
      return out;
    }
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as AstNode[]) {
        if (prop.type === "SpreadElement") {
          const src = await evalExpr(prop.argument as AstNode, scope, ctx);
          if (src && typeof src === "object") {
            for (const k of Object.keys(src as object)) {
              if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
              out[k] = (src as Record<string, unknown>)[k];
            }
          }
          continue;
        }
        const key = await objectKey(prop, scope, ctx);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new JsError(`'${key}' cannot be used as an object key here.`);
        }
        out[key] = await evalExpr(prop.value as AstNode, scope, ctx);
      }
      return out;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return makeClosure(node, scope);
    case "UnaryExpression":
      return evalUnary(node, scope, ctx);
    case "UpdateExpression":
      return evalUpdate(node, scope, ctx);
    case "BinaryExpression":
      return evalBinary(node, scope, ctx);
    case "LogicalExpression":
      return evalLogical(node, scope, ctx);
    case "ConditionalExpression":
      return truthy(await evalExpr(node.test as AstNode, scope, ctx))
        ? evalExpr(node.consequent as AstNode, scope, ctx)
        : evalExpr(node.alternate as AstNode, scope, ctx);
    case "AssignmentExpression":
      return evalAssignment(node, scope, ctx);
    case "SequenceExpression": {
      let v: unknown;
      for (const e of node.expressions as AstNode[]) v = await evalExpr(e, scope, ctx);
      return v;
    }
    case "MemberExpression":
      return (await evalMember(node, scope, ctx)).value;
    case "ChainExpression":
      return evalExpr(node.expression as AstNode, scope, ctx);
    case "CallExpression":
      return evalCall(node, scope, ctx);
    case "NewExpression":
      return evalNew(node, scope, ctx);
    case "AwaitExpression": {
      const v = await evalExpr(node.argument as AstNode, scope, ctx);
      return v && typeof (v as { then?: unknown }).then === "function" ? await v : v;
    }
    default:
      throw new JsError(`unsupported expression: ${node.type}`);
  }
}

async function objectKey(prop: AstNode, scope: Scope, ctx: EvalCtx): Promise<string> {
  if (prop.computed) return String(await evalExpr(prop.key as AstNode, scope, ctx));
  const k = prop.key as AstNode;
  if (k.type === "Identifier") return k.name as string;
  if (k.type === "Literal") return String(k.value);
  throw new JsError("unsupported object key.");
}

async function evalTemplate(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<string> {
  const quasis = node.quasis as AstNode[];
  const exprs = node.expressions as AstNode[];
  let out = "";
  for (let i = 0; i < quasis.length; i++) {
    out += (quasis[i].value as { cooked: string }).cooked;
    if (i < exprs.length) out += stringify(await evalExpr(exprs[i], scope, ctx));
  }
  return out;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Resolve a MemberExpression to both its object and its value (so a call can
 *  reuse the object as the method receiver). */
async function evalMember(
  node: AstNode,
  scope: Scope,
  ctx: EvalCtx,
): Promise<{ object: unknown; key: string; value: unknown; short: boolean }> {
  const object = await evalExpr(node.object as AstNode, scope, ctx);
  if (node.optional && (object === null || object === undefined)) {
    return { object, key: "", value: undefined, short: true };
  }
  const key = node.computed
    ? String(await evalExpr(node.property as AstNode, scope, ctx))
    : ((node.property as AstNode).name as string);
  const value = getMember(object, key, apiFor(ctx));
  return { object, key, value, short: false };
}

async function evalCall(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const callee = node.callee as AstNode;
  const args = await evalArgs(node.arguments as AstNode[], scope, ctx);

  if (callee.type === "MemberExpression") {
    const object = await evalExpr(callee.object as AstNode, scope, ctx);
    if (callee.optional && (object === null || object === undefined)) return undefined;
    const key = callee.computed
      ? String(await evalExpr(callee.property as AstNode, scope, ctx))
      : ((callee.property as AstNode).name as string);
    if (node.optional) {
      const fnv = getMember(object, key, apiFor(ctx));
      if (fnv === null || fnv === undefined) return undefined;
    }
    return callMember(object, key, args, apiFor(ctx));
  }

  const fn = await evalExpr(callee, scope, ctx);
  if (node.optional && (fn === null || fn === undefined)) return undefined;
  if (fn instanceof HostCtor) {
    if (fn.callable) return fn.callable(args);
    throw new JsError(`${fn.name} must be called with new — write new ${fn.name}(...).`);
  }
  return applyFunction(fn, args, ctx);
}

async function evalArgs(nodes: AstNode[], scope: Scope, ctx: EvalCtx): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const a of nodes) {
    if (a.type === "SpreadElement") out.push(...toIterable(await evalExpr(a.argument as AstNode, scope, ctx)));
    else out.push(await evalExpr(a, scope, ctx));
  }
  return out;
}

async function evalNew(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const callee = await evalExpr(node.callee as AstNode, scope, ctx);
  const args = await evalArgs(node.arguments as AstNode[], scope, ctx);
  if (callee instanceof HostCtor) return callee.construct(args);
  throw new JsError("new is only supported on Set, Map, Date, RegExp, and Error.");
}

async function evalUnary(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const op = node.operator as string;
  if (op === "typeof") {
    const arg = node.argument as AstNode;
    if (arg.type === "Identifier" && !scope.has(arg.name as string) && !((arg.name as string) in BANNED_IDENTIFIERS)) {
      return "undefined";
    }
    return typeOf(await evalExpr(arg, scope, ctx));
  }
  if (op === "delete") {
    const arg = node.argument as AstNode;
    if (arg.type === "MemberExpression") {
      const object = await evalExpr(arg.object as AstNode, scope, ctx);
      const key = arg.computed ? String(await evalExpr(arg.property as AstNode, scope, ctx)) : ((arg.property as AstNode).name as string);
      return deleteMember(object, key);
    }
    return true;
  }
  const v = await evalExpr(node.argument as AstNode, scope, ctx);
  switch (op) {
    case "-": return -(v as number);
    case "+": return +(v as number);
    case "!": return !truthy(v);
    case "~": return ~(v as number);
    case "void": return undefined;
    default: throw new JsError(`unsupported unary operator '${op}'.`);
  }
}

function typeOf(v: unknown): string {
  if (v instanceof Closure || v instanceof HostCtor) return "function";
  return typeof v;
}

async function evalUpdate(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const arg = node.argument as AstNode;
  const delta = node.operator === "++" ? 1 : -1;
  if (arg.type === "Identifier") {
    const cur = Number((scope.lookup(arg.name as string).value as number) ?? NaN);
    const next = cur + delta;
    scope.assign(arg.name as string, next);
    return node.prefix ? next : cur;
  }
  if (arg.type === "MemberExpression") {
    const object = await evalExpr(arg.object as AstNode, scope, ctx);
    const key = arg.computed ? String(await evalExpr(arg.property as AstNode, scope, ctx)) : ((arg.property as AstNode).name as string);
    const cur = Number(getMember(object, key, apiFor(ctx)) as number);
    const next = cur + delta;
    setMember(object, key, next);
    return node.prefix ? next : cur;
  }
  throw new JsError("invalid target for ++/--.");
}

async function evalBinary(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const op = node.operator as string;
  if (op === "in" || op === "instanceof") {
    throw new JsError(
      `the '${op}' operator is not supported — ${op === "in" ? "use Object.keys(o).includes(k) or o.k !== undefined" : "check a discriminant property (o.type === 'x')"}.`,
    );
  }
  const l = await evalExpr(node.left as AstNode, scope, ctx);
  const r = await evalExpr(node.right as AstNode, scope, ctx);
  switch (op) {
    case "+": return (l as number) + (r as number);
    case "-": return (l as number) - (r as number);
    case "*": return (l as number) * (r as number);
    case "/": return (l as number) / (r as number);
    case "%": return (l as number) % (r as number);
    case "**": return (l as number) ** (r as number);
    case "==": return l == r; // eslint-disable-line eqeqeq
    case "!=": return l != r; // eslint-disable-line eqeqeq
    case "===": return strictEquals(l, r);
    case "!==": return !strictEquals(l, r);
    case "<": return (l as number) < (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">": return (l as number) > (r as number);
    case ">=": return (l as number) >= (r as number);
    case "&": return (l as number) & (r as number);
    case "|": return (l as number) | (r as number);
    case "^": return (l as number) ^ (r as number);
    case "<<": return (l as number) << (r as number);
    case ">>": return (l as number) >> (r as number);
    case ">>>": return (l as number) >>> (r as number);
    default: throw new JsError(`unsupported operator '${op}'.`);
  }
}

function strictEquals(a: unknown, b: unknown): boolean {
  return a === b;
}

async function evalLogical(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const l = await evalExpr(node.left as AstNode, scope, ctx);
  switch (node.operator) {
    case "&&": return truthy(l) ? evalExpr(node.right as AstNode, scope, ctx) : l;
    case "||": return truthy(l) ? l : evalExpr(node.right as AstNode, scope, ctx);
    case "??": return l === null || l === undefined ? evalExpr(node.right as AstNode, scope, ctx) : l;
    default: throw new JsError(`unsupported logical operator '${node.operator}'.`);
  }
}

async function evalAssignment(node: AstNode, scope: Scope, ctx: EvalCtx): Promise<unknown> {
  const op = node.operator as string;
  const left = node.left as AstNode;
  if (op === "=") {
    const value = await evalExpr(node.right as AstNode, scope, ctx);
    await assignTo(left, value, scope, ctx);
    return value;
  }
  // compound assignment: x += y etc. left is Identifier or MemberExpression.
  const cur = await evalExpr(left, scope, ctx);
  const rhs = await evalExpr(node.right as AstNode, scope, ctx);
  const value = applyCompound(op, cur, rhs);
  await assignTo(left, value, scope, ctx);
  return value;
}

function applyCompound(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "+=": return (l as number) + (r as number);
    case "-=": return (l as number) - (r as number);
    case "*=": return (l as number) * (r as number);
    case "/=": return (l as number) / (r as number);
    case "%=": return (l as number) % (r as number);
    case "**=": return (l as number) ** (r as number);
    case "&&=": return truthy(l) ? r : l;
    case "||=": return truthy(l) ? l : r;
    case "??=": return l === null || l === undefined ? r : l;
    case "&=": return (l as number) & (r as number);
    case "|=": return (l as number) | (r as number);
    case "^=": return (l as number) ^ (r as number);
    default: throw new JsError(`unsupported assignment operator '${op}'.`);
  }
}

async function assignTo(target: AstNode, value: unknown, scope: Scope, ctx: EvalCtx): Promise<void> {
  if (target.type === "Identifier") {
    scope.assign(target.name as string, value);
    return;
  }
  if (target.type === "MemberExpression") {
    const object = await evalExpr(target.object as AstNode, scope, ctx);
    const key = target.computed ? String(await evalExpr(target.property as AstNode, scope, ctx)) : ((target.property as AstNode).name as string);
    setMember(object, key, value);
    return;
  }
  if (target.type === "ArrayPattern" || target.type === "ObjectPattern") {
    // destructuring assignment to already-declared names
    assignPattern(target, value, scope, ctx);
    return;
  }
  throw new JsError(`invalid assignment target: ${target.type}`);
}

function assignPattern(pattern: AstNode, value: unknown, scope: Scope, ctx: EvalCtx): void {
  if (pattern.type === "Identifier") {
    scope.assign(pattern.name as string, value);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    const seq = value == null ? [] : Array.isArray(value) ? value : [...(value as Iterable<unknown>)];
    const els = pattern.elements as (AstNode | null)[];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      if (el.type === "RestElement") { assignPattern(el.argument as AstNode, seq.slice(i), scope, ctx); return; }
      assignPattern(el, seq[i], scope, ctx);
    }
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const obj = (value ?? {}) as Record<string, unknown>;
    for (const prop of pattern.properties as AstNode[]) {
      if (prop.type === "RestElement") continue;
      const key = propKeyName(prop);
      assignPattern(prop.value as AstNode, obj?.[key], scope, ctx);
    }
    return;
  }
  throw new JsError(`invalid destructuring assignment target: ${pattern.type}`);
}

// ── helpers ────────────────────────────────────────────────────────────────

export function truthy(v: unknown): boolean {
  return Boolean(v);
}

function toIterable(v: unknown): Iterable<unknown> {
  if (v === null || v === undefined) throw new JsError("value is not iterable (null or undefined).");
  if (Array.isArray(v) || typeof v === "string" || v instanceof Set || v instanceof Map) return v as Iterable<unknown>;
  throw new JsError(`value of type ${typeof v} is not iterable — for…of needs an array, string, Set, or Map.`);
}

function closestName(name: string, scope: Scope): string | undefined {
  return closest(name, scope.allNames());
}

/** Turn a thrown control value into a model-readable one-line message. */
export function formatProgramError(err: unknown): string {
  if (err instanceof UserThrow) {
    const v = err.value;
    if (v && typeof v === "object" && "message" in (v as object)) {
      return `uncaught: ${String((v as { message: unknown }).message)}`;
    }
    return `uncaught: ${typeof v === "string" ? v : stringify(v)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Run a full program; returns the completion value of the last statement (a
 *  REPL semantics — the value of the last expression, if/try/switch branch, or
 *  loop body that ran). */
export async function runProgram(program: AstNode, root: Scope, ctx: EvalCtx): Promise<unknown> {
  const body = program.body as AstNode[];
  hoistFunctions(body, root, ctx);
  let last: unknown;
  for (const stmt of body) last = await evalStmt(stmt, root, ctx);
  return last;
}
