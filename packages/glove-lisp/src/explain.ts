/**
 * Static preview — the homoiconicity dividend. A Lisp program IS its syntax
 * tree, so "which capabilities would this touch?" is a plain tree walk: no
 * resolver runs, no side effect fires. This is the SQL emulator's `explain_sql`
 * pre-pass, except it required no parser to build — the reader already did it.
 *
 * The walk is conservative: it reports resource reads/writes it can see
 * syntactically, extracts literal argument maps where present, and flags
 * missing required keys and unknown names — the same class of feedback
 * `explain_sql` gives, before anything runs.
 */
import type { ResourceTable } from "glove-scratchpad";
import { closest } from "./env";
import { readAll } from "./reader";
import { Form, Keyword, LList, MapLit, Sym, Vec } from "./values";

export interface ExplainedTouch {
  resource: string;
  op: "read" | "insert" | "update" | "delete";
  volatility: string;
  /** Literal argument keys visible in the form (dynamic args can't be known statically). */
  args?: string[];
  /** Required-key columns not visibly bound (only reported when args are a literal map). */
  missingRequired?: string[];
}

export interface LispExplainResult {
  ok: boolean;
  touches: ExplainedTouch[];
  /** Names in call position that are neither builtins, session defs, nor resources. */
  unknown?: string[];
  /** True when the program stages/commits writes. */
  staged?: boolean;
  notes?: string[];
}

const WRITE_FNS: Record<string, "insert" | "update" | "delete"> = {
  "insert!": "insert",
  "update!": "update",
  "delete!": "delete",
};

function literalKeys(f: Form | undefined): string[] | undefined {
  if (!(f instanceof MapLit)) return undefined;
  const keys: string[] = [];
  for (const [k] of f.pairs) {
    if (k instanceof Keyword) keys.push(k.name);
    else if (typeof k === "string") keys.push(k);
  }
  return keys;
}

function resourceNameOf(f: Form | undefined): string | undefined {
  if (f instanceof Keyword) return f.name;
  if (typeof f === "string") return f;
  if (f instanceof Sym) return f.name;
  return undefined;
}

export function explainProgram(
  code: string,
  resources: Map<string, ResourceTable>,
  knownNames: Set<string>,
): LispExplainResult {
  const forms = readAll(code);
  const touches: ExplainedTouch[] = [];
  const unknown = new Set<string>();
  let staged = false;
  const notes: string[] = [];

  const touchRead = (r: ResourceTable, argMapForm: Form | undefined) => {
    const args = literalKeys(argMapForm);
    const t: ExplainedTouch = { resource: r.name, op: "read", volatility: r.volatility };
    if (args) {
      t.args = args;
      const missing = r.columns.filter((c) => c.requiredKey && !args.includes(c.name)).map((c) => c.name);
      if (missing.length) t.missingRequired = missing;
    } else if (argMapForm === undefined) {
      const missing = r.columns.filter((c) => c.requiredKey).map((c) => c.name);
      if (missing.length) t.missingRequired = missing;
    }
    touches.push(t);
  };

  const walk = (f: Form, inCallHead: boolean) => {
    if (f instanceof Vec) {
      for (const i of f.items) walk(i, false);
      return;
    }
    if (f instanceof MapLit) {
      for (const [k, v] of f.pairs) {
        walk(k, false);
        walk(v, false);
      }
      return;
    }
    if (f instanceof Sym) {
      if (inCallHead && !knownNames.has(f.name) && !resources.has(f.name) && !(f.name in WRITE_FNS)) {
        unknown.add(f.name);
      }
      return;
    }
    if (!(f instanceof LList)) return;

    const [head, ...rest] = f.items;
    if (head instanceof Sym) {
      if (head.name === "quote") return; // quoted data runs nothing
      if (head.name === "stage" || head.name === "commit!") staged = true;
      const writeOp = WRITE_FNS[head.name];
      if (writeOp) {
        const name = resourceNameOf(rest[0]);
        const r = name ? resources.get(name) : undefined;
        if (name && !r) {
          const hint = closest(name, [...resources.keys()]);
          notes.push(`unknown resource "${name}" in (${head.name} …)${hint ? ` — did you mean :${hint}?` : ""}`);
        } else if (r) {
          const t: ExplainedTouch = { resource: r.name, op: writeOp, volatility: r.volatility };
          const keys = literalKeys(writeOp === "update" ? rest[2] : rest[1]);
          if (keys) t.args = keys;
          touches.push(t);
          if (!r[writeOp]) notes.push(`resource "${r.name}" does not support ${head.name}`);
        }
      } else if (resources.has(head.name)) {
        touchRead(resources.get(head.name)!, rest[0]);
      } else if (!SPECIALS.has(head.name) && !knownNames.has(head.name)) {
        const hint = closest(head.name, [...knownNames, ...resources.keys()]);
        unknown.add(hint ? `${head.name} (did you mean ${hint}?)` : head.name);
      }
    } else {
      walk(head, true);
    }
    for (const r of rest) walk(r, false);
  };

  for (const f of forms) walk(f, false);

  const result: LispExplainResult = { ok: unknown.size === 0 && notes.length === 0, touches };
  if (unknown.size) result.unknown = [...unknown];
  if (staged) result.staged = true;
  if (notes.length) result.notes = notes;
  return result;
}

const SPECIALS = new Set([
  "quote", "if", "when", "cond", "do", "def", "defn", "fn", "let", "and", "or", "->", "->>",
  "stage", "commit!", "rollback!",
]);
