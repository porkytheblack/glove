/**
 * Editing text inside a deck that already exists.
 *
 * pptxgenjs cannot open a .pptx, so "fix the typo on slide 4" has, until now,
 * meant rebuilding the whole deck from the text `extract()` recovered — which
 * is a different deck. Measured on a deck this package wrote: the rebuild lost
 * `ppt/media/image-3-1.png` and the footer's slide layout, and every visual
 * choice the original made that our `DeckSpec` cannot express went with them.
 *
 * This edits the package instead. One slide part is inflated, its text runs
 * are spliced, and the part goes back; every other part is copied across still
 * compressed. What is not matched is not touched.
 *
 * The splicing itself is the interesting half. PowerPoint stores a line as a
 * sequence of `<a:r>` runs and starts a new one wherever formatting changes,
 * so the sentence a person sees as "Northwind renewed early" is routinely
 * `<a:t>Northwind renewed</a:t>` + `<a:t> early</a:t>` — and a per-element
 * replace of "renewed early" finds nothing. The runs of a paragraph are
 * therefore joined, matched as one string, and written back onto the runs they
 * came from: the replacement goes wholly into the run the match started in, so
 * it inherits that run's font, size and colour, and the runs around it are
 * re-emitted unchanged.
 */

export interface ReplaceRule {
  find: string;
  replace: string;
}

export interface PartEdit {
  xml: string;
  /** Occurrences replaced, per rule, in the order the rules were given. */
  perRule: number[];
  count: number;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function encodeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Run {
  start: number;
  end: number;
  /** Attributes as written, including the leading space, or "". */
  attrs: string;
  text: string;
}

const RUN_RE = /<a:t((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/a:t>)/g;
/** `<a:p>` and `<a:p/>` opens, `</a:p>` closes — and never `<a:pPr>`. */
const PARAGRAPH_RE = /<a:p(?=[\s/>])[^>]*>|<\/a:p>/g;

/**
 * Group text runs by the innermost paragraph holding them.
 *
 * A stack rather than a `<a:p>…</a:p>` regex because paragraphs nest: a table
 * cell, a grouped shape and a chart's own text all carry paragraphs, and a
 * non-greedy match closes the outer one at the inner `</a:p>`. That would join
 * the opening of one line to the text of an unrelated cell and could match a
 * phrase that does not exist anywhere on the slide.
 */
function paragraphRuns(xml: string): Run[][] {
  const runs: Run[] = [];
  for (const m of xml.matchAll(RUN_RE)) {
    runs.push({ start: m.index, end: m.index + m[0].length, attrs: m[1] ?? "", text: decodeXmlText(m[2] ?? "") });
  }
  if (runs.length === 0) return [];

  const marks = [...xml.matchAll(PARAGRAPH_RE)]
    .map((m) => ({ at: m.index, open: m[0][1] !== "/", selfClosing: m[0].endsWith("/>") }))
    .filter((m) => !(m.open && m.selfClosing));

  const groups: Run[][] = [];
  const stack: Run[][] = [];
  let mark = 0;
  for (const run of runs) {
    while (mark < marks.length && marks[mark].at < run.start) {
      const m = marks[mark++];
      if (m.open) stack.push([]);
      else {
        const closed = stack.pop();
        if (closed && closed.length > 0) groups.push(closed);
      }
    }
    if (stack.length > 0) stack[stack.length - 1].push(run);
    else groups.push([run]);
  }
  for (const open of stack) if (open.length > 0) groups.push(open);
  return groups;
}

interface Match {
  start: number;
  end: number;
  replacement: string;
  rule: number;
}

/**
 * Every occurrence, left to right, never overlapping.
 *
 * One pass over the text rather than one pass per rule, so renames cannot
 * cascade: `{ Acme: 'Globex', Globex: 'Initech' }` leaves the original Acme as
 * Globex, where running the rules in sequence would carry it on to Initech.
 * At any position the first rule that matches wins.
 */
function findMatches(text: string, rules: ReplaceRule[]): Match[] {
  const out: Match[] = [];
  for (let i = 0; i < text.length; ) {
    let hit: Match | null = null;
    for (let r = 0; r < rules.length; r++) {
      if (text.startsWith(rules[r].find, i)) {
        hit = { start: i, end: i + rules[r].find.length, replacement: rules[r].replace, rule: r };
        break;
      }
    }
    if (hit) {
      out.push(hit);
      i = hit.end;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Re-emit a run with new text, keeping its attributes.
 *
 * Deliberately without the `xml:space="preserve"` that the WordprocessingML
 * side of this problem needs: `<a:t>` has no such convention, DrawingML
 * preserves run whitespace as written, and adding the attribute here would put
 * a foreign one into every edited slide.
 */
function emitRun(attrs: string, text: string): string {
  return `<a:t${attrs}>${encodeXmlText(text)}</a:t>`;
}

/**
 * Replace text in one slide, layout, master or notes part.
 *
 * Matching is literal, case-sensitive, and does not cross a paragraph
 * boundary: two paragraphs are two lines on the slide as well as in the file,
 * and joining them would let a replacement swallow the line break.
 */
export function replaceInPart(xml: string, rules: ReplaceRule[]): PartEdit {
  const perRule = rules.map(() => 0);
  if (rules.length === 0) return { xml, perRule, count: 0 };

  const edits = new Map<number, { end: number; xml: string }>();
  let count = 0;

  for (const group of paragraphRuns(xml)) {
    const joined = group.map((r) => r.text).join("");
    const matches = findMatches(joined, rules);
    if (matches.length === 0) continue;

    // joined-offset → index of the run it came from.
    const owner = new Int32Array(joined.length);
    let at = 0;
    group.forEach((run, i) => {
      for (let k = 0; k < run.text.length; k++) owner[at++] = i;
    });

    const pieces = group.map(() => "");
    let m = 0;
    for (let i = 0; i < joined.length; ) {
      if (m < matches.length && i === matches[m].start) {
        pieces[owner[i]] += matches[m].replacement;
        perRule[matches[m].rule]++;
        count++;
        i = matches[m].end;
        m++;
      } else {
        pieces[owner[i]] += joined[i];
        i++;
      }
    }

    group.forEach((run, i) => {
      if (pieces[i] === run.text) return;
      edits.set(run.start, { end: run.end, xml: emitRun(run.attrs, pieces[i]) });
    });
  }

  if (edits.size === 0) return { xml, perRule, count: 0 };

  const out: string[] = [];
  let cursor = 0;
  for (const start of [...edits.keys()].sort((a, b) => a - b)) {
    const edit = edits.get(start)!;
    out.push(xml.slice(cursor, start), edit.xml);
    cursor = edit.end;
  }
  out.push(xml.slice(cursor));
  return { xml: out.join(""), perRule, count };
}

/**
 * Normalise the two shapes a caller may pass, and refuse the ones that cannot
 * mean anything.
 *
 * An empty `find` matches at every position, which would splice the
 * replacement between every pair of characters on the slide. It is always a
 * mistake, and it produces a plausible-looking deck, so it is refused rather
 * than performed.
 */
export function normalizeRules(input: unknown, label = "replacements"): ReplaceRule[] {
  const rules: ReplaceRule[] = [];
  const push = (find: unknown, replace: unknown, where: string) => {
    if (typeof find !== "string" || find === "") {
      throw new TypeError(`${where}: \`find\` must be a non-empty string, got ${JSON.stringify(find)}`);
    }
    if (typeof replace !== "string") {
      throw new TypeError(`${where}: \`replace\` must be a string, got ${JSON.stringify(replace)}`);
    }
    rules.push({ find, replace });
  };

  if (Array.isArray(input)) {
    input.forEach((item, i) => {
      if (!item || typeof item !== "object") {
        throw new TypeError(`${label}[${i}] must be { find, replace }, got ${typeof item}`);
      }
      const rule = item as { find?: unknown; replace?: unknown };
      push(rule.find, rule.replace, `${label}[${i}]`);
    });
  } else if (input && typeof input === "object") {
    for (const [find, replace] of Object.entries(input as Record<string, unknown>)) {
      push(find, replace, `${label}[${JSON.stringify(find)}]`);
    }
  } else {
    throw new TypeError(
      `${label} must be { 'old text': 'new text' } or [{ find, replace }], got ${input === null ? "null" : typeof input}`,
    );
  }

  if (rules.length === 0) throw new TypeError(`${label} is empty — nothing to replace`);
  return rules;
}

/** Turn `4`, `[2, 4]` or undefined into 0-based slide indices, checked against the deck. */
export function parseSlides(spec: number | number[] | undefined, total: number): number[] {
  if (spec === undefined) return Array.from({ length: total }, (_, i) => i);
  const wanted = Array.isArray(spec) ? spec : [spec];
  if (wanted.length === 0) throw new Error("`slides` selected no slides");
  for (const n of wanted) {
    if (!Number.isInteger(n)) throw new Error(`\`slides\` must contain whole numbers, got ${JSON.stringify(n)}`);
    if (n < 1 || n > total) {
      throw new Error(`slide ${n} is out of range — the deck has ${total} slide${total === 1 ? "" : "s"} (slides are 1-based)`);
    }
  }
  return [...new Set(wanted)].sort((a, b) => a - b).map((n) => n - 1);
}
