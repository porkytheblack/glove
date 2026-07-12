/** The normalized AST the interpreter walks — decoupled from Lezer's concrete
 *  syntax tree (parse.ts adapts one to the other). */

export type Stmt =
  | { kind: "Assign"; targets: Expr[]; value: Expr }
  | { kind: "AugAssign"; target: Expr; op: string; value: Expr }
  | { kind: "ExprStmt"; value: Expr }
  | { kind: "If"; test: Expr; body: Stmt[]; orelse: Stmt[] }
  | { kind: "For"; target: Expr; iter: Expr; body: Stmt[]; orelse: Stmt[] }
  | { kind: "While"; test: Expr; body: Stmt[]; orelse: Stmt[] }
  | { kind: "FunctionDef"; name: string; params: Param[]; body: Stmt[] }
  | { kind: "Return"; value: Expr | null }
  | { kind: "Break" }
  | { kind: "Continue" }
  | { kind: "Pass" }
  | { kind: "Raise"; exc: Expr | null }
  | { kind: "Try"; body: Stmt[]; handlers: Handler[]; orelse: Stmt[]; finalbody: Stmt[] };

export type Expr =
  | { kind: "Name"; id: string }
  | { kind: "Num"; value: number }
  | { kind: "Str"; value: string }
  | { kind: "FString"; parts: Array<string | Expr> }
  | { kind: "Const"; value: boolean | null }
  | { kind: "List"; elts: Expr[] }
  | { kind: "Tuple"; elts: Expr[] }
  | { kind: "Set"; elts: Expr[] }
  | { kind: "Dict"; keys: Expr[]; values: Expr[] }
  | { kind: "BoolOp"; op: "and" | "or"; values: Expr[] }
  | { kind: "BinOp"; op: string; left: Expr; right: Expr }
  | { kind: "UnaryOp"; op: string; operand: Expr }
  | { kind: "Compare"; left: Expr; ops: string[]; comparators: Expr[] }
  | { kind: "Call"; func: Expr; args: Expr[]; keywords: Array<{ name: string; value: Expr }> }
  | { kind: "Attribute"; value: Expr; attr: string }
  | { kind: "Subscript"; value: Expr; slice: Expr | SliceNode }
  | { kind: "IfExp"; test: Expr; body: Expr; orelse: Expr }
  | { kind: "Comp"; ctype: "list" | "set" | "dict" | "gen"; elt: Expr; key: Expr | null; generators: Generator[] }
  | { kind: "Lambda"; params: Param[]; body: Expr };

export interface SliceNode {
  kind: "Slice";
  lower: Expr | null;
  upper: Expr | null;
  step: Expr | null;
}
export interface Generator {
  target: Expr;
  iter: Expr;
  ifs: Expr[];
}
export interface Param {
  name: string;
  default: Expr | null;
}
export interface Handler {
  type: Expr | null;
  name: string | null;
  body: Stmt[];
}

export interface Module {
  body: Stmt[];
}
