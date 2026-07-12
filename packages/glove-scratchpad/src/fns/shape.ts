/**
 * Result-shape discovery. A {@link ToolFn}'s input schema says how to CALL it;
 * it says nothing about what a returned ROW looks like. In table mode the
 * columns are declared, so the model never guesses a field name — but a raw
 * `fnsFromMcp` catalog throws that away, and the live A/B showed models guessing
 * `.eventCount` when the field is `.count` (a silently wrong argmax).
 *
 * `sampleResultShapes` closes that gap the cheap way: call each READ-ONLY
 * function once at mount, infer a compact TS-like type from the result
 * (`{ id: string, count: number, status: "open"|"closed" }[]`), and stash it on
 * `fn.resultShape` for the surfaces to surface via `describe(...)` and the
 * primed catalog. It only samples `readOnlyHint === true` functions callable
 * with no required arguments, and swallows errors — a function whose shape can't
 * be sampled simply has none.
 */
import type { ToolFn, ToolFnContext } from "./catalog";

const MAX_FIELDS = 24;
/** A string field with ≤ this many distinct sampled values is rendered as an enum. */
const ENUM_MAX = 8;

function tsType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return v.length ? `${tsType(v[0])}[]` : "unknown[]";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

/** Render `{ field: type, … }` from a representative row, folding enum-ish string
 *  columns to their observed values across all rows. */
function objectShape(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  const keys = Object.keys(first).slice(0, MAX_FIELDS);
  const parts = keys.map((k) => {
    const vals = rows.map((r) => r?.[k]).filter((v) => v !== undefined && v !== null);
    const sample = vals[0];
    if (typeof sample === "string") {
      const strs = vals.filter((v) => typeof v === "string") as string[];
      const distinct = [...new Set(strs)];
      // Fold to an enum only when values REPEAT (distinct < count) — otherwise a
      // unique id/title with few samples looks deceptively categorical.
      if (distinct.length > 0 && distinct.length <= ENUM_MAX && distinct.length < strs.length) {
        return `${k}: ${distinct.map((s) => JSON.stringify(s)).join("|")}`;
      }
      return `${k}: string`;
    }
    return `${k}: ${tsType(sample)}`;
  });
  const more = Object.keys(first).length > MAX_FIELDS ? ", …" : "";
  return `{ ${parts.join(", ")}${more} }`;
}

/** Infer a compact TS-like description of a returned value. */
export function deriveShape(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    const objs = value.filter((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown>[];
    if (objs.length) return `${objectShape(objs)}[]`;
    return `${tsType(value[0])}[]`;
  }
  if (value && typeof value === "object") return objectShape([value as Record<string, unknown>]);
  return tsType(value);
}

/** A function has no required inputs iff its schema declares none. */
function hasNoRequired(fn: ToolFn): boolean {
  const req = (fn.inputSchema as { required?: unknown } | undefined)?.required;
  return !Array.isArray(req) || req.length === 0;
}

export interface SampleShapesOptions {
  ctx?: ToolFnContext;
  /** Also sample functions with required args, calling with `{}` (they'll usually
   *  throw and be skipped). Default false — only no-required read-only fns. */
  includeRequired?: boolean;
}

/**
 * Sample ONE function's result shape on demand: if it's read-only, callable with
 * no required args, and not already sampled, call it once and cache the inferred
 * type on `fn.resultShape`. Returns the shape (or undefined). This is the LAZY
 * path — used by `describe(...)` so a huge catalog warms only the functions the
 * model actually inspects, instead of firing hundreds of live reads at mount.
 * Safe: only `readOnlyHint === true` functions are called; errors are swallowed.
 */
export async function sampleOne(fn: ToolFn, opts: SampleShapesOptions = {}): Promise<string | undefined> {
  if (fn.resultShape) return fn.resultShape;
  if (fn.readOnlyHint !== true) return undefined;
  if (!opts.includeRequired && !hasNoRequired(fn)) return undefined;
  try {
    const shape = deriveShape(await fn.call({}, opts.ctx));
    if (shape) fn.resultShape = shape;
    return fn.resultShape;
  } catch {
    return undefined; // shape unavailable — leave it unset
  }
}

/**
 * Eagerly populate `resultShape` on every read-only function by sampling each
 * once. Mutates in place and returns them (for chaining). Use for `full`-mode /
 * small catalogs where paying the reads up front is cheap; progressive discovery
 * prefers {@link sampleOne} on demand.
 */
export async function sampleResultShapes(fns: ToolFn[], opts: SampleShapesOptions = {}): Promise<ToolFn[]> {
  await Promise.all(fns.map((fn) => sampleOne(fn, opts)));
  return fns;
}
