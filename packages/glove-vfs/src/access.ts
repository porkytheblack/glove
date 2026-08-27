/**
 * Path-scoped access control over any {@link Vfs}.
 *
 * Two separate ideas already existed in Glove — the working environment's
 * `readOnlyPaths` and the memory layer's `withResourceAccess` — solving the
 * same problem at two different altitudes. This is the one implementation,
 * placed at the filesystem, which is the only place where it binds every
 * surface at once: model verbs, scripts, REPL calls and host handles all end
 * up here, so there is no path that enforces the rule and no path that
 * forgets to.
 *
 * ```ts
 * const fenced = withAccess(fs, {
 *   default: "none",
 *   rules: [
 *     { path: "/corpus", access: "read", note: "curated upstream" },
 *     { path: "/work", access: "write" },
 *     { path: "/**\/*.locked.md", access: "read" },
 *   ],
 * });
 * ```
 *
 * ## The two rules people trip over
 *
 * - **A listing filters; a named path refuses.** `ls` of a directory
 *   containing hidden files simply does not show them, so an allowlisted
 *   tree is navigable rather than a minefield of errors. But `read` of a
 *   path you were not granted is an explicit refusal, not an empty result —
 *   guessing at hidden names must not be a probe that returns "no such
 *   file" for real files and for forbidden ones alike, and it must not
 *   silently succeed either.
 * - **Traversal is not read access.** Directories on the way down to a
 *   granted subtree stay listable so the grant is reachable, but that says
 *   nothing about their own contents.
 */
import { globToRegExp, isUnder, normalizePath, PathError } from "./paths";
import type { Vfs, VfsEntry, VfsStat } from "./types";

export type Access = "write" | "read" | "none";

export interface AccessRule {
  /** An absolute directory prefix, or a glob (`*`, `**`, `?`). */
  path: string;
  access: Access;
  /** Surfaced in the refusal, so the agent learns why rather than retrying. */
  note?: string;
}

export interface AccessPolicy {
  /** Applied where no rule matches. Default `"write"`. */
  default?: Access;
  /** Cascade **last-match-wins** — a later rule overrides an earlier one. */
  rules?: AccessRule[];
}

export class AccessError extends PathError {
  readonly code = "access_denied";
}

interface CompiledRule {
  raw: string;
  access: Access;
  note?: string;
  /** Set for glob rules; prefix rules match structurally instead. */
  re?: RegExp;
}

function compile(policy: AccessPolicy): { fallback: Access; rules: CompiledRule[] } {
  const rules = (policy.rules ?? []).map((r) => {
    const isGlob = /[*?]/.test(r.path);
    return {
      raw: r.path,
      access: r.access,
      note: r.note,
      re: isGlob ? globToRegExp(r.path) : undefined,
    };
  });
  return { fallback: policy.default ?? "write", rules };
}

function matches(rule: CompiledRule, path: string): boolean {
  return rule.re ? rule.re.test(path) : isUnder(path, normalizePath(rule.raw));
}

/** The effective access for one path. Exported so hosts can render a policy. */
export function accessFor(policy: AccessPolicy, path: string): Access {
  const { fallback, rules } = compile(policy);
  return resolve({ fallback, rules }, normalizePath(path));
}

function resolve(compiled: { fallback: Access; rules: CompiledRule[] }, path: string): Access {
  let access = compiled.fallback;
  for (const rule of compiled.rules) if (matches(rule, path)) access = rule.access;
  return access;
}

function noteFor(compiled: { fallback: Access; rules: CompiledRule[] }, path: string): string | undefined {
  let note: string | undefined;
  for (const rule of compiled.rules) if (matches(rule, path)) note = rule.note;
  return note;
}

class GuardedFs implements Vfs {
  private readonly compiled: { fallback: Access; rules: CompiledRule[] };

  constructor(
    readonly inner: Vfs,
    policy: AccessPolicy,
  ) {
    this.compiled = compile(policy);
  }

  private access(path: string): Access {
    return resolve(this.compiled, normalizePath(path));
  }

  private refuse(path: string, op: string, required: "read" | "write"): never {
    const p = normalizePath(path);
    const note = noteFor(this.compiled, p);
    const why =
      required === "read"
        ? `${p} is not readable under this filesystem's access policy`
        : `${p} is read-only under this filesystem's access policy`;
    throw new AccessError(`cannot ${op} ${p}: ${why}${note ? ` (${note})` : ""}`);
  }

  private needRead(path: string, op: string): void {
    if (this.access(path) === "none") this.refuse(path, op, "read");
  }

  private needWrite(path: string, op: string): void {
    const a = this.access(path);
    if (a === "none") this.refuse(path, op, "read");
    if (a === "read") this.refuse(path, op, "write");
  }

  /**
   * True when anything at or below `path` is visible — which is what keeps a
   * `default: "none"` policy navigable down to the subtrees it does grant.
   */
  private traversable(path: string): boolean {
    const p = normalizePath(path);
    if (this.access(p) !== "none") return true;
    return this.compiled.rules.some((r) => r.access !== "none" && isUnder(normalizePath(r.re ? stripGlob(r.raw) : r.raw), p));
  }

  async read(path: string): Promise<Uint8Array> {
    this.needRead(path, "read");
    return this.inner.read(path);
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.needWrite(path, "write");
    return this.inner.write(path, data);
  }

  async rm(path: string): Promise<void> {
    this.needWrite(path, "remove");
    const p = normalizePath(path);
    const stat = await this.inner.stat(p);
    if (stat?.kind === "dir") {
      // A recursive remove that would reach a protected path is refused
      // whole rather than partially applied — a half-deleted tree is worse
      // than a refusal, and the agent cannot tell which half went.
      for (const f of await this.inner.files()) {
        if (!isUnder(f, p)) continue;
        const a = this.access(f);
        if (a !== "write") {
          throw new AccessError(
            `cannot remove ${p}: it contains ${f}, which is ${a === "none" ? "not readable" : "read-only"} under this filesystem's access policy`,
          );
        }
      }
    }
    return this.inner.rm(p);
  }

  async mkdir(path: string): Promise<void> {
    this.needWrite(path, "mkdir");
    return this.inner.mkdir(path);
  }

  async exists(path: string): Promise<boolean> {
    // Reports false rather than throwing: `exists` is the question you ask
    // BEFORE you know whether you may look, and an exception there turns
    // every guarded tree into a minefield.
    if (this.access(path) === "none") return false;
    return this.inner.exists(path);
  }

  async stat(path: string): Promise<VfsStat | null> {
    if (this.access(path) === "none") return null;
    return this.inner.stat(path);
  }

  async list(path: string): Promise<VfsEntry[]> {
    const p = normalizePath(path);
    if (!this.traversable(p)) this.refuse(p, "list", "read");
    const entries = await this.inner.list(p);
    const prefix = p === "/" ? "/" : p + "/";
    return entries.filter((e) => {
      const child = prefix + e.name;
      return e.kind === "dir" ? this.traversable(child) : this.access(child) !== "none";
    });
  }

  async files(): Promise<string[]> {
    const all = await this.inner.files();
    return all.filter((f) => this.access(f) !== "none");
  }

  async totalSize(): Promise<number> {
    // Deliberately the whole tree's size, not the visible slice: this number
    // exists to enforce a storage budget, and a policy must not let an agent
    // write past one by hiding what it already spent.
    return this.inner.totalSize();
  }
}

/** The literal prefix of a glob, up to its first wildcard segment. */
function stripGlob(pattern: string): string {
  const segs = normalizePath(pattern.startsWith("/") ? pattern : "/" + pattern).split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (/[*?]/.test(s)) break;
    out.push(s);
  }
  const joined = out.join("/");
  return joined === "" ? "/" : joined;
}

/**
 * Wrap a filesystem so every call is checked by path. Enforcement is on the
 * filesystem, not on a tool list, so a write into a read-only folder is
 * refused whichever surface asks.
 */
export function withAccess(vfs: Vfs, policy: AccessPolicy): Vfs {
  return new GuardedFs(vfs, policy);
}

/** Render a policy for a prompt or an orientation file. */
export function describeAccess(policy: AccessPolicy): string {
  const lines = [`default: ${policy.default ?? "write"}`];
  for (const r of policy.rules ?? []) {
    lines.push(`${r.path} — ${r.access}${r.note ? ` (${r.note})` : ""}`);
  }
  return lines.join("\n");
}
