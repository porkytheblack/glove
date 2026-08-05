/**
 * A ~40-line JavaScript tokenizer, for display only.
 *
 * The alternative was a syntax-highlighting library, which is 200KB+ for a
 * panel that shows one function at a time. This is deliberately approximate:
 * it can mis-colour a regex literal or a `${}` inside a template. Nothing
 * downstream depends on it being right, and being wrong is invisible unless
 * you are looking for it.
 */
import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "await", "async", "break", "case", "catch", "class", "const", "continue", "default", "delete",
  "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in",
  "instanceof", "let", "new", "of", "return", "static", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "yield", "true", "false", "null", "undefined",
]);

// Ordered: comments and strings first, so a `//` inside neither is a comment
// and a keyword inside a string stays a string.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/gi;

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(code.slice(last, at));
    const [text, comment, string, num, word] = m;

    if (comment) out.push(<span key={key++} className="t-com">{text}</span>);
    else if (string) out.push(<span key={key++} className="t-str">{text}</span>);
    else if (num) out.push(<span key={key++} className="t-num">{text}</span>);
    else if (word && KEYWORDS.has(word)) out.push(<span key={key++} className="t-key">{text}</span>);
    else if (word && code[at + text.length] === "(") out.push(<span key={key++} className="t-fn">{text}</span>);
    else out.push(text);

    last = at + text.length;
  }

  if (last < code.length) out.push(code.slice(last));
  return out;
}
