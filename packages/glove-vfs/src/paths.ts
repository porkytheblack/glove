/**
 * Virtual path handling. All environment paths are absolute, `/`-separated,
 * and normalized (no `.` / `..` segments survive normalization; `..` above
 * the root is an error).
 */

export class PathError extends Error {}

/** Normalize an absolute virtual path. Throws on relative input or escape above root. */
export function normalizePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) throw new PathError("path must be a non-empty string");
  if (!path.startsWith("/")) throw new PathError(`path must be absolute (got "${path}")`);
  if (/[\u0000-\u001f]/.test(path)) throw new PathError(`path contains control characters`);
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) throw new PathError(`path escapes the root: "${path}"`);
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return "/" + out.join("/");
}

/** Resolve a relative specifier against the directory of `fromPath`. */
export function resolveRelative(fromPath: string, spec: string): string {
  const base = dirname(normalizePath(fromPath));
  return normalizePath(base === "/" ? `/${spec}` : `${base}/${spec}`);
}

export function dirname(path: string): string {
  const p = normalizePath(path);
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

export function extname(path: string): string {
  const b = basename(path);
  const idx = b.lastIndexOf(".");
  return idx <= 0 ? "" : b.slice(idx);
}

/** True when `path` equals `prefix` or lives underneath it. */
export function isUnder(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const pre = normalizePath(prefix);
  return p === pre || p.startsWith(pre === "/" ? "/" : pre + "/");
}

/** Every ancestor directory of a path, from "/" down (excluding the path itself). */
export function ancestors(path: string): string[] {
  const p = normalizePath(path);
  const segs = p.split("/").filter(Boolean);
  const out: string[] = ["/"];
  let cur = "";
  for (let i = 0; i < segs.length - 1; i++) {
    cur += "/" + segs[i];
    out.push(cur);
  }
  return out;
}

/**
 * Mini-glob → RegExp. Supports `**` (any depth, including none), `*` (within
 * one segment), and `?` (single non-separator char). No brace or bracket
 * expressions.
 */
export function globToRegExp(pattern: string): RegExp {
  const pat = pattern.startsWith("/") ? pattern : "/" + pattern;
  let re = "^";
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        // `**/` or trailing `**` — match any number of whole segments.
        if (pat[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchGlob(pattern: string, paths: string[]): string[] {
  const re = globToRegExp(pattern);
  return paths.filter((p) => re.test(p));
}
