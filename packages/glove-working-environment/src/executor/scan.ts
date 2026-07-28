/**
 * A small lexical scanner for JavaScript module source. It does NOT parse —
 * it produces a code mask (which characters are real code vs. string /
 * comment / template-text / regex literal), bracket depth per position, and
 * the positions of `import` / `export` keywords the transform cares about.
 *
 * Good enough by construction: static import/export declarations are only
 * legal at module top level (depth 0), which is exactly where we look.
 */

export interface KeywordHit {
  index: number;
  keyword: "import" | "export";
  /** Bracket depth ((), [], {} combined, template interpolations included). */
  depth: number;
  /** For `import` — true when it is a dynamic `import(...)` call. */
  dynamic: boolean;
  /** For `import` — true when it is `import.meta`. */
  meta: boolean;
}

export interface ScanResult {
  /** mask[i] === 1 → source[i] is code (not string/comment/template-text/regex body). */
  mask: Uint8Array;
  hits: KeywordHit[];
}

const REGEX_ALLOWED_AFTER = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "<", ">", "+", "-", "*", "/", "%", "^", "~",
]);
const REGEX_ALLOWED_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

const isIdChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

export function scanModule(src: string): ScanResult {
  const n = src.length;
  const mask = new Uint8Array(n);
  const hits: KeywordHit[] = [];

  // Mode stack: "code" entries carry the bracket depth at which their
  // template interpolation opened, so `}` can close back into the template.
  type Mode = { kind: "code" | "template"; openDepth: number };
  const stack: Mode[] = [{ kind: "code", openDepth: 0 }];
  let depth = 0;
  let lastMeaningful = ""; // last non-whitespace code char
  let lastWord = ""; // last identifier-ish word seen in code

  let i = 0;
  while (i < n) {
    const mode = stack[stack.length - 1];
    const c = src[i];

    if (mode.kind === "template") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        depth += 1;
        stack.push({ kind: "code", openDepth: depth });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // code mode
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "template", openDepth: depth });
      i += 1;
      continue;
    }
    if (c === "/") {
      // regex literal vs. division
      const regexPos =
        lastMeaningful === "" ||
        REGEX_ALLOWED_AFTER.has(lastMeaningful) ||
        (isIdChar(lastMeaningful) && REGEX_ALLOWED_AFTER_WORD.has(lastWord));
      if (regexPos) {
        i += 1;
        let inClass = false;
        while (i < n) {
          const r = src[i];
          if (r === "\\") {
            i += 2;
            continue;
          }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          else if (r === "\n") break; // malformed; bail out of the literal
          i += 1;
        }
        i += 1; // closing slash
        while (i < n && /[a-z]/i.test(src[i])) i += 1; // flags
        lastMeaningful = ")"; // a regex is an operand
        lastWord = "";
        continue;
      }
      mask[i] = 1;
      lastMeaningful = c;
      lastWord = "";
      i += 1;
      continue;
    }

    mask[i] = 1;

    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (c === "}" && mode.openDepth === depth && stack.length > 1) {
        // closes a template interpolation
        depth -= 1;
        stack.pop();
        i += 1;
        lastMeaningful = "`"; // resume template — treat as operand-ish
        continue;
      }
      depth -= 1;
    }

    if (isIdChar(c)) {
      const prev = i > 0 ? src[i - 1] : "";
      if (!isIdChar(prev)) {
        // start of a word — read it
        let j = i;
        while (j < n && isIdChar(src[j])) j += 1;
        const word = src.slice(i, j);
        for (let k = i; k < j; k++) mask[k] = 1;
        if (word === "import" || word === "export") {
          const prevMeaningful = lastMeaningful;
          // find next non-ws char after the word
          let m = j;
          while (m < n && /\s/.test(src[m])) m += 1;
          const next = src[m] ?? "";
          const dynamic = word === "import" && next === "(";
          const meta = word === "import" && next === ".";
          if (prevMeaningful !== ".") {
            hits.push({ index: i, keyword: word, depth, dynamic, meta });
          }
        }
        lastWord = word;
        lastMeaningful = word[word.length - 1];
        i = j;
        continue;
      }
    }

    if (!/\s/.test(c)) {
      lastMeaningful = c;
      if (!isIdChar(c)) lastWord = "";
    }
    i += 1;
  }

  return { mask, hits };
}

/** Index of the delimiter matching the opener at `openIdx` (must be a code position). */
export function matchDelim(src: string, mask: Uint8Array, openIdx: number): number {
  const open = src[openIdx];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (!mask[i]) continue;
    const c = src[i];
    if (c === open) d += 1;
    else if (c === close) {
      d -= 1;
      if (d === 0) return i;
    }
  }
  return -1;
}

export function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line += 1;
  return line;
}
