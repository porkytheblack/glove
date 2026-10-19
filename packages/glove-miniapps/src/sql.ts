/**
 * Method SQL is written once, with `:name` parameters, and runs on every
 * backend. At deploy time each statement is compiled to `$n` placeholders and
 * parsed with glove-sql's parser — the engine the in-memory backend runs — so a
 * definition that deploys runs on memory, SQLite and Postgres alike, and a
 * query method that tries to write is refused before it is ever called. That
 * parse is the app's compile step, the way `solc` is a contract's.
 */

import { collectCteNames, collectRelations, parse, statementKind } from "glove-sql";
import type { MethodKind, Schema } from "./types";

export interface CompiledSql {
  /** The statement with `$1…$n` placeholders. */
  text: string;
  /** Parameter name for each placeholder, in order. */
  names: string[];
}

/** Implicit parameters every statement may use. */
export const IMPLICIT_PARAMS = ["caller", "now"] as const;

/**
 * Replace `:name` with a numbered placeholder (`$n` by default; SQLite takes
 * `?n`), leaving string literals, quoted identifiers, comments and Postgres
 * `::type` casts alone. A name used twice binds one placeholder.
 */
export function compileNamed(sql: string, placeholder: (n: number) => string = (n) => `$${n}`): CompiledSql {
  const names: string[] = [];
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // '…' with '' escapes, and "…" identifiers.
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const j = end === -1 ? n : end;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ":" && sql[i + 1] === ":") {
      out += "::";
      i += 2;
      continue;
    }
    if (ch === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      let idx = names.indexOf(name);
      if (idx === -1) {
        names.push(name);
        idx = names.length - 1;
      }
      out += placeholder(idx + 1);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, names };
}

/** Bind named values to a compiled statement's placeholders. */
export function bindValues(compiled: CompiledSql, values: Record<string, unknown>, where: string): unknown[] {
  return compiled.names.map((name) => {
    if (!(name in values)) {
      throw new SqlCheckError(`${where}: :${name} has no value (pass it as an argument, or use :caller / :now)`);
    }
    const v = values[name];
    return v === undefined ? null : v;
  });
}

export class SqlCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlCheckError";
  }
}

export interface StatementInfo {
  kind: string;
  reads: string[];
  writes: string[];
  functions: string[];
}

/**
 * The functions a method may call: those that run, with the same meaning, on
 * glove-sql, SQLite (3.35+ with math functions, as Node bundles it) and
 * Postgres — found by running each on all three, not by reading manuals.
 * It is a portability rule and an isolation one: on a shared Postgres role,
 * `set_config('search_path', …)` would otherwise reach another app's schema.
 */
export const PORTABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  "count", "sum", "avg", "min", "max",
  "coalesce", "nullif",
  "abs", "round", "floor", "ceil", "mod", "sqrt", "power", "sign",
  "lower", "upper", "length", "trim", "ltrim", "rtrim", "substr", "replace", "concat",
  "row_number", "rank", "dense_rank", "lag", "lead", "first_value",
]);

/** Schemas that are not the app's, named explicitly. glove-sql drops `public.`, so this reads the text. */
const FOREIGN_SCHEMA = /(?:\b|")(information_schema|pg_catalog|public)"?\s*\./i;

/** The statement with string literals and comments blanked, for text checks. */
function withoutLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function collectFunctions(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const x of node) collectFunctions(x, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n.k === "func" && typeof n.name === "string") out.add(n.name.toLowerCase());
  for (const v of Object.values(n)) collectFunctions(v, out);
}

/**
 * Parse one statement and report what it touches. Throws a SqlCheckError
 * naming the method when it does not parse, references a table the schema
 * does not have, or is more than one statement.
 */
export function inspectStatement(sql: string, where: string): StatementInfo {
  const { text } = compileNamed(sql);
  let stmts;
  try {
    stmts = parse(text);
  } catch (err) {
    throw new SqlCheckError(`${where}: ${(err as Error).message.replace(/^MemoryBackend(?: SQL parse error)?:\s*/, "")}`);
  }
  if (stmts.length !== 1) {
    throw new SqlCheckError(`${where}: write one statement per entry (got ${stmts.length}); use a list for several`);
  }
  const stmt = stmts[0];
  const ctes = collectCteNames(stmt);
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const rel of collectRelations(stmt)) {
    if (ctes.has(rel.name)) continue;
    (rel.role === "read" ? reads : writes).add(rel.name);
  }
  const functions = new Set<string>();
  collectFunctions(stmt, functions);
  return { kind: statementKind(stmt), reads: [...reads], writes: [...writes], functions: [...functions] };
}

const ALLOWED: Record<MethodKind, ReadonlySet<string>> = {
  query: new Set(["select"]),
  action: new Set(["select", "insert", "update", "delete"]),
};

/** The deploy-time check for one method or output statement. */
export function checkStatement(sql: string, kind: MethodKind, schema: Schema, where: string): StatementInfo {
  const info = inspectStatement(sql, where);
  if (!ALLOWED[kind].has(info.kind)) {
    throw new SqlCheckError(
      kind === "query"
        ? `${where}: a query reads only; this is a ${info.kind.toUpperCase()}. Make the method an action, or change the statement.`
        : `${where}: ${info.kind.toUpperCase()} is not allowed in a method; change the schema with a migration`,
    );
  }
  const foreign = FOREIGN_SCHEMA.exec(withoutLiterals(sql));
  if (foreign) throw new SqlCheckError(`${where}: name tables without a schema; "${foreign[1]}." is outside the app`);
  for (const f of info.functions) {
    if (!PORTABLE_FUNCTIONS.has(f)) {
      throw new SqlCheckError(
        `${where}: ${f}() does not run the same on every backend; use one of ${[...PORTABLE_FUNCTIONS].join(", ")}` +
          (f === "now" || f === "current_timestamp" ? " — and :now for the time" : ""),
      );
    }
  }
  for (const t of [...info.reads, ...info.writes]) {
    if (t.startsWith("_")) throw new SqlCheckError(`${where}: "${t}" is the runtime's table; read events with the events API`);
    if (!schema[t]) {
      const known = Object.keys(schema);
      throw new SqlCheckError(`${where}: there is no table "${t}" (tables: ${known.length ? known.join(", ") : "none"})`);
    }
  }
  return info;
}
