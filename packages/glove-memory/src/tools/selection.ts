import type { GloveFoldArgs } from "glove-core";
import { MemoryToolSelectionError } from "../core/errors";

/**
 * Which tools of a surface actually get folded onto a Glove.
 *
 * Names may be given in full (`"glove_resources_read"`) or in short form
 * (`"read"`, `"add_node"`) — a short selector matches a tool whose name ends
 * with `_<selector>`.
 *
 * `allow` narrows first, then `deny` subtracts, so the two compose:
 * `{ allow: ["ls", "read", "grep", "write"], deny: ["write"] }` folds three
 * tools. A selector that matches nothing throws `MemoryToolSelectionError` —
 * a typo in a `deny` entry would otherwise leave the tool registered, which
 * is precisely what a denylist exists to prevent.
 *
 * This trims the model-facing surface. It is *not* a security boundary on
 * the data: the adapter is still fully capable, and anything else holding it
 * can still write. For resources, pair it with `withResourceAccess` when the
 * restriction has to hold structurally.
 */
export interface ToolSelection {
  /** Fold only these tools. Omit to start from the full surface. */
  allow?: string[];
  /** Remove these tools. Applied after `allow`. */
  deny?: string[];
}

/** Options accepted by every `use*` memory helper. */
export interface MemoryToolOptions {
  tools?: ToolSelection;
}

function matches(toolName: string, selector: string): boolean {
  return toolName === selector || toolName.endsWith(`_${selector}`);
}

function resolve(
  selectors: string[],
  available: Array<{ name: string }>,
): Set<string> {
  const picked = new Set<string>();
  const unknown: string[] = [];
  for (const selector of selectors) {
    const hits = available.filter((t) => matches(t.name, selector));
    if (hits.length === 0) {
      unknown.push(selector);
      continue;
    }
    for (const hit of hits) picked.add(hit.name);
  }
  if (unknown.length > 0) {
    throw new MemoryToolSelectionError(
      unknown,
      available.map((t) => t.name),
    );
  }
  return picked;
}

/**
 * Applies an allowlist / denylist to a built tool surface, preserving the
 * original order. Returns the input untouched when no selection is given.
 */
export function selectTools<T extends { name: string }>(
  tools: T[],
  selection?: ToolSelection,
): T[] {
  if (!selection || (!selection.allow && !selection.deny)) return tools;
  let out = tools;
  if (selection.allow) {
    const allowed = resolve(selection.allow, tools);
    out = out.filter((t) => allowed.has(t.name));
  }
  if (selection.deny) {
    // Resolved against the full surface, so denying something already
    // excluded by `allow` is a no-op rather than an "unknown tool" error.
    const denied = resolve(selection.deny, tools);
    out = out.filter((t) => !denied.has(t.name));
  }
  return out;
}

/** `selectTools` specialised to the fold-args shape the helpers pass around. */
export function selectFoldArgs(
  tools: Array<GloveFoldArgs<any>>,
  selection?: ToolSelection,
): Array<GloveFoldArgs<any>> {
  return selectTools(tools as Array<GloveFoldArgs<any> & { name: string }>, selection);
}
