/**
 * Which `env:*` modules a stored script depends on.
 *
 * Used for two things that both need the answer without executing anything:
 * warning a host that restored a tree whose scripts import adapters it did
 * not register, and telling `/std/README.md` which modules are actually in
 * use.
 *
 * Lexical, like the rest of the module pipeline — `scanModule` already knows
 * which byte offsets are code and which are string content, so a `'env:fs'`
 * inside a comment or a template literal is not mistaken for an import.
 */
import { scanModule } from "../executor/scan";

const SPECIFIER_RE = /^env:[a-z][a-z0-9_-]*$/;

/**
 * Every `env:<name>` module the source statically imports.
 *
 * Dynamic `import(...)` is skipped: the specifier is an expression, so the
 * honest answer is "unknown" and a guess would produce a warning nobody can
 * act on.
 */
export function envImportsOf(src: string): string[] {
  const { mask, hits } = scanModule(src);
  const found = new Set<string>();
  const starts = hits.filter((h) => h.keyword === "import" && !h.dynamic && !h.meta).map((h) => h.index);

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : src.length;
    // String runs are exactly the stretches the scanner marked as non-code.
    let i = from;
    while (i < to) {
      if (mask[i] === 1) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < to && mask[j] === 0) j += 1;
      // The run the scanner marks includes the delimiters.
      const literal = src.slice(i, j).replace(/^['"`]/, "").replace(/['"`]$/, "");
      if (SPECIFIER_RE.test(literal)) found.add(literal.slice(4));
      i = j + 1;
    }
  }
  return [...found];
}
