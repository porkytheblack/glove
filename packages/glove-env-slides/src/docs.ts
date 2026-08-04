export const SLIDES_TYPES = `/** env:slides — build and read PowerPoint decks inside the VFS. */

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

/**
 * Summarise a deck without reading it into context: slide count, the full
 * outline of titles, word count.
 */
export function describe(path: string): Promise<DeckSummary>;

/** Build a deck. Returns the output path. */
export function create(spec: DeckSpec, output: string): Promise<string>;

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

## Notes

- \`bullets\`, \`body\`, \`table\` and \`metric\` are alternatives — a slide uses the
  first one it has, in that order. Give a slide one kind of content.
- Indent a bullet by prefixing two spaces: \`'  sub-point'\`.
- \`image\` takes a VFS path to a PNG or JPEG. Generate it with \`env:images\`
  first, then reference it here.
- Speaker notes are not rendered on the slide but survive the round trip, so
  they are a good place to put the "why" behind a number.
`;
