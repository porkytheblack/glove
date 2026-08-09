export const SLIDES_TYPES = `/** env:slides — build and read PowerPoint decks inside the VFS. */

/**
 * PptxGenJS, with its real API. Write what the library's own docs show:
 *
 *     import { PptxGenJS } from 'env:slides';
 *     const pptx = new PptxGenJS();
 *     pptx.layout = 'LAYOUT_16x9';
 *     const slide = pptx.addSlide();
 *     slide.addText('Revenue', { x: 0.5, y: 0.4, fontSize: 32, bold: true });
 *     slide.addImage({ path: '/tmp/chart.png', x: 5, y: 1.2, w: 4.5, h: 3 });
 *     slide.addTable([['Region', 'Revenue'], ['EMEA', '$2.4M']], { x: 0.5, y: 1.4, w: 5.5 });
 *     await pptx.writeFile({ fileName: '/out/deck.pptx' });
 *
 * Every call except the last is synchronous and chains as usual. Only
 * \`writeFile\` and \`write\` are async — they are what produce the file, and
 * they must be awaited. \`writeFile\` takes a VFS path; \`write\` returns bytes.
 *
 * Enums are on the instance, as in the library: \`pptx.ShapeType.rect\`,
 * \`pptx.AlignH.center\`, \`pptx.ChartType.bar\`.
 *
 * Errors are reported against the call that caused them — "call #7
 * addText(): ..." — because the deck is assembled when you write it.
 *
 * Values cannot be read back off the deck while you build it: the whole
 * recording is replayed at the write, so there is nothing to return.
 */
export const PptxGenJS: any;

export interface SlideSpec {
  /** Slide title. Rendered large at the top. */
  title: string;
  /** Bullet lines. Prefix with "  " to indent one level. */
  bullets?: string[];
  /** A paragraph of prose instead of bullets. Use one or the other. */
  body?: string;
  /** VFS path to a PNG/JPEG placed on the right half of the slide. */
  image?: string;
  /** A table, first row treated as the header. */
  table?: string[][];
  /** Speaker notes. Not shown on the slide; read back by extract(). */
  notes?: string;
  /**
   * Big single number with a caption underneath — for a metric slide.
   * Ignored when \`bullets\`, \`body\` or \`table\` is present.
   */
  metric?: { value: string; caption: string };
}

export interface DeckSpec {
  /** Deck title, used for the opening slide and the file metadata. */
  title: string;
  subtitle?: string;
  /** Shown in the footer of every slide after the first. */
  footer?: string;
  slides: SlideSpec[];
}

export interface SlideText {
  /** 1-based, in presentation order. */
  slide: number;
  /** First paragraph on the slide — the title. */
  title: string;
  /** Every remaining paragraph, in order. */
  body: string[];
  /** Speaker notes, when present. */
  notes: string;
}

export interface DeckSummary {
  path: string;
  format: "pptx";
  bytes: number;
  /** Number of slides. */
  slides: number;
  /** Each slide's title, in order — the cheapest possible outline. */
  titles: string[];
  /** Total words across all slides, notes included. */
  words: number;
  /** Embedded image/media parts. */
  media: number;
}

export interface ReplaceTextOptions {
  /** 1-based slide numbers, as describe()/extract() number them. Default: every slide. */
  slides?: number | number[];
  /** Also edit speaker notes. Default false. */
  notes?: boolean;
  /** Where to write. Default: back over the input path. */
  output?: string;
}

export interface DeckEdit {
  path: string;
  replacements: number;
  slides: Array<{ slide: number; replacements: number }>;
  /** Search strings that matched nothing. Empty when every rule landed. */
  unmatched: string[];
}

/**
 * Summarise a deck without reading it into context: slide count, the full
 * outline of titles, word count.
 */
export function describe(path: string): Promise<DeckSummary>;

/** Build a NEW deck from a spec. Returns the output path. */
export function create(spec: DeckSpec, output: string): Promise<string>;

/**
 * Find and replace text in an EXISTING deck, preserving everything else.
 *
 * This is an edit, not a regeneration. Only the slide parts holding the
 * matched text are rewritten; the master, layouts, theme, images, animations
 * and every slide you did not scope to are copied byte for byte. A replacement
 * lands in the run its match started in, so it keeps that run's font, size and
 * colour.
 *
 * Matching is literal, case-sensitive, and does not cross a paragraph
 * boundary. Text split across formatting runs is still found. If nothing
 * matches it throws rather than writing an identical deck.
 *
 *     await replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, { slides: 4 });
 */
export function replaceText(
  path: string,
  replacements: Record<string, string> | Array<{ find: string; replace: string }>,
  options?: ReplaceTextOptions,
): Promise<DeckEdit>;

/**
 * Every slide's text, including speaker notes.
 *
 * This reads the file, not a cached spec — so it is the honest way to check
 * what a deck actually says, including one this environment did not write.
 */
export function extract(path: string): Promise<SlideText[]>;

/**
 * Flatten a deck to plain text, one slide per block, with "## Slide N: Title"
 * headers. Convenient to write to a .md file and then grep.
 */
export function outline(path: string): Promise<string>;
`;

export const SLIDES_DOCS = `# env:slides

Build PowerPoint decks and read them back. Paths in, paths out.

\`\`\`js
import { create } from 'env:slides';

export default async function main() {
  return create({
    title: 'Q3 Review',
    subtitle: 'Prepared for the board',
    footer: 'Confidential',
    slides: [
      { title: 'Headline', metric: { value: '$4.2M', caption: 'revenue, up 12% QoQ' } },
      { title: 'By region', table: [['Region', 'Revenue'], ['EMEA', '$1.8M'], ['AMER', '$2.4M']] },
      {
        title: 'What changed',
        bullets: ['EMEA renewals landed early', '  two of them slipped from Q2', 'AMER added 14 logos'],
        notes: 'Mention the Q2 slip explicitly — the board asked last time.',
      },
    ],
  }, '/out/q3.pptx');
}
\`\`\`

## Reading a deck you did not write

\`describe()\` first — it gives you the outline for a few dozen tokens, and no
deck is small enough to read blind:

\`\`\`js
import { describe, outline } from 'env:slides';
import { writeFile } from 'env:fs';

export default async function main() {
  const summary = await describe('/inbox/deck.pptx');   // { slides: 31, titles: [...] }
  await writeFile('/tmp/deck.md', await outline('/inbox/deck.pptx'));
  return summary;
}
\`\`\`

Then \`grep\` \`/tmp/deck.md\` for what you actually need. Writing the flattened
text to a file and searching it costs a fraction of pulling 31 slides through
the response cap.

## Fixing a slide without rebuilding the deck

\`replaceText\` edits a deck **in place**. Reach for it whenever the file
already exists — 'fix the typo on slide 4', 'rename the client throughout'.

\`\`\`js
import { outline, replaceText } from 'env:slides';

export default async function main() {
  // Read it first: matching is literal, so copy the text as it is written.
  const text = await outline('/inbox/q3.pptx');

  const edit = await replaceText('/inbox/q3.pptx', { 'Nortwind': 'Northwind' }, {
    slides: 4,
    output: '/out/q3.pptx',
  });
  // → { path: '/out/q3.pptx', replacements: 1, slides: [{ slide: 4, replacements: 1 }], unmatched: [] }
  return edit;
}
\`\`\`

The alternative — \`extract()\` then \`create()\` — is a **regeneration**, and it
rebuilds the deck out of the only things \`DeckSpec\` can say. Measured on a deck
this adapter wrote, that cycle lost the chart image and the footer's slide
layout; on a deck someone else made, it would lose their entire design.

- Only the slide parts that matched are rewritten. Everything else — masters,
  layouts, theme, \`ppt/media/*\`, animations — is copied byte for byte.
- \`slides\` takes a number or an array, numbered as \`describe\`/\`extract\` do.
  Omit it to search the whole deck.
- Speaker notes are left alone unless you pass \`{ notes: true }\`.
- Matching is **literal and case-sensitive** and never crosses a paragraph. It
  does find text split across formatting runs.
- If nothing matches it throws instead of writing an identical deck;
  \`unmatched\` names the rules that missed when others hit.

For anything beyond replacing strings — adding a slide, changing a layout —
build a new deck with \`PptxGenJS\`. There is no way to open one with it.

## Notes

- \`bullets\`, \`body\`, \`table\` and \`metric\` are alternatives — a slide uses the
  first one it has, in that order. Give a slide one kind of content.
- Indent a bullet by prefixing two spaces: \`'  sub-point'\`.
- \`image\` takes a VFS path to a PNG or JPEG. Generate it with \`env:images\`
  first, then reference it here.
- Speaker notes are not rendered on the slide but survive the round trip, so
  they are a good place to put the "why" behind a number.
`;
