/**
 * The two markdown markers worth honouring in a chat bubble.
 *
 * Models write `**bold**` and `` `code` `` constantly, and left raw they are
 * the single roughest thing on the screen. A full markdown renderer is a
 * dependency and a security surface for a gain of about this much, so this
 * handles the two markers and leaves everything else as written text.
 */
import type { ReactNode } from "react";

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

export function formatInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    if (token.startsWith("`")) {
      // Code spans are literal — a `**` inside one is content, not emphasis.
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      // Bold recurses: models routinely write **`/out/report.pdf`**, and
      // treating the inner text as flat leaves the backticks on screen.
      out.push(<strong key={key++}>{formatInline(token.slice(2, -2))}</strong>);
    }
    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
