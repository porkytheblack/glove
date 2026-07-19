/**
 * Progressive-discovery helpers: group a flat {@link ToolFn} catalog by its
 * origin server so a surface can offer three tiers — list servers, list one
 * server's functions, read a function's schema — instead of priming every
 * signature into the prompt. Pure functions; the REPL builtins (`servers()` /
 * `fns(server)`) and the native discovery tools (`list_servers` /
 * `list_functions`) both call these so the two front doors never drift.
 */
import type { ToolFn } from "./catalog";
import { fnSignature } from "./signature";

/** The reserved MCP namespace separator (mirrors glove-mcp's `NAMESPACE_SEP`). */
const NS_SEP = "__";

// ─── Discovery builtin names (shared by every fn-mode REPL) ──────────────────
//
// Each discovery tier has TWO in-REPL names: a short one (`search`) and an
// alias matching the native discovery TOOL (`search_functions`). Models primed
// on the tool names routinely try to call `search_functions(...)` /
// `list_functions(...)` INSIDE the eval program; binding both names means the
// call lands whichever front door the model learned. One list here so glove-js,
// glove-python, and glove-lisp never drift on what's callable.

export type DiscoveryKind = "search" | "servers" | "functions" | "describe";

export interface DiscoveryBuiltin {
  /** The short REPL name (`search` / `servers` / `fns` / `describe`). */
  short: string;
  /** The native-tool-name alias (`search_functions` / `list_servers` / `list_functions` / `describe_function`). */
  alias: string;
  kind: DiscoveryKind;
  /**
   * The argument key the native tool uses, so an object-form call
   * (`search_functions({ query })`) can be read the same as a positional one
   * (`search("query")`). `servers` / `list_servers` take no argument.
   */
  argKey?: "query" | "server" | "name";
}

/** The canonical discovery builtins — short name + native-tool alias per tier. */
export const DISCOVERY_BUILTINS: readonly DiscoveryBuiltin[] = [
  { short: "search", alias: "search_functions", kind: "search", argKey: "query" },
  { short: "servers", alias: "list_servers", kind: "servers" },
  { short: "fns", alias: "list_functions", kind: "functions", argKey: "server" },
  { short: "describe", alias: "describe_function", kind: "describe", argKey: "name" },
];

/** Every reserved discovery name (short + alias) — surfaces block registering a
 *  capability under any of them, and exclude them from user-defined listings. */
export const DISCOVERY_BUILTIN_NAMES: readonly string[] = DISCOVERY_BUILTINS.flatMap(
  (b) => [b.short, b.alias],
);

/**
 * Read a discovery builtin's string argument from a REPL call that may pass
 * EITHER a positional value (`search("q")`) OR the native tool's object form
 * (`search_functions({ query: "q" })`) — some models mirror the tool schema
 * even inside the code. Returns `""` when the argument is absent.
 */
export function discoveryArg(raw: unknown, argKey: "query" | "server" | "name"): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as Record<string, unknown>)[argKey];
    return v === undefined || v === null ? "" : String(v);
  }
  return String(raw);
}

/** True when a discovery-`functions` call supplied a server (vs. "list all"). */
export function hasDiscoveryArg(raw: unknown, argKey: "query" | "server" | "name"): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return (raw as Record<string, unknown>)[argKey] != null;
  }
  return String(raw).length > 0;
}

/**
 * The server a function belongs to: its explicit `server` field, else the
 * `namespace__tool` name prefix, else `undefined` (an ungrouped stdlib-style fn).
 */
export function serverOf(fn: ToolFn): string | undefined {
  if (fn.server) return fn.server;
  const i = fn.name.indexOf(NS_SEP);
  return i > 0 && i + NS_SEP.length < fn.name.length ? fn.name.slice(0, i) : undefined;
}

export interface ServerSummary {
  name: string;
  /** One-line description, if the server provided one. */
  description?: string;
  /** How many functions this server exposes. */
  functionCount: number;
  /** A few function names, so the model has a scent before drilling in. */
  sample: string[];
}

/** Group functions by origin server, preserving first-seen order. */
export function groupByServer(fns: ToolFn[]): Map<string, ToolFn[]> {
  const groups = new Map<string, ToolFn[]>();
  for (const fn of fns) {
    const server = serverOf(fn) ?? "(ungrouped)";
    const bucket = groups.get(server);
    if (bucket) bucket.push(fn);
    else groups.set(server, [fn]);
  }
  return groups;
}

/** One row per server: name, description, count, and a small name sample. */
export function serverSummaries(fns: ToolFn[]): ServerSummary[] {
  const groups = groupByServer(fns);
  const out: ServerSummary[] = [];
  for (const [name, members] of groups) {
    const description = members.find((m) => m.serverDescription)?.serverDescription;
    out.push({
      name,
      ...(description ? { description } : {}),
      functionCount: members.length,
      sample: members.slice(0, 5).map((m) => m.name),
    });
  }
  return out;
}

/** The functions belonging to one server (by `serverOf`). */
export function fnsForServer(fns: ToolFn[], server: string): ToolFn[] {
  return fns.filter((fn) => (serverOf(fn) ?? "(ungrouped)") === server);
}

/** A server's functions as one-line signatures — the middle discovery tier. */
export function serverFunctionSignatures(fns: ToolFn[], server: string): string[] {
  return fnsForServer(fns, server).map((fn) => fnSignature(fn));
}

/**
 * Rank functions against a free-text query by WORD overlap over
 * `name + description + server` — the "jump straight to the relevant functions"
 * tier, so a model with hundreds of functions across dozens of servers needn't
 * scan them server by server. Scores by how many query words appear (weighted by
 * word length) with a bonus when the whole phrase appears contiguously; returns
 * the top matches, highest score first. Ported from glove-mcp's `matchEntries`.
 */
export function searchFns(fns: ToolFn[], query: string, limit = 10): ToolFn[] {
  const q = (query ?? "").trim().toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  if (!words.length) return fns.slice(0, limit); // empty query → an arbitrary window
  const scored: Array<{ fn: ToolFn; score: number }> = [];
  for (const fn of fns) {
    const haystack = `${fn.name} ${fn.description ?? ""} ${serverOf(fn) ?? ""} ${fn.serverDescription ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) if (haystack.includes(w)) score += w.length;
    if (q.length >= 2 && haystack.includes(q)) score += q.length; // contiguous-phrase bonus
    if (score > 0) scored.push({ fn, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.fn);
}
