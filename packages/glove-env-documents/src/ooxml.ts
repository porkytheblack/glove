/**
 * Find-and-replace inside an OOXML part, without disturbing its formatting.
 *
 * The problem this solves is that a .docx does not store "Northwind Traders"
 * anywhere. Word splits a sentence into runs wherever anything changes —
 * bold, a spell-check marker, a revision id — so the name a person sees as one
 * word is routinely `<w:t>Northwind Trad</w:t>…<w:t>ers</w:t>`, and a
 * per-element replace finds nothing at all. Measured on a document this
 * package wrote: a bold client name landed in its own run, and the sentence
 * around it in two more.
 *
 * So the text is reassembled per paragraph, matched there, and spliced back
 * onto the runs it came from: the replacement goes wholly into the run where
 * the match *started*, and the matched characters are removed from every run
 * the match touched. The replacement therefore inherits the formatting of the
 * text it replaced — a bold name stays bold, a red one stays red — and every
 * run, property, bookmark and field around it is left exactly as it was,
 * because they are never rewritten.
 */

/** Which dialect's tags to walk: `w:` for WordprocessingML, `a:` for DrawingML. */
export interface OoxmlTags {
  /** Paragraph element, without angle brackets — `w:p` or `a:p`. */
  paragraph: string;
  /** Text-run element — `w:t` or `a:t`. */
  text: string;
}

export const WORD_TAGS: OoxmlTags = { paragraph: "w:p", text: "w:t" };
export const DRAWING_TAGS: OoxmlTags = { paragraph: "a:p", text: "a:t" };

export interface ReplaceRule {
  find: string;
  replace: string;
}

export interface ReplaceResult {
  xml: string;
  /** How many occurrences were spliced, per rule, in the order given. */
  perRule: number[];
  /** Total occurrences replaced. */
  count: number;
}

export function decodeXmlText(s: string): string {
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
  /** Offsets of the whole element in the source XML. */
  start: number;
  end: number;
  /** Attributes as written, including the leading space, or "". */
  attrs: string;
  text: string;
}

/**
 * Every text run in the part, in document order.
 *
 * Only `w:t`/`a:t` — deliberately not `w:delText` (text a tracked revision
 * already deleted) and not `w:instrText` (a field's instructions, where a
 * replacement would rewrite the formula rather than the result).
 */
function findRuns(xml: string, tag: string): Run[] {
  const re = new RegExp(`<${tag}((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
  const runs: Run[] = [];
  for (const m of xml.matchAll(re)) {
    runs.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs: m[1] ?? "",
      text: decodeXmlText(m[2] ?? ""),
    });
  }
  return runs;
}

/**
 * Group runs by the innermost paragraph containing them.
 *
 * A stack rather than a `<w:p>…</w:p>` regex because paragraphs do nest: a
 * text box lives inside a run and carries paragraphs of its own. Non-greedy
 * matching ends the outer paragraph at the inner `</w:p>`, which would join
 * the outer sentence's opening runs to the text box's text and could match a
 * phrase that is not there. Grouping by the innermost open paragraph keeps
 * each body of text separate, which is what a reader sees.
 *
 * Runs outside any paragraph become groups of one, so they are still
 * searchable but never joined to anything.
 */
function groupByParagraph(xml: string, tags: OoxmlTags): Run[][] {
  const runs = findRuns(xml, tags.text);
  if (runs.length === 0) return [];

  const marks = [...xml.matchAll(new RegExp(`<${tags.paragraph}(?=[\\s/>])[^>]*>|</${tags.paragraph}>`, "g"))]
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
 * Rules are applied in one pass rather than one after another, so a rename
 * cannot cascade: `[{A→B}, {B→C}]` leaves the original A as B, where running
 * the rules in sequence would have carried it on to C. At any position the
 * first rule that matches wins, which makes the outcome a function of the
 * rules rather than of their order of execution.
 */
function findMatches(text: string, rules: ReplaceRule[]): Match[] {
  const out: Match[] = [];
  for (let i = 0; i < text.length; ) {
    let hit: Match | null = null;
    for (let r = 0; r < rules.length; r++) {
      const find = rules[r].find;
      if (text.startsWith(find, i)) {
        hit = { start: i, end: i + find.length, replacement: rules[r].replace, rule: r };
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

/** Re-emit a run with new text, keeping its attributes. */
function emitRun(tag: string, attrs: string, text: string): string {
  // Word and PowerPoint both collapse leading/trailing whitespace unless the
  // element says otherwise, so a replacement that starts or ends with a space
  // silently loses it without this.
  const needsPreserve = /^\s|\s$/.test(text) && !/\bxml:space\s*=/.test(attrs);
  return `<${tag}${attrs}${needsPreserve ? ' xml:space="preserve"' : ""}>${encodeXmlText(text)}</${tag}>`;
}

/**
 * Replace text in one OOXML part.
 *
 * Matching is literal and case-sensitive, and it does not cross a paragraph
 * boundary: a phrase broken over two paragraphs is two strings on the page as
 * well as in the file, and joining them would let a replacement delete a
 * paragraph mark.
 */
export function replaceInPart(xml: string, rules: ReplaceRule[], tags: OoxmlTags): ReplaceResult {
  const perRule = rules.map(() => 0);
  if (rules.length === 0) return { xml, perRule, count: 0 };

  /** Rewritten runs by their offset in the source, applied in one splice at the end. */
  const edits = new Map<number, { end: number; xml: string }>();
  let count = 0;

  for (const group of groupByParagraph(xml, tags)) {
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
      edits.set(run.start, { end: run.end, xml: emitRun(tags.text, run.attrs, pieces[i]) });
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
 * replacement between every pair of characters in the document. It is always
 * a mistake, and it is one that produces a plausible-looking file, so it is
 * refused rather than performed.
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
