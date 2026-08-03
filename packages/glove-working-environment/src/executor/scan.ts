/**
 * A small lexical scanner for JavaScript module source. It does NOT parse —
 * it produces a code mask (which characters are real code vs. string /
 * comment / template-text / regex literal), bracket depth per position, and
 * the positions of `import` / `export` keywords the transform cares about.
 *
 * Good enough by construction: static import/export declarations are only
 * legal at module top level (depth 0), which is exactly where we look.
 *
 * Two invariants are easy to get wrong and both corrupt downstream depth
 * arithmetic or literal boundaries:
 *
 * - `${` and its matching `}` must be masked the SAME way. Masking only the
 *   closing brace as code leaves every interpolation contributing −1 to the
 *   bracket depth.
 * - `lastMeaningful` / `lastWord` must be updated after a string or template
 *   literal. A literal is an operand, so a `/` after it is DIVISION; leaving
 *   the pre-literal token in place makes it scan as a regex, which then eats
 *   real code (and can invert quote parity, rewriting string contents).
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
  let lastWordWasProperty = false; // that word was preceded by `.`

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
        // A template literal is an operand: a following `/` is division.
        lastMeaningful = "`";
        lastWord = "";
        lastWordWasProperty = false;
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        // Mask the opener exactly like the matching `}` below, or depth
        // arithmetic goes negative across every interpolation.
        mask[i] = 1;
        mask[i + 1] = 1;
        depth += 1;
        stack.push({ kind: "code", openDepth: depth });
        lastMeaningful = "{";
        lastWord = "";
        lastWordWasProperty = false;
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
      // A string is an operand: a following `/` is division.
      lastMeaningful = c;
      lastWord = "";
      lastWordWasProperty = false;
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
        (isIdChar(lastMeaningful) && !lastWordWasProperty && REGEX_ALLOWED_AFTER_WORD.has(lastWord));
      if (regexPos) {
        const start = i;
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n) {
          const r = src[j];
          if (r === "\\") {
            j += 2;
            continue;
          }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) {
            closed = true;
            break;
          } else if (r === "\n") break; // unterminated on this line
          j += 1;
        }
        if (closed) {
          i = j + 1; // past the closing slash
          while (i < n && /[a-z]/i.test(src[i])) i += 1; // flags
          lastMeaningful = ")"; // a regex is an operand
          lastWord = "";
          lastWordWasProperty = false;
          continue;
        }
        // Not a regex after all — fall through and treat it as division,
        // rather than swallowing the rest of the line (and the newline, and
        // the first word of the next line as "flags").
        i = start;
      }
      mask[i] = 1;
      lastMeaningful = c;
      lastWord = "";
      lastWordWasProperty = false;
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
        lastWord = "";
        lastWordWasProperty = false;
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
        const prevMeaningful = lastMeaningful;
        if (word === "import" || word === "export") {
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
        lastWordWasProperty = prevMeaningful === ".";
        lastMeaningful = word[word.length - 1];
        i = j;
        continue;
      }
    }

    if (!/\s/.test(c)) {
      lastMeaningful = c;
      if (!isIdChar(c)) {
        lastWord = "";
        lastWordWasProperty = false;
      }
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
