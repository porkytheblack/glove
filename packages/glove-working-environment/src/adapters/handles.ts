/**
 * The file-handler registry: which adapter understands which file.
 *
 * Two features want this answer and neither should own it. The `describe`
 * verb needs it to route a path to the adapter that can summarise it, and
 * `ls` needs it to annotate a directory of binaries with something better
 * than a byte count. Both read from here.
 *
 * Claims are declared, not computed: an adapter states the extensions and
 * magic-byte prefixes it handles, and the registry matches them without
 * calling into adapter code. That keeps `ls` cheap enough to run over a
 * directory — annotating fifty files must not mean parsing fifty documents —
 * and it keeps a broken adapter from breaking orientation.
 */

/** What an adapter claims. Magic bytes are authoritative; extensions are a hint. */
export interface HandlesSpec {
  /** Extensions including the dot, matched case-insensitively: `[".png", ".jpg"]`. */
  extensions?: string[];
  /** Byte prefixes, each matched at `offset` (default 0). */
  magic?: Array<{ bytes: number[]; offset?: number }>;
}

export interface RegisteredHandler {
  /** Module name — `documents` for `env:documents`. */
  module: string;
  handles: HandlesSpec;
  /** The adapter's `describe(path)` binding, when it has one. */
  describe?: (path: string) => Promise<unknown>;
}

/** How a claim was made — reported so a surprising dispatch is explicable. */
export type ClaimBasis = "magic" | "extension";

export interface Claim {
  handler: RegisteredHandler;
  basis: ClaimBasis;
}

/** Bytes to read for magic matching. Every known signature fits well inside. */
export const HEAD_BYTES = 64;

export function validateHandles(handles: unknown, where: string): HandlesSpec {
  if (handles === null || typeof handles !== "object") {
    throw new TypeError(`${where}: handles must be an object with extensions and/or magic`);
  }
  const h = handles as HandlesSpec;
  if (h.extensions !== undefined) {
    if (!Array.isArray(h.extensions) || h.extensions.some((e) => typeof e !== "string")) {
      throw new TypeError(`${where}: handles.extensions must be an array of strings`);
    }
    const bad = h.extensions.find((e) => !e.startsWith("."));
    if (bad !== undefined) throw new TypeError(`${where}: handles.extensions entries must start with a dot — got ${JSON.stringify(bad)}`);
  }
  if (h.magic !== undefined) {
    if (!Array.isArray(h.magic)) throw new TypeError(`${where}: handles.magic must be an array of { bytes, offset? }`);
    for (const m of h.magic) {
      if (!m || !Array.isArray(m.bytes) || m.bytes.length === 0 || m.bytes.some((b) => typeof b !== "number" || b < 0 || b > 255)) {
        throw new TypeError(`${where}: each handles.magic entry needs a non-empty bytes array of 0–255 values`);
      }
      if (m.offset !== undefined && (typeof m.offset !== "number" || m.offset < 0)) {
        throw new TypeError(`${where}: handles.magic offset must be a non-negative number`);
      }
    }
  }
  if (h.extensions === undefined && h.magic === undefined) {
    throw new TypeError(`${where}: handles needs at least one of extensions or magic — an empty claim matches nothing`);
  }
  return h;
}

function matchesMagic(handles: HandlesSpec, head: Uint8Array): boolean {
  for (const m of handles.magic ?? []) {
    const at = m.offset ?? 0;
    if (head.byteLength < at + m.bytes.length) continue;
    let hit = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (head[at + i] !== m.bytes[i]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

function matchesExtension(handles: HandlesSpec, path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = path.slice(dot).toLowerCase();
  return (handles.extensions ?? []).some((e) => e.toLowerCase() === ext);
}

/** A module that can rasterize a file to page images. */
export interface RegisteredRenderer {
  module: string;
  renders: HandlesSpec;
  render: (input: string, outDir: string, opts?: unknown) => Promise<unknown>;
}

export class HandlerRegistry {
  private readonly entries: RegisteredHandler[] = [];
  private readonly renderers: RegisteredRenderer[] = [];

  register(entry: RegisteredHandler): void {
    this.entries.push(entry);
  }

  registerRenderer(entry: RegisteredRenderer): void {
    this.renderers.push(entry);
  }

  /** Every module that can rasterize, in registration order. */
  listRenderers(): readonly RegisteredRenderer[] {
    return this.renderers;
  }

  /** Which module can rasterize this file? Same magic-beats-extension rule. */
  renderer(path: string, head: Uint8Array): RegisteredRenderer | null {
    for (const entry of this.renderers) {
      if (matchesMagic(entry.renders, head)) return entry;
    }
    for (const entry of this.renderers) {
      if (matchesExtension(entry.renders, path)) return entry;
    }
    return null;
  }

  /** Every registered module that declares a claim, in registration order. */
  list(): readonly RegisteredHandler[] {
    return this.entries;
  }

  /**
   * Which adapter handles this file?
   *
   * Magic bytes win over extensions, across all adapters — a PDF named
   * `.docx` is a PDF, and the adapter that claims `%PDF` should get it even
   * if another claims `.docx`. Within a basis, registration order decides.
   */
  claim(path: string, head: Uint8Array): Claim | null {
    for (const handler of this.entries) {
      if (matchesMagic(handler.handles, head)) return { handler, basis: "magic" };
    }
    for (const handler of this.entries) {
      if (matchesExtension(handler.handles, path)) return { handler, basis: "extension" };
    }
    return null;
  }
}
