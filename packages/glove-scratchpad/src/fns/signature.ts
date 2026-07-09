/**
 * Render a {@link ToolFn}'s JSON Schema for the model: a compact one-liner for
 * the primed catalog, a structured description for in-REPL `describe`, and the
 * missing-required / unknown-key checks the surfaces run before a call fires.
 *
 * Fidelity is deliberately bounded: anyOf/oneOf/$ref and deeply nested shapes
 * render as "any"/"object" — the one-liner exists to make the common call
 * correct on the first try, and `describe` carries the field descriptions
 * (where authors put enum/allowed-value hints).
 */
import type { ToolFn } from "./catalog";
import { closest } from "./shared";

export interface FnParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  enum?: unknown[];
}

export interface FnDescription {
  name: string;
  description?: string;
  params: FnParam[];
  /** True when the schema accepts keys beyond the declared params. */
  open?: boolean;
  readOnlyHint?: boolean;
}

interface SchemaView {
  props: Record<string, Record<string, unknown>>;
  required: Set<string>;
  /** Keys beyond the declared properties are acceptable (don't flag unknownKeys). */
  open: boolean;
  /** No shape information at all — render `args?`, run no checks. */
  unknown: boolean;
  /** A declared object with zero properties — render `()`, run no checks. */
  empty: boolean;
}

function schemaView(fn: ToolFn): SchemaView {
  const s = fn.inputSchema;
  if (!s || typeof s !== "object") {
    return { props: {}, required: new Set(), open: true, unknown: true, empty: false };
  }
  const hasProps = s.properties !== undefined;
  const props = (s.properties as SchemaView["props"] | undefined) ?? {};
  const required = new Set((s.required as string[] | undefined) ?? []);
  const declaredCount = Object.keys(props).length;
  const unknown = !hasProps && s.additionalProperties === undefined;
  const empty = declaredCount === 0 && !unknown;
  const open = declaredCount === 0 || s.additionalProperties === true;
  return { props, required, open, unknown, empty };
}

const MAX_ENUM_SHOWN = 6;

function enumOf(prop: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(prop.enum)) return prop.enum;
  if (prop.const !== undefined) return [prop.const];
  // anyOf/oneOf of consts (zod literal unions) → a flat enum.
  const alts = (prop.anyOf ?? prop.oneOf) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(alts) && alts.every((a) => a && a.const !== undefined)) {
    return alts.map((a) => a.const);
  }
  return undefined;
}

/** Render one property's type for the one-liner. */
function typeOf(prop: Record<string, unknown> | undefined): string {
  if (!prop) return "any";
  const en = enumOf(prop);
  if (en) {
    const shown = en.slice(0, MAX_ENUM_SHOWN).map((v) => JSON.stringify(v));
    return shown.join("|") + (en.length > MAX_ENUM_SHOWN ? "|…" : "");
  }
  const raw = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") : prop.type;
  switch (raw) {
    case "integer":
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "array": {
      const items = prop.items as Record<string, unknown> | undefined;
      const inner = items ? typeOf(items) : "any";
      return /^[a-z]+$/.test(inner) ? `${inner}[]` : "array";
    }
    case "object":
      return "object";
    default:
      return "any";
  }
}

/** Structured parameter list for in-REPL `describe`. */
export function describeFn(fn: ToolFn): FnDescription {
  const { props, required, open, unknown } = schemaView(fn);
  const params: FnParam[] = Object.entries(props)
    .sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)))
    .map(([name, prop]) => {
      const p: FnParam = { name, type: typeOf(prop) };
      if (required.has(name)) p.required = true;
      if (typeof prop.description === "string") p.description = prop.description;
      const en = enumOf(prop);
      if (en) p.enum = en;
      return p;
    });
  const out: FnDescription = { name: fn.name, params };
  if (fn.description) out.description = fn.description;
  if (open && !unknown) out.open = true;
  if (fn.readOnlyHint !== undefined) out.readOnlyHint = fn.readOnlyHint;
  return out;
}

const MAX_SIG_DESCRIPTION = 100;

/**
 * A compact JS-flavored one-liner for the primed catalog:
 *
 *     github__list_pull_requests({repo: string, state?: "open"|"closed"}) — List PRs…
 */
export function fnSignature(fn: ToolFn): string {
  const { params } = describeFn(fn);
  const { unknown } = schemaView(fn);
  const args =
    unknown && params.length === 0
      ? "args?"
      : params.length === 0
        ? ""
        : `{${params.map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`).join(", ")}}`;
  const firstLine = fn.description?.split("\n", 1)[0]?.trim();
  const desc = firstLine
    ? ` — ${firstLine.length > MAX_SIG_DESCRIPTION ? firstLine.slice(0, MAX_SIG_DESCRIPTION) + "…" : firstLine}`
    : "";
  return `${fn.name}(${args})${desc}`;
}

/** Required keys the call is missing — checked before the call fires. */
export function missingRequired(fn: ToolFn, args: Record<string, unknown>): string[] {
  const { required } = schemaView(fn);
  return [...required].filter((k) => args[k] === undefined);
}

/** Keys the schema doesn't declare (when it declares properties and isn't open),
 *  each with a did-you-mean hint. */
export function unknownKeys(
  fn: ToolFn,
  args: Record<string, unknown>,
): Array<{ key: string; hint?: string }> {
  const { props, open } = schemaView(fn);
  if (open) return [];
  const declared = Object.keys(props);
  const out: Array<{ key: string; hint?: string }> = [];
  for (const key of Object.keys(args)) {
    if (!props[key]) {
      const hint = closest(key, declared);
      out.push(hint ? { key, hint } : { key });
    }
  }
  return out;
}
