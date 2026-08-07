import { ResourceAccessError } from "../core/errors";
import type { ResourceFsAdapter } from "./adapter";
import { isWithin, matchGlob, normalisePath } from "./paths";
import type {
  DirectoryEntry,
  GrepMatch,
  GrepSpec,
  ResourceBody,
  ResourceMetadata,
  ResourceSemanticSearchOpts,
  SemanticMatch,
} from "./types";
import type { Provenance } from "../core/provenance";

/**
 * How much of a path the agent is allowed to touch.
 *
 * - `"none"` — invisible. Reads are refused, and the path is filtered out of
 *   listings, grep hits, glob results, semantic matches, and reverse links.
 * - `"read"` — readable but immutable. Every mutating call is refused.
 * - `"write"` — readable and mutable. The unrestricted default.
 */
export type ResourceAccessMode = "none" | "read" | "write";

const RANK: Record<ResourceAccessMode, number> = { none: 0, read: 1, write: 2 };

/**
 * One entry in an access policy.
 *
 * `path` is either an absolute directory prefix (`/research` — matches the
 * directory and everything under it) or a glob (`/**\/*.md`, `/notes/*`) using
 * the same `*` / `**` / `?` vocabulary as `glove_resources_glob`.
 */
export interface ResourceAccessRule {
  path: string;
  access: ResourceAccessMode;
  /** Free-form rationale, surfaced to the model in tool descriptions. */
  note?: string;
}

export interface ResourceAccessPolicy {
  /**
   * Applied to any path no rule matches. Defaults to `"write"` — an
   * allowlist-shaped policy sets this to `"none"` (or `"read"`) and opens up
   * specific subtrees with rules.
   */
  default?: ResourceAccessMode;
  /**
   * Evaluated in order, **last match wins** — same cascade as `.gitignore`.
   * Write the broad rule first and the exception after it.
   */
  rules?: ResourceAccessRule[];
  /**
   * Append a plain-language summary of the policy to the resource tool
   * descriptions, so the model doesn't burn turns discovering the walls.
   * Default true.
   */
  describe?: boolean;
}

interface CompiledRule {
  pattern: string;
  isGlob: boolean;
  /** Directory prefix before the first wildcard — the rule's territory. */
  literalPrefix: string;
  access: ResourceAccessMode;
  note?: string;
}

function compileRule(rule: ResourceAccessRule): CompiledRule {
  const isGlob = /[*?]/.test(rule.path);
  if (!isGlob) {
    const path = normalisePath(rule.path);
    return { pattern: path, isGlob: false, literalPrefix: path, access: rule.access, note: rule.note };
  }
  // Globs aren't normalisable (`**` segments survive, but `//` collapse and
  // the leading-slash check still apply), so validate the literal head only.
  const head = rule.path.slice(0, rule.path.search(/[*?]/));
  const cut = head.lastIndexOf("/");
  const literalPrefix = normalisePath(cut <= 0 ? "/" : head.slice(0, cut));
  return {
    pattern: rule.path,
    isGlob: true,
    literalPrefix,
    access: rule.access,
    note: rule.note,
  };
}

function ruleMatches(rule: CompiledRule, path: string): boolean {
  return rule.isGlob ? matchGlob(rule.pattern, path) : isWithin(rule.pattern, path);
}

/**
 * A compiled access policy. Resolves a mode for any path, and answers the
 * two questions the decorator asks on every call: may this be read, and may
 * this be written.
 */
export class ResourceAccessControl {
  readonly defaultAccess: ResourceAccessMode;
  readonly describe: boolean;
  private readonly rules: CompiledRule[];

  constructor(policy: ResourceAccessPolicy = {}) {
    this.defaultAccess = policy.default ?? "write";
    this.describe = policy.describe !== false;
    this.rules = (policy.rules ?? []).map(compileRule);
  }

  /** True when the policy leaves everything open — nothing to enforce. */
  get unrestricted(): boolean {
    return this.defaultAccess === "write" && this.rules.every((r) => r.access === "write");
  }

  /** The mode in force for `path`. Last matching rule wins. */
  modeFor(path: string): ResourceAccessMode {
    const normalised = normalisePath(path);
    let mode = this.defaultAccess;
    for (const rule of this.rules) {
      if (ruleMatches(rule, normalised)) mode = rule.access;
    }
    return mode;
  }

  canRead(path: string): boolean {
    return RANK[this.modeFor(path)] >= RANK.read;
  }

  canWrite(path: string): boolean {
    return this.modeFor(path) === "write";
  }

  /**
   * True when a directory should still be listed even though it isn't
   * readable itself — because a rule opens something beneath it. Without
   * this, `{ default: "none", rules: [{ path: "/research/**", access:
   * "read" }] }` would hide `/research` from `ls /` and strand the subtree
   * the policy just granted.
   */
  canTraverse(path: string): boolean {
    if (this.canRead(path)) return true;
    const normalised = normalisePath(path);
    return this.rules.some(
      (r) => r.access !== "none" && isWithin(normalised, r.literalPrefix),
    );
  }

  assertRead(path: string): void {
    if (!this.canRead(path)) {
      throw new ResourceAccessError(normalisePath(path), "read", this.modeFor(path));
    }
  }

  assertWrite(path: string): void {
    if (!this.canWrite(path)) {
      throw new ResourceAccessError(normalisePath(path), "write", this.modeFor(path));
    }
  }

  /**
   * True when `path` **and every possible descendant** are writable — the
   * bar a recursive delete or a directory move has to clear, so `remove("/",
   * true)` can't take a read-only subtree with it.
   *
   * Conservative by construction: a non-write rule whose territory merely
   * *intersects* the subtree fails the check, even if no file currently
   * matches it.
   */
  subtreeWritable(path: string): boolean {
    const normalised = normalisePath(path);
    if (!this.canWrite(normalised)) return false;
    for (const rule of this.rules) {
      if (rule.access === "write") continue;
      // Territories intersect if either contains the other.
      if (isWithin(normalised, rule.literalPrefix) || isWithin(rule.literalPrefix, normalised)) {
        return false;
      }
    }
    if (this.defaultAccess === "write") return true;
    // Default is restrictive, so the whole subtree has to be covered by a
    // prefix rule (a glob only covers the paths it happens to match).
    return this.rules.some(
      (r) => r.access === "write" && !r.isGlob && isWithin(r.pattern, normalised),
    );
  }

  assertSubtreeWritable(path: string, operation: string): void {
    if (this.subtreeWritable(path)) return;
    const normalised = normalisePath(path);
    throw new ResourceAccessError(
      normalised,
      "write",
      this.modeFor(normalised),
      `Access denied: ${operation} on "${normalised}" would reach paths the active access policy protects.`,
    );
  }

  /** Drops the paths the policy hides. Used to filter search-shaped results. */
  filterPaths<T>(items: T[], pathOf: (item: T) => string): T[] {
    return items.filter((item) => this.canRead(pathOf(item)));
  }

  /** Plain-language summary for tool descriptions. Empty when unrestricted. */
  render(): string {
    if (this.unrestricted) return "";
    const lines = ["Access policy (enforced — calls outside it are refused):"];
    for (const rule of this.rules) {
      lines.push(`- ${rule.pattern} — ${describeMode(rule.access)}${rule.note ? ` (${rule.note})` : ""}`);
    }
    lines.push(`- everything else — ${describeMode(this.defaultAccess)}`);
    if (this.rules.length > 0) {
      lines.push("Rules are evaluated in order; the last one that matches a path wins.");
    }
    return lines.join("\n");
  }
}

function describeMode(mode: ResourceAccessMode): string {
  if (mode === "write") return "read and write";
  if (mode === "read") return "read-only (writes are refused)";
  return "no access";
}

/** A `ResourceFsAdapter` carrying the access policy it enforces. */
export interface AccessControlledResourceFsAdapter extends ResourceFsAdapter {
  readonly accessControl: ResourceAccessControl;
}

/** Returns the access policy an adapter enforces, or undefined when it's unwrapped. */
export function getResourceAccessControl(
  adapter: ResourceFsAdapter,
): ResourceAccessControl | undefined {
  const control = (adapter as Partial<AccessControlledResourceFsAdapter>).accessControl;
  return control instanceof ResourceAccessControl ? control : undefined;
}

/**
 * Wraps a `ResourceFsAdapter` so every call is checked against a path-scoped
 * access policy — read-only research directories, off-limits subtrees, an
 * allowlist of the few places the agent may write.
 *
 * Enforcement lives on the **adapter**, not on the tool surface, for the same
 * reason the reader / curator split does: it's structural. Whichever tools
 * you fold, and whatever the model asks for, a write into a `"read"` path is
 * refused with `ResourceAccessError`. Filtering the tool list (see
 * `ToolSelection`) removes the affordance; this removes the capability. They
 * compose — use both.
 *
 * Reads that return many paths (`ls`, `grep`, `glob`, `searchSemantic`,
 * `linksFor`) filter hidden paths out of their results rather than failing,
 * so a policy narrows what the agent sees instead of breaking navigation.
 *
 * The embedding lifecycle (`findFilesNeedingEmbedding` / `setEmbedding`) is
 * passed through unfiltered: it runs out-of-band on the host's behalf, not
 * the agent's, and a read-only directory still needs its index maintained.
 *
 * ```ts
 * const resources = withResourceAccess(new InMemoryResourcesAdapter({ schema }), {
 *   default: "none",
 *   rules: [
 *     { path: "/research", access: "read", note: "curated by the research team" },
 *     { path: "/notes", access: "write" },
 *   ],
 * });
 * useResourcesCurator(glove, resources);
 * ```
 */
export function withResourceAccess(
  adapter: ResourceFsAdapter,
  policy: ResourceAccessPolicy | ResourceAccessControl,
): AccessControlledResourceFsAdapter {
  const control =
    policy instanceof ResourceAccessControl ? policy : new ResourceAccessControl(policy);

  const wrapped: AccessControlledResourceFsAdapter = {
    identifier: adapter.identifier,
    schema: adapter.schema,
    supportsSemanticSearch: adapter.supportsSemanticSearch,
    accessControl: control,

    // ─── Read ───────────────────────────────────────────────────────────

    async list(path: string, opts?: { recursive?: boolean; limit?: number }): Promise<DirectoryEntry[]> {
      if (!control.canTraverse(path)) {
        throw new ResourceAccessError(normalisePath(path), "read", control.modeFor(path));
      }
      const entries = await adapter.list(path, opts);
      return entries.filter((e) =>
        e.kind === "directory" ? control.canTraverse(e.path) : control.canRead(e.path),
      );
    },

    async read(path, opts) {
      control.assertRead(path);
      return adapter.read(path, opts);
    },

    async stat(path) {
      control.assertRead(path);
      return adapter.stat(path);
    },

    async exists(path) {
      // Existence is information. An unreadable path reports absent rather
      // than throwing, so `exists` can't be used to probe hidden subtrees.
      if (!control.canRead(path)) return false;
      return adapter.exists(path);
    },

    // ─── Search ─────────────────────────────────────────────────────────

    async grep(spec: GrepSpec): Promise<GrepMatch[]> {
      if (spec.path !== undefined && !control.canTraverse(spec.path)) {
        throw new ResourceAccessError(normalisePath(spec.path), "read", control.modeFor(spec.path));
      }
      const matches = await adapter.grep(spec);
      return control.filterPaths(matches, (m) => m.path);
    },

    async glob(pattern: string, opts?: { path?: string; limit?: number }): Promise<string[]> {
      if (opts?.path !== undefined && !control.canTraverse(opts.path)) {
        throw new ResourceAccessError(normalisePath(opts.path), "read", control.modeFor(opts.path));
      }
      const paths = await adapter.glob(pattern, opts);
      return control.filterPaths(paths, (p) => p);
    },

    // ─── Write ──────────────────────────────────────────────────────────

    async write(
      path: string,
      body: ResourceBody,
      metadata: ResourceMetadata,
      provenance: Provenance,
    ): Promise<void> {
      control.assertWrite(path);
      return adapter.write(path, body, metadata, provenance);
    },

    async edit(path, oldStr, newStr, provenance) {
      control.assertWrite(path);
      return adapter.edit(path, oldStr, newStr, provenance);
    },

    async mkdir(path, provenance) {
      control.assertWrite(path);
      return adapter.mkdir(path, provenance);
    },

    async move(fromPath, toPath, provenance) {
      control.assertWrite(fromPath);
      control.assertWrite(toPath);
      // Moving a directory relocates everything under it, so it has to clear
      // the same bar as a recursive delete.
      const stat = await adapter.stat(fromPath);
      if (stat?.kind === "directory") {
        control.assertSubtreeWritable(fromPath, "moving a directory");
      }
      return adapter.move(fromPath, toPath, provenance);
    },

    async remove(path, recursive, provenance) {
      control.assertWrite(path);
      if (recursive) control.assertSubtreeWritable(path, "a recursive remove");
      return adapter.remove(path, recursive, provenance);
    },

    async setMetadata(path, patch, provenance) {
      control.assertWrite(path);
      return adapter.setMetadata(path, patch, provenance);
    },

    // ─── Reverse linking and bulk rewrite ───────────────────────────────

    async linksFor(targetKind, targetId) {
      const paths = await adapter.linksFor(targetKind, targetId);
      return control.filterPaths(paths, (p) => p);
    },

    async replaceLinkTarget(fromKind, fromId, toId, provenance) {
      // An untargeted rewrite across the whole tree can't be checked
      // path-by-path up front. It's an orchestrator primitive (no tool
      // exposes it), so under a restrictive policy it's refused outright
      // rather than silently writing into protected paths — reconciliation
      // runs against the unwrapped adapter.
      if (!control.unrestricted) {
        throw new ResourceAccessError(
          "/",
          "write",
          control.defaultAccess,
          "Access denied: replaceLinkTarget rewrites the whole tree and can't be scoped by an access policy. Run reconciliation against the unwrapped adapter.",
        );
      }
      return adapter.replaceLinkTarget(fromKind, fromId, toId, provenance);
    },
  };

  if (adapter.searchSemantic) {
    wrapped.searchSemantic = async (
      query: string,
      opts?: ResourceSemanticSearchOpts,
    ): Promise<SemanticMatch[]> => {
      if (opts?.path !== undefined && !control.canTraverse(opts.path)) {
        throw new ResourceAccessError(normalisePath(opts.path), "read", control.modeFor(opts.path));
      }
      const matches = await adapter.searchSemantic!(query, opts);
      return control.filterPaths(matches, (m) => m.path);
    };
  }

  // Embedding lifecycle — host-side, deliberately unfiltered.
  if (adapter.findFilesNeedingEmbedding) {
    wrapped.findFilesNeedingEmbedding = (opts) => adapter.findFilesNeedingEmbedding!(opts);
  }
  if (adapter.setEmbedding) {
    wrapped.setEmbedding = (path, vector) => adapter.setEmbedding!(path, vector);
  }

  return wrapped;
}
