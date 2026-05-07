import { ResourceFsError } from "../core/errors";

/**
 * POSIX-style path normalisation. Trailing slashes are stripped on input
 * (the listing's `kind` field disambiguates files from directories). No
 * `.` / `..` resolution — every path is treated as absolute.
 */
export function normalisePath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new ResourceFsError("invalid_path", "Path must be a non-empty string.");
  }
  if (!input.startsWith("/")) {
    throw new ResourceFsError("invalid_path", `Path must be absolute: "${input}".`);
  }
  if (input.includes("\0")) {
    throw new ResourceFsError("invalid_path", `Path contains null byte: "${input}".`);
  }
  // Collapse repeated slashes; strip trailing slashes (except for root).
  let s = input.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.replace(/\/+$/, "");
  // Reject `.` and `..` segments — explicitly out of scope in v1.
  for (const seg of s.split("/")) {
    if (seg === "." || seg === "..") {
      throw new ResourceFsError(
        "invalid_path",
        `Path contains "." or ".." segment, which is not supported: "${input}".`,
      );
    }
  }
  return s;
}

/** Returns the parent directory, or `/` if the input is at root. */
export function parentDir(path: string): string {
  const normalised = normalisePath(path);
  if (normalised === "/") return "/";
  const idx = normalised.lastIndexOf("/");
  return idx <= 0 ? "/" : normalised.slice(0, idx);
}

/** Returns the basename (last segment) of a path. Root returns "". */
export function basename(path: string): string {
  const normalised = normalisePath(path);
  if (normalised === "/") return "";
  return normalised.slice(normalised.lastIndexOf("/") + 1);
}

/** True when `child` is at or below `parent` (`parent === "/"` matches everything). */
export function isWithin(parent: string, child: string): boolean {
  const p = normalisePath(parent);
  const c = normalisePath(child);
  if (p === "/") return true;
  if (c === p) return true;
  return c.startsWith(p + "/");
}

/**
 * Match a path against a glob pattern. Supports:
 *   - `*` — any segment characters except `/`
 *   - `**` — any number of full segments (including zero)
 *   - `?` — single character except `/`
 *
 * Globs are anchored: the entire path must match.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const re = globToRegex(pattern);
  return re.test(path);
}

function globToRegex(pattern: string): RegExp {
  // Walk the pattern character by character so `**` and `*` are handled
  // correctly without leaking into the literal-escape path.
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // **
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}
