/**
 * Parse with acorn, then validate against a whitelist. The interpreter
 * (interp.ts) only knows how to walk a small subset of ESTree; parsing the FULL
 * language and rejecting the rest with targeted messages ("classes are not
 * supported — use plain objects") beats a hand-rolled parser that would emit
 * gibberish on the same input. acorn is a zero-transitive-dep leaf.
 *
 * Structural constructs are rejected here (class, import, with, var, generators,
 * for…in, `this`, …). Name-level and value-level safety — banned identifier
 * references (`eval`, `Function`, `globalThis`), member-access escapes
 * (`constructor`, `__proto__`), and the `new` whitelist — is enforced at eval
 * time in interp.ts / members.ts / globals.ts, where the runtime binding is
 * known and the check is precise.
 */
import { parse } from "acorn";
import { JsError } from "./errors";

export interface AstNode {
  type: string;
  [key: string]: unknown;
}

export type Program = AstNode;

/** Node types rejected outright, each with the one thing to change. */
const REJECT: Record<string, string> = {
  ImportDeclaration: "import is not supported — this REPL is a single self-contained script.",
  ImportExpression: "dynamic import() is not supported.",
  ExportNamedDeclaration: "export is not supported.",
  ExportDefaultDeclaration: "export is not supported.",
  ExportAllDeclaration: "export is not supported.",
  ClassDeclaration: "classes are not supported — use plain objects and functions.",
  ClassExpression: "classes are not supported — use plain objects and functions.",
  WithStatement: "with is not supported.",
  LabeledStatement: "labeled statements are not supported.",
  ForInStatement: "for…in is not supported — iterate keys with for (const k of Object.keys(obj)).",
  ThisExpression: "this is not available in this REPL.",
  Super: "super is not available (there are no classes).",
  YieldExpression: "generators / yield are not supported.",
  MetaProperty: "import.meta and new.target are not available.",
  TaggedTemplateExpression: "tagged template literals are not supported.",
  DebuggerStatement: "debugger is not supported.",
};

function isNode(v: unknown): v is AstNode {
  return typeof v === "object" && v !== null && typeof (v as AstNode).type === "string";
}

function validate(node: AstNode): void {
  const reason = REJECT[node.type];
  if (reason) throw new JsError(reason);

  if (node.type === "VariableDeclaration" && node.kind === "var") {
    throw new JsError("var is not supported — use const or let.");
  }
  if (
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression") &&
    node.generator === true
  ) {
    throw new JsError("generator functions (function*) are not supported.");
  }
  if (node.type === "Property" && (node.kind === "get" || node.kind === "set")) {
    throw new JsError("getters / setters in object literals are not supported.");
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) if (isNode(child)) validate(child);
    } else if (isNode(val)) {
      validate(val);
    }
  }
}

/** Parse a program and validate the whole tree before anything runs. */
export function parseProgram(code: string): Program {
  let ast: AstNode;
  try {
    // Module mode so `import`/`export` PARSE into nodes (then the validator
    // rejects them with a targeted message) instead of acorn erroring first;
    // module mode also gives top-level await for free.
    ast = parse(code, {
      ecmaVersion: 2022,
      sourceType: "module",
    }) as unknown as AstNode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new JsError(`syntax error: ${msg}`);
  }
  validate(ast);
  return ast;
}
