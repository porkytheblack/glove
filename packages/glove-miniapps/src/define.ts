/**
 * Checking a definition before anything is stored. Every rule here fails with
 * a message that names the method or table and says what to change, because
 * the author is usually a model reading the error in its next turn.
 */

import { parseProgram } from "glove-js";
import { MiniAppError } from "./errors";
import { IDENT, SchemaError, validateSchema } from "./schema";
import { checkStatement, compileNamed, IMPLICIT_PARAMS, SqlCheckError } from "./sql";
import type { AppDefinition, MethodDef, ParamType } from "./types";

const PARAM_TYPES: readonly ParamType[] = ["string", "integer", "number", "boolean", "object", "array", "any"];

export const statements = (sql: string | string[] | undefined): string[] =>
  sql === undefined ? [] : Array.isArray(sql) ? sql : [sql];

/** Validate a definition and return it frozen. Throws MiniAppError("invalid"). */
export function defineMiniApp<T extends AppDefinition>(def: T): Readonly<T> {
  validateDefinition(def);
  return deepFreeze(structuredClone(def));
}

export function validateDefinition(def: AppDefinition): void {
  const problems: string[] = [];
  const check = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      if (err instanceof SchemaError || err instanceof SqlCheckError || err instanceof MiniAppError) problems.push(err.message);
      else problems.push((err as Error).message ?? String(err));
    }
  };

  if (!def || typeof def !== "object") throw new MiniAppError("invalid", "a definition is an object with name, description, schema and methods");
  if (typeof def.name !== "string" || !IDENT.test(def.name) || def.name.length > 40) {
    problems.push(`name ${JSON.stringify(def.name)}: lowercase letters, digits and _, starting with a letter, at most 40 characters`);
  }
  if (typeof def.description !== "string" || !def.description.trim()) {
    problems.push("description: say in one line what the app keeps track of — callers read it to decide whether to use the app");
  }
  check(() => validateSchema(def.schema));
  const schema = def.schema ?? {};

  const methods = def.methods ?? {};
  if (Object.keys(methods).length === 0) problems.push("methods: an app needs at least one method, or nothing can read or change it");
  for (const [name, m] of Object.entries(methods)) check(() => validateMethod(name, m, def));

  for (const [name, o] of Object.entries(def.outputs ?? {})) {
    check(() => {
      const where = `output "${name}"`;
      if (!IDENT.test(name)) throw new MiniAppError("invalid", `${where}: names are lowercase letters, digits and _`);
      if (!o.description?.trim()) throw new MiniAppError("invalid", `${where}: needs a description`);
      if ((o.sql === undefined) === (o.js === undefined)) throw new MiniAppError("invalid", `${where}: give exactly one of sql or js`);
      if (o.every !== undefined) parseInterval(o.every, where);
      statements(o.sql).forEach((s, i) => checkStatement(s, "query", schema, `${where}, statement ${i + 1}`));
      if (o.js !== undefined) checkJs(o.js, where);
    });
  }

  for (const [i, s] of (def.subscriptions ?? []).entries()) {
    check(() => {
      const where = `subscription ${i + 1}`;
      const [app, event, ...rest] = String(s.on ?? "").split(".");
      if (!app || !event || rest.length || !IDENT.test(app) || !IDENT.test(event)) {
        throw new MiniAppError("invalid", `${where}: "on" is "<app>.<event>", e.g. "tasks.completed"`);
      }
      const target = methods[s.run];
      if (!target) throw new MiniAppError("invalid", `${where}: "${s.run}" is not a method of this app`);
      if (target.kind !== "action") throw new MiniAppError("invalid", `${where}: "${s.run}" is a query; a subscription runs an action`);
    });
  }

  for (const [table, rows] of Object.entries(def.seed ?? {})) {
    check(() => {
      const t = schema[table];
      if (!t) throw new MiniAppError("invalid", `seed: there is no table "${table}"`);
      if (!Array.isArray(rows)) throw new MiniAppError("invalid", `seed.${table}: a list of rows`);
      for (const row of rows) {
        for (const col of Object.keys(row)) if (!t.columns[col]) throw new MiniAppError("invalid", `seed.${table}: there is no column "${col}"`);
      }
    });
  }

  if (problems.length) {
    throw new MiniAppError("invalid", `the definition of "${def.name}" has ${problems.length} problem${problems.length > 1 ? "s" : ""}`, problems);
  }
}

function validateMethod(name: string, m: MethodDef, def: AppDefinition): void {
  const where = `method "${name}"`;
  if (!IDENT.test(name)) throw new MiniAppError("invalid", `${where}: names are lowercase letters, digits and _`);
  if (m.kind !== "query" && m.kind !== "action") throw new MiniAppError("invalid", `${where}: kind is "query" (reads) or "action" (changes)`);
  if (!m.description?.trim()) throw new MiniAppError("invalid", `${where}: needs a description — it becomes the tool description`);
  if ((m.sql === undefined) === (m.js === undefined)) throw new MiniAppError("invalid", `${where}: give exactly one of sql or js`);
  for (const [p, pd] of Object.entries(m.params ?? {})) {
    if (!IDENT.test(p)) throw new MiniAppError("invalid", `${where}: parameter "${p}" — lowercase letters, digits and _`);
    if ((IMPLICIT_PARAMS as readonly string[]).includes(p)) {
      throw new MiniAppError("invalid", `${where}: "${p}" is always bound (:${p}); remove the parameter`);
    }
    if (!PARAM_TYPES.includes(pd?.type)) throw new MiniAppError("invalid", `${where}: parameter "${p}" type must be one of ${PARAM_TYPES.join(", ")}`);
  }
  if (m.js !== undefined) {
    if (m.returns !== undefined || m.emits !== undefined) {
      throw new MiniAppError("invalid", `${where}: returns and emits apply to sql methods; a js method returns its last value and calls app.emit`);
    }
    checkJs(m.js, where);
    return;
  }
  const stmts = statements(m.sql);
  if (stmts.length === 0) throw new MiniAppError("invalid", `${where}: sql is empty`);
  if (m.kind === "query" && m.emits) throw new MiniAppError("invalid", `${where}: a query cannot emit events`);
  if (m.emits !== undefined && !IDENT.test(m.emits)) throw new MiniAppError("invalid", `${where}: event names are lowercase letters, digits and _`);
  const declared = new Set([...Object.keys(m.params ?? {}), ...IMPLICIT_PARAMS]);
  stmts.forEach((s, i) => {
    const at = stmts.length > 1 ? `${where}, statement ${i + 1}` : where;
    checkStatement(s, m.kind, def.schema, at);
    // The compiler skips literals and casts, so it finds exactly the parameters.
    for (const used of compileNamed(s).names) {
      if (!declared.has(used)) throw new MiniAppError("invalid", `${at}: :${used} is not a parameter; declare it in params`);
    }
  });
}

function checkJs(code: string, where: string): void {
  try {
    parseProgram(code);
  } catch (err) {
    throw new MiniAppError("invalid", `${where}: ${(err as Error).message}`);
  }
}

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `30m`, `6h`, `1d` → milliseconds. At least five minutes. */
export function parseInterval(every: string, where = "every"): number {
  const m = /^(\d+)([mhd])$/.exec(String(every));
  if (!m) throw new MiniAppError("invalid", `${where}: every is a number and a unit, m, h or d — e.g. "30m", "6h", "1d"`);
  const ms = Number(m[1]) * UNITS[m[2]];
  if (ms < 5 * 60_000) throw new MiniAppError("invalid", `${where}: the shortest cadence is 5m`);
  return ms;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
