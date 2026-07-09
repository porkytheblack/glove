/**
 * Parse with @lezer/python (the acorn-lineage Python parser: pure JS, no WASM,
 * handles f-strings + comprehensions), then adapt its concrete syntax tree into
 * the normalized {@link Module} AST the interpreter walks. Anything outside the
 * supported subset is rejected here with a targeted message — the boundary is
 * explicit, the way glove-js's whitelist validator is.
 */
import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import { PyError } from "./errors";
import type { Expr, Generator, Handler, Module, Param, SliceNode, Stmt } from "./ast";

const REJECT: Record<string, string> = {
  ImportStatement: "import is not supported — this REPL has no module system.",
  FromImportStatement: "import is not supported — this REPL has no module system.",
  ClassDefinition: "classes are not supported — use plain functions, dicts, and lists.",
  WithStatement: "with-statements are not supported.",
  GlobalStatement: "global is not supported.",
  NonlocalStatement: "nonlocal is not supported.",
  DeleteStatement: "del is not supported.",
  YieldExpression: "generators / yield are not supported.",
  YieldStatement: "generators / yield are not supported.",
  DecoratedStatement: "decorators are not supported.",
  ScopeStatement: "global/nonlocal is not supported.",
};

function txt(src: string, n: SyntaxNode): string {
  return src.slice(n.from, n.to);
}

/** Direct children of a node, in order. */
function kids(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** Skip punctuation/keyword tokens, keeping the meaningful child nodes. */
const PUNCT = new Set(["(", ")", "[", "]", "{", "}", ",", ":", ";", ".", "Comment"]);

export function parseProgram(code: string): Module {
  const tree = parser.parse(code);
  // Lezer marks syntax errors with a `⚠` node.
  const cur = tree.cursor();
  do {
    if (cur.node.type.isError) {
      const at = code.slice(Math.max(0, cur.node.from - 10), cur.node.from + 10).replace(/\n/g, " ");
      throw new PyError(`syntax error near "…${at}…"`);
    }
  } while (cur.next());

  const body: Stmt[] = [];
  for (const c of kids(tree.topNode)) {
    if (c.type.name === "Comment") continue;
    body.push(stmt(code, c));
  }
  return { body };
}

// ── statements ───────────────────────────────────────────────────────────────

function block(src: string, bodyNode: SyntaxNode | null): Stmt[] {
  if (!bodyNode) return [];
  const out: Stmt[] = [];
  for (const c of kids(bodyNode)) {
    if (c.type.name === "Comment" || c.type.name === ":") continue;
    out.push(stmt(src, c));
  }
  return out;
}

function stmt(src: string, n: SyntaxNode): Stmt {
  const t = n.type.name;
  if (REJECT[t]) throw new PyError(REJECT[t]);
  if (kids(n).some((k) => k.type.name === "async"))
    throw new PyError("async / await is not supported — tool calls resolve synchronously.");
  switch (t) {
    case "AssignStatement":
      return assignStmt(src, n);
    case "UpdateStatement": {
      const c = kids(n);
      return { kind: "AugAssign", target: expr(src, c[0]), op: txt(src, c[1]), value: expr(src, c[2]) };
    }
    case "ExpressionStatement":
      return { kind: "ExprStmt", value: expr(src, firstExpr(n)) };
    case "IfStatement":
      return ifStmt(src, n);
    case "ForStatement":
      return forStmt(src, n);
    case "WhileStatement": {
      const test = expr(src, nodeAfter(n, "while"));
      return { kind: "While", test, body: block(src, child(n, "Body")), orelse: elseBlock(src, n) };
    }
    case "FunctionDefinition": {
      const name = txt(src, child(n, "VariableName")!);
      return { kind: "FunctionDef", name, params: params(src, child(n, "ParamList")), body: block(src, child(n, "Body")) };
    }
    case "ReturnStatement": {
      const v = kids(n).find((k) => k.type.name !== "return" && !PUNCT.has(k.type.name));
      return { kind: "Return", value: v ? expr(src, v) : null };
    }
    case "RaiseStatement": {
      const v = kids(n).find((k) => k.type.name !== "raise" && !PUNCT.has(k.type.name));
      return { kind: "Raise", exc: v ? expr(src, v) : null };
    }
    case "TryStatement":
      return tryStmt(src, n);
    case "BreakStatement":
      return { kind: "Break" };
    case "ContinueStatement":
      return { kind: "Continue" };
    case "PassStatement":
      return { kind: "Pass" };
    default:
      throw new PyError(`unsupported statement: ${t}`);
  }
}

function assignStmt(src: string, n: SyntaxNode): Stmt {
  // children: target [, target]* (= group)+ value  — split on AssignOp "="
  const groups: SyntaxNode[][] = [[]];
  for (const c of kids(n)) {
    if (c.type.name === "AssignOp") groups.push([]);
    else if (c.type.name === "Comment") continue;
    else groups[groups.length - 1].push(c);
  }
  const valueGroup = groups.pop()!;
  const value = groupExpr(src, valueGroup);
  const targets = groups.map((g) => groupExpr(src, g));
  return { kind: "Assign", targets, value };
}

/** A comma-separated group → a single expr, or a Tuple if it has commas. */
function groupExpr(src: string, group: SyntaxNode[]): Expr {
  const exprs = group.filter((c) => c.type.name !== "," && !PUNCT.has(c.type.name));
  if (exprs.length === 1) return expr(src, exprs[0]);
  return { kind: "Tuple", elts: exprs.map((e) => expr(src, e)) };
}

function ifStmt(src: string, n: SyntaxNode): Stmt {
  const c = kids(n);
  const test = expr(src, c[find(c, "if") + 1]);
  const bodies = c.filter((k) => k.type.name === "Body");
  const body = block(src, bodies[0]);
  // elif / else
  let orelse: Stmt[] = [];
  const elifIdx = c.findIndex((k) => k.type.name === "elif");
  const elseIdx = c.findIndex((k) => k.type.name === "else");
  if (elifIdx >= 0) {
    // Build a nested If from the first elif onward.
    const test2 = expr(src, c[elifIdx + 1]);
    const body2 = block(src, bodies[1]);
    const rest = elseIdx >= 0 ? block(src, bodies[bodies.length - 1]) : [];
    orelse = [{ kind: "If", test: test2, body: body2, orelse: rest }];
  } else if (elseIdx >= 0) {
    orelse = block(src, bodies[1]);
  }
  return { kind: "If", test, body, orelse };
}

function forStmt(src: string, n: SyntaxNode): Stmt {
  const c = kids(n);
  const inIdx = find(c, "in");
  const targetNodes = c.slice(1, inIdx).filter((k) => k.type.name !== ",");
  const target: Expr =
    targetNodes.length === 1 ? expr(src, targetNodes[0]) : { kind: "Tuple", elts: targetNodes.map((k) => expr(src, k)) };
  const iter = expr(src, c[inIdx + 1]);
  return { kind: "For", target, iter, body: block(src, child(n, "Body")), orelse: elseBlock(src, n) };
}

function tryStmt(src: string, n: SyntaxNode): Stmt {
  const c = kids(n);
  const bodies = c.filter((k) => k.type.name === "Body");
  let bi = 0;
  const body = block(src, bodies[bi++]);
  const handlers: Handler[] = [];
  let orelse: Stmt[] = [];
  let finalbody: Stmt[] = [];
  for (let i = 0; i < c.length; i++) {
    const name = c[i].type.name;
    if (name === "except") {
      // except [Type [as Name]] : Body
      let typ: Expr | null = null;
      let asName: string | null = null;
      let j = i + 1;
      if (c[j] && c[j].type.name !== ":" && c[j].type.name !== "as" && c[j].type.name !== "Body") typ = expr(src, c[j++]);
      if (c[j] && c[j].type.name === "as") asName = txt(src, c[j + 1]);
      handlers.push({ type: typ, name: asName, body: block(src, bodies[bi++]) });
    } else if (name === "else") {
      orelse = block(src, bodies[bi++]);
    } else if (name === "finally") {
      finalbody = block(src, bodies[bi++]);
    }
  }
  return { kind: "Try", body, handlers, orelse, finalbody };
}

function elseBlock(src: string, n: SyntaxNode): Stmt[] {
  const c = kids(n);
  const elseIdx = c.findIndex((k) => k.type.name === "else");
  if (elseIdx < 0) return [];
  const bodies = c.filter((k) => k.type.name === "Body");
  return block(src, bodies[bodies.length - 1]);
}

function params(src: string, paramList: SyntaxNode | null): Param[] {
  if (!paramList) return [];
  const out: Param[] = [];
  const c = kids(paramList);
  for (let i = 0; i < c.length; i++) {
    const k = c[i];
    if (k.type.name === "VariableName") {
      let def: Expr | null = null;
      if (c[i + 1] && c[i + 1].type.name === "AssignOp") {
        def = expr(src, c[i + 2]);
        i += 2;
      }
      out.push({ name: txt(src, k), default: def });
    } else if (k.type.name === "*" || k.type.name === "**") {
      throw new PyError("*args / **kwargs parameters are not supported.");
    }
  }
  return out;
}

// ── expressions ──────────────────────────────────────────────────────────────

function expr(src: string, n: SyntaxNode): Expr {
  const t = n.type.name;
  if (REJECT[t]) throw new PyError(REJECT[t]);
  switch (t) {
    case "VariableName":
      return { kind: "Name", id: txt(src, n) };
    case "Number":
      return { kind: "Num", value: parseNumber(txt(src, n)) };
    case "String":
      return { kind: "Str", value: decodeString(txt(src, n)) };
    case "FormatString":
      return fstring(src, n);
    case "Boolean":
      return { kind: "Const", value: txt(src, n) === "True" };
    case "None":
      return { kind: "Const", value: null };
    case "ArrayExpression":
      return { kind: "List", elts: elements(src, n) };
    case "TupleExpression":
      return { kind: "Tuple", elts: elements(src, n) };
    case "SetExpression":
      return { kind: "Set", elts: elements(src, n) };
    case "DictionaryExpression":
      return dict(src, n);
    case "ArrayComprehensionExpression":
      return comprehension(src, n, "list");
    case "SetComprehensionExpression":
      return comprehension(src, n, "set");
    case "DictionaryComprehensionExpression":
      return comprehension(src, n, "dict");
    case "ComprehensionExpression":
      return comprehension(src, n, "gen");
    case "ParenthesizedExpression": {
      const inner = kids(n).filter((k) => !PUNCT.has(k.type.name));
      if (inner.length === 1) return expr(src, inner[0]);
      return { kind: "Tuple", elts: inner.map((e) => expr(src, e)) };
    }
    case "BinaryExpression":
      return binary(src, n);
    case "UnaryExpression":
      return unary(src, n);
    case "ConditionalExpression":
      return conditional(src, n);
    case "CallExpression":
      return call(src, n);
    case "MemberExpression":
      return member(src, n);
    case "LambdaExpression":
      return lambda(src, n);
    case "ContinuedString":
      return { kind: "Str", value: kids(n).map((k) => decodeString(txt(src, k))).join("") };
    default:
      throw new PyError(`unsupported expression: ${t}`);
  }
}

function firstExpr(n: SyntaxNode): SyntaxNode {
  const e = n.firstChild;
  if (!e) throw new PyError("empty expression");
  return e;
}

function elements(src: string, n: SyntaxNode): Expr[] {
  return kids(n)
    .filter((c) => !PUNCT.has(c.type.name))
    .map((c) => {
      if (c.type.name === "*") throw new PyError("unpacking (*) in a literal is not supported.");
      return expr(src, c);
    });
}

function dict(src: string, n: SyntaxNode): Expr {
  const keys: Expr[] = [];
  const values: Expr[] = [];
  const meaningful = kids(n).filter((c) => c.type.name !== "{" && c.type.name !== "}" && c.type.name !== ",");
  // pattern: key : value  key : value  (colons are kept)
  for (let i = 0; i < meaningful.length; ) {
    if (meaningful[i].type.name === ":") {
      i++;
      continue;
    }
    const key = meaningful[i];
    const colon = meaningful[i + 1];
    if (colon && colon.type.name === ":") {
      keys.push(expr(src, key));
      values.push(expr(src, meaningful[i + 2]));
      i += 3;
    } else {
      i++;
    }
  }
  return { kind: "Dict", keys, values };
}

function comprehension(src: string, n: SyntaxNode, ctype: "list" | "set" | "dict" | "gen"): Expr {
  const c = kids(n).filter((k) => k.type.name !== "[" && k.type.name !== "]" && k.type.name !== "(" && k.type.name !== ")" && k.type.name !== "{" && k.type.name !== "}");
  // dict: key ':' value  for ... ; others: elt for ...
  const forIdx = c.findIndex((k) => k.type.name === "for");
  let elt: Expr;
  let key: Expr | null = null;
  if (ctype === "dict") {
    key = expr(src, c[0]);
    elt = expr(src, c[2]); // c[1] is ':'
  } else {
    elt = expr(src, c[0]);
  }
  const generators = parseGenerators(src, c.slice(forIdx));
  return { kind: "Comp", ctype, elt, key, generators };
}

function parseGenerators(src: string, toks: SyntaxNode[]): Generator[] {
  const gens: Generator[] = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i].type.name !== "for") {
      i++;
      continue;
    }
    i++; // 'for'
    const targetNodes: SyntaxNode[] = [];
    while (i < toks.length && toks[i].type.name !== "in") {
      if (toks[i].type.name !== ",") targetNodes.push(toks[i]);
      i++;
    }
    i++; // 'in'
    const iterNode = toks[i++];
    const ifs: Expr[] = [];
    while (i < toks.length && toks[i].type.name === "if") {
      ifs.push(expr(src, toks[i + 1]));
      i += 2;
    }
    const target: Expr =
      targetNodes.length === 1 ? expr(src, targetNodes[0]) : { kind: "Tuple", elts: targetNodes.map((t) => expr(src, t)) };
    gens.push({ target, iter: expr(src, iterNode), ifs });
  }
  return gens;
}

function binary(src: string, n: SyntaxNode): Expr {
  const c = kids(n);
  const left = expr(src, c[0]);
  const opTokens = c.slice(1, c.length - 1).map((k) => k.type.name === "CompareOp" || k.type.name === "ArithOp" || k.type.name === "BitOp" ? txt(src, k) : k.type.name);
  const right = expr(src, c[c.length - 1]);
  const op = opTokens.join(" ");
  if (op === "and" || op === "or") return { kind: "BoolOp", op, values: [left, right] };
  if (["==", "!=", "<", "<=", ">", ">=", "in", "not in", "is", "is not"].includes(op)) {
    return { kind: "Compare", left, ops: [op], comparators: [right] };
  }
  return { kind: "BinOp", op, left, right };
}

function unary(src: string, n: SyntaxNode): Expr {
  const c = kids(n);
  const op = c[0].type.name === "not" ? "not" : txt(src, c[0]);
  return { kind: "UnaryOp", op, operand: expr(src, c[1]) };
}

function conditional(src: string, n: SyntaxNode): Expr {
  const c = kids(n);
  // body 'if' test 'else' orelse
  const ifIdx = find(c, "if");
  const elseIdx = find(c, "else");
  return {
    kind: "IfExp",
    body: expr(src, c[ifIdx - 1]),
    test: expr(src, c[ifIdx + 1]),
    orelse: expr(src, c[elseIdx + 1]),
  };
}

function call(src: string, n: SyntaxNode): Expr {
  const c = kids(n);
  const func = expr(src, c[0]);
  const argList = c.find((k) => k.type.name === "ArgList");
  const args: Expr[] = [];
  const keywords: Array<{ name: string; value: Expr }> = [];
  if (argList) {
    const a = kids(argList).filter((k) => k.type.name !== "(" && k.type.name !== ")" && k.type.name !== ",");
    // generator expression as sole argument: name for name in ...
    if (a.some((k) => k.type.name === "for")) {
      const forIdx = a.findIndex((k) => k.type.name === "for");
      const gens = parseGenerators(src, a.slice(forIdx));
      args.push({ kind: "Comp", ctype: "gen", elt: expr(src, a[0]), key: null, generators: gens });
    } else {
      for (let i = 0; i < a.length; i++) {
        if (a[i].type.name === "*" || a[i].type.name === "**") {
          throw new PyError("*args / **kwargs at a call site are not supported — pass keyword arguments explicitly.");
        }
        if (a[i].type.name === "VariableName" && a[i + 1] && a[i + 1].type.name === "AssignOp") {
          keywords.push({ name: txt(src, a[i]), value: expr(src, a[i + 2]) });
          i += 2;
        } else {
          args.push(expr(src, a[i]));
        }
      }
    }
  }
  return { kind: "Call", func, args, keywords };
}

function member(src: string, n: SyntaxNode): Expr {
  const c = kids(n);
  const value = expr(src, c[0]);
  // attribute:  obj . PropertyName    subscript:  obj [ ... ]
  const prop = c.find((k) => k.type.name === "PropertyName");
  if (prop) return { kind: "Attribute", value, attr: txt(src, prop) };
  // subscript / slice — content is between [ and ]
  const open = c.findIndex((k) => k.type.name === "[");
  const inner = c.slice(open + 1, c.length - 1); // drop [ ]
  const colonAt = inner.findIndex((k) => k.type.name === ":");
  if (colonAt >= 0) {
    return { kind: "Subscript", value, slice: slice(src, inner) };
  }
  const idx = inner.find((k) => !PUNCT.has(k.type.name));
  return { kind: "Subscript", value, slice: expr(src, idx!) };
}

function slice(src: string, inner: SyntaxNode[]): SliceNode {
  // split on ':' into up to 3 parts
  const parts: (SyntaxNode | null)[] = [null, null, null];
  let part = 0;
  for (const k of inner) {
    if (k.type.name === ":") {
      part++;
      continue;
    }
    if (!PUNCT.has(k.type.name)) parts[part] = k;
  }
  return {
    kind: "Slice",
    lower: parts[0] ? expr(src, parts[0]) : null,
    upper: parts[1] ? expr(src, parts[1]) : null,
    step: parts[2] ? expr(src, parts[2]) : null,
  };
}

function lambda(src: string, n: SyntaxNode): Expr {
  const pl = child(n, "ParamList");
  const c = kids(n);
  const body = c[c.length - 1];
  return { kind: "Lambda", params: params(src, pl), body: expr(src, body) };
}

function fstring(src: string, n: SyntaxNode): Expr {
  const parts: Array<string | Expr> = [];
  const raw = txt(src, n);
  const children = kids(n);
  let cursor = n.from;
  // strip the leading f-prefix + opening quote and the closing quote by tracking
  // FormatReplacement children; literal text is whatever lies between them.
  const quoteStart = raw.search(/['"]/);
  const bodyStart = n.from + quoteStart + 1;
  cursor = bodyStart;
  for (const c of children) {
    if (c.type.name === "FormatReplacement") {
      if (c.from > cursor) parts.push(decodeFStringLiteral(src.slice(cursor, c.from)));
      // inside { ... } — first meaningful child is the expr (ignore !r / :spec)
      const inner = kids(c).filter((k) => k.type.name !== "{" && k.type.name !== "}");
      const exprNode = inner.find((k) => k.type.name !== "FormatSpec" && k.type.name !== "FormatConversion" && k.type.name !== "!" && k.type.name !== ":");
      if (exprNode) parts.push(expr(src, exprNode));
      cursor = c.to;
    }
  }
  const end = n.to - 1; // closing quote
  if (end > cursor) parts.push(decodeFStringLiteral(src.slice(cursor, end)));
  return { kind: "FString", parts };
}

// ── token helpers ────────────────────────────────────────────────────────────

function child(n: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.type.name === name) return c;
  return null;
}
function nodeAfter(n: SyntaxNode, tokenName: string): SyntaxNode {
  const c = kids(n);
  const i = find(c, tokenName);
  return c[i + 1];
}
function find(c: SyntaxNode[], name: string): number {
  return c.findIndex((k) => k.type.name === name);
}

function parseNumber(raw: string): number {
  const s = raw.replace(/_/g, "");
  if (/^0[xX]/.test(s)) return parseInt(s, 16);
  if (/^0[oO]/.test(s)) return parseInt(s.slice(2), 8);
  if (/^0[bB]/.test(s)) return parseInt(s.slice(2), 2);
  if (/[jJ]$/.test(s)) throw new PyError("complex numbers are not supported.");
  return Number(s);
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0", b: "\b", f: "\f", v: "\v" };

function decodeString(raw: string): string {
  let s = raw;
  let raw3 = false;
  const pfx = s.match(/^[rRbBuUfF]+/);
  if (pfx) {
    raw3 = /[rR]/.test(pfx[0]);
    s = s.slice(pfx[0].length);
  }
  if (s.startsWith('"""') || s.startsWith("'''")) s = s.slice(3, -3);
  else s = s.slice(1, -1);
  if (raw3) return s;
  return unescape(s);
}

function decodeFStringLiteral(s: string): string {
  return unescape(s.replace(/\{\{/g, "{").replace(/\}\}/g, "}"));
}

function unescape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const nx = s[i + 1];
      if (nx === "x") {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16));
        i += 3;
      } else if (nx === "u") {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 5;
      } else if (nx in ESCAPES) {
        out += ESCAPES[nx];
        i += 1;
      } else if (nx === "\n") {
        i += 1;
      } else {
        out += s[i];
      }
    } else {
      out += s[i];
    }
  }
  return out;
}
