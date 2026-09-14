/**
 * Search over any {@link Vfs} — grep, glob, and the scoring primitives the
 * metadata layer uses for content search.
 *
 * These are plain functions over the base contract rather than methods on it,
 * because every backend would otherwise reimplement the same scan. A backend
 * with a real index overrides them by implementing {@link VfsSearch}; nothing
 * here is on that path.
 */
import { globToRegExp, isUnder, normalizePath } from "./paths";
import { looksBinary, toText, type GrepMatch, type GrepSpec, type Vfs } from "./types";

/** Every file path matching a glob. `**` crosses segments, `*` does not. */
export async function glob(vfs: Vfs, pattern: string, opts?: { path?: string }): Promise<string[]> {
  const re = globToRegExp(pattern);
  const root = opts?.path ? normalizePath(opts.path) : "/";
  const files = await vfs.files();
  return files.filter((f) => isUnder(f, root) && re.test(f));
}

/**
 * Search file contents. Binary files are skipped rather than matched as
 * mojibake — a NUL-bearing file has no lines to report and every "match" in
 * one is noise.
 */
export async function grep(vfs: Vfs, spec: GrepSpec): Promise<GrepMatch[]> {
  const root = spec.path ? normalizePath(spec.path) : "/";
  const limit = spec.limit ?? 200;
  const contextLines = spec.contextLines ?? 2;
  const globRe = spec.glob ? globToRegExp(spec.glob) : null;

  let test: (line: string) => boolean;
  if (spec.regex) {
    const re = new RegExp(spec.query, spec.caseSensitive ? "" : "i");
    test = (line) => re.test(line);
  } else if (spec.caseSensitive) {
    test = (line) => line.includes(spec.query);
  } else {
    const needle = spec.query.toLowerCase();
    test = (line) => line.toLowerCase().includes(needle);
  }

  const out: GrepMatch[] = [];
  for (const path of await vfs.files()) {
    if (out.length >= limit) break;
    if (!isUnder(path, root)) continue;
    if (globRe && !globRe.test(path)) continue;
    const bytes = await vfs.read(path);
    if (looksBinary(bytes)) continue;
    const lines = toText(bytes).split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (!test(lines[i])) continue;
      out.push({
        path,
        line: i + 1,
        text: lines[i],
        context:
          contextLines > 0
            ? {
                before: lines.slice(Math.max(0, i - contextLines), i),
                after: lines.slice(i + 1, i + 1 + contextLines),
              }
            : undefined,
      });
    }
  }
  return out;
}

/** Cosine similarity, mapped into [0,1] so it can be blended with recency. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return (dot / (Math.sqrt(na) * Math.sqrt(nb)) + 1) / 2;
}

const WORD = /[a-z0-9]+/g;

function tokens(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

/**
 * Token-overlap relevance in [0,1] — the embedding-free fallback.
 *
 * Not a ranking function anyone would ship as a search engine, but it is the
 * difference between "content search works with no external service" and
 * "content search is unavailable", which is the choice a dev/test tree
 * actually faces.
 */
export function lexicalScore(query: string, text: string): number {
  const q = new Set(tokens(query));
  if (q.size === 0) return 0;
  const t = tokens(text);
  if (t.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const tok of t) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  let hit = 0;
  for (const term of q) if (counts.has(term)) hit++;
  const coverage = hit / q.size;
  // A long document that happens to contain every term should not beat a
  // short one that is about them.
  const density = Math.min(1, (hit * 8) / t.length);
  return coverage * 0.8 + density * 0.2;
}

/** Exponential decay with a 30-day half-life, matching the memory layer. */
export function recencyScore(updatedAt: string, now = Date.now()): number {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 0;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, days / 30);
}
