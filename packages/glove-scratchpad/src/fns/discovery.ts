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
