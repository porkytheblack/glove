export const RENDER_TYPES = `/** env:render — turn a document into pictures of itself, inside the VFS. */

export interface RenderOptions {
  /** Which pages, 1-based. "all" for every page. Default [1]. */
  pages?: number[] | "all";
  /** Render scale before the width cap. Default 1.5. */
  scale?: number;
  /** Long-edge cap in pixels. Default 1600. */
  maxWidth?: number;
}

export interface RenderedPage {
  /** Where the PNG was written. */
  path: string;
  /** 1-based page number in the source document. */
  page: number;
  width: number;
  height: number;
  bytes: number;
}

export interface RenderResult {
  pages: RenderedPage[];
  /** What the input turned out to be — magic bytes first, extension second. */
  format: "pdf" | "office" | "image";
  /** Pages in the source document (1 for an image). */
  totalPages: number;
}

/**
 * Rasterize a PDF, deck, Word file or image to PNG page images.
 *
 * PDFs and images render with no external dependency. Office formats
 * (.pptx, .docx, .xlsx, .odp, .odt) go through headless LibreOffice, which
 * must be installed on the host; the error says so if it is not.
 */
export function render(input: string, outDir: string, opts?: RenderOptions): Promise<RenderResult>;
`;

export const RENDER_DOCS = `# env:render

Pictures of your own output. Every other way of checking work here reads text
back, which finds a wrong number and misses a table running off the page, a
chart with no bars, or a title overlapping its subtitle.

\`\`\`js
import { render } from 'env:render';

export default async function () {
  const shot = await render('/out/report.pdf', '/tmp/proof');
  return shot.pages[0].path;   // /tmp/proof/report-p1.png
}
\`\`\`

## Then actually look at it

Rendering only makes the picture. If the host wired a vision model, the
\`view_image\` verb is what looks at it — and it will render for you, so a
one-step check is:

    view_image({ path: '/out/report.pdf', prompt: 'Does the table list four
    regions with East highest, and is any text cut off at the page edge?' })

Ask a **specific** question. "Describe this image" costs the same as "is the
revenue column right-aligned and does every row have a value" and tells you
much less.

## Pages

\`pages\` is 1-based and defaults to \`[1]\`.

\`\`\`js
await render('/out/deck.pptx', '/tmp/proof', { pages: 'all' });   // every slide
await render('/out/report.pdf', '/tmp/proof', { pages: [1, 4, 9] });
\`\`\`

Renders go somewhere temporary. \`/out\` is what the host hands to the person —
putting proof images there makes the deliverable a lie.

## Size

\`maxWidth\` caps the long edge at 1600px by default. A vision model charges by
pixels and reads an A4 page perfectly well at that size; rendering at scale 3
costs several times as much and answers no better.

## What needs LibreOffice

| Input | Needs |
|---|---|
| \`.pdf\` | nothing |
| \`.png .jpg .webp .gif .bmp .tiff\` | nothing |
| \`.pptx .docx .xlsx .odp .odt .ods\` | headless LibreOffice on the host |

\`libreoffice-core\` alone is not enough — it has no import filters, and
converting anything with it fails with "source file could not be loaded".
Install \`libreoffice-impress\` for decks and \`libreoffice-writer\` for Word.

If it is missing, generate the PDF directly instead: \`env:documents\` renders
the same document spec to PDF, and that path needs nothing.
`;

export const VERIFY_SKILL = `# Checking what you produced

Extracting the text back finds a wrong number. It cannot see a table running
off the page, a chart with no bars, a title overlapping its subtitle, or a
final slide that came out blank. Those are the defects a person notices in the
first second — and the ones that make a deliverable embarrassing rather than
merely inaccurate.

If \`view_image\` is in your tool list, you can look at your own work.

## The one-call check

\`view_image\` renders documents for you. You do not have to call \`render\`
first.

    view_image({
      path: '/out/report.pdf',
      prompt: 'This should list four regions with a total row. Name every
               region and figure you can see, and say whether any text is cut
               off, overlapping, or running past the page edge.'
    })

## Ask something falsifiable

The answer is only as good as the question. "Describe this image" costs the
same as a real question and tells you almost nothing.

| Instead of | Ask |
|---|---|
| Describe this image | Are there exactly four bars, and is each one labelled? |
| Does it look right? | Is any text cut off at an edge or overlapping other text? |
| Check the deck | Is slide 3 blank, and does the title fit on one line? |

State what you EXPECTED, then ask what is actually there. You are looking for
the difference, and a model told what to expect will point at it.

## Checking more than the first page

Pass \`page\` — 1-based, defaults to 1. There is no rendering step.

    view_image({ path: '/out/deck.pptx', page: 3,
                 prompt: 'Is this slide blank, and does its title fit one line?' })

\`describe\` tells you how many pages there are, so you know how far to go.

You only need \`render\` directly when you want the PNGs themselves — to keep
them, or to work on them with \`env:images\`:

\`\`\`js
import { render } from 'env:render';

export default async function () {
  return (await render('/out/deck.pptx', '/tmp/proof', { pages: 'all' })).pages;
}
\`\`\`

Render to \`/tmp\`, never \`/out\` — that directory is what the person receives.

## When it disagrees with you

Believe it. A model looking at the picture is describing what is on the page;
your intent is not. Fix the document and look again.
`;
