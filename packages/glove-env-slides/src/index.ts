/**
 * `env:slides` — PowerPoint decks in the agent's virtual filesystem.
 *
 * Paths in, paths out. A deck is the one artifact an agent is routinely asked
 * to *produce* rather than consume, and until now the environment had no way
 * to make one: `env:documents` writes PDF and DOCX, which are the wrong shape
 * for something meant to be presented.
 *
 * Two directions, and they are deliberately asymmetric:
 *
 * - **Writing** goes through pptxgenjs, because OOXML presentation markup is
 *   large, and hand-rolling it would be a lot of surface for no benefit.
 * - **Reading** goes through this package's own ZIP + XML reader
 *   (`./pptx.ts`), not through pptxgenjs. Verifying a writer with its own
 *   library proves only that it is self-consistent — a title written into the
 *   wrong placeholder round-trips perfectly. Reading the file back
 *   independently is what makes `extract()` worth trusting, and it is the
 *   only way to read a deck this environment did not write.
 */
import PptxGenJSImport from "pptxgenjs";
import { defineAdapter, type EnvFsHandle, type FileSummary } from "glove-working-environment";
import { readDeck, looksZip, type SlideText } from "./pptx";
import { SLIDES_DOCS, SLIDES_TYPES } from "./docs";

export type { SlideText };
/**
 * The independent reader, exported for hosts that need to verify a deck from
 * outside the environment — a test asserting on what an agent produced, for
 * instance. Inside a script, use the `extract`/`describe` bindings instead.
 */
export { readDeck, looksZip, type DeckContent } from "./pptx";

/**
 * pptxgenjs ships both a CJS and an ES build, and which one a consumer's
 * loader picks decides whether the default import is the constructor or an
 * object wrapping it one level down. Under tsx it arrives wrapped; under a
 * bundled ESM build it does not. Normalising here means the adapter works
 * either way instead of failing with `PptxGenJS is not a constructor` in
 * whichever environment the author did not happen to test.
 */
const PptxGenJS = ((PptxGenJSImport as unknown as { default?: unknown }).default ??
  PptxGenJSImport) as typeof PptxGenJSImport;

export interface SlideSpec {
  title: string;
  bullets?: string[];
  body?: string;
  image?: string;
  table?: string[][];
  notes?: string;
  metric?: { value: string; caption: string };
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  footer?: string;
  slides: SlideSpec[];
}

export interface DeckSummary extends FileSummary {
  format: "pptx";
  slides: number;
  titles: string[];
  words: number;
  media: number;
}

// A restrained palette, fixed rather than configurable. An agent choosing
// colours per deck produces something worse than a consistent default, and
// every knob here is a knob it has to spend a decision on.
const INK = "1A1A2E";
const MUTED = "6B7280";
const ACCENT = "2563EB";
const RULE = "E5E7EB";

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** `"  sub-point"` → indent level 1. Two spaces per level, capped at 4. */
function bulletIndent(line: string): { text: string; level: number } {
  const leading = /^ */.exec(line)![0].length;
  return { text: line.trim(), level: Math.min(4, Math.floor(leading / 2)) };
}

function assertSpec(spec: unknown): asserts spec is DeckSpec {
  if (!spec || typeof spec !== "object") {
    throw new TypeError(`create() needs a deck spec object, got ${spec === null ? "null" : typeof spec}`);
  }
  const s = spec as Partial<DeckSpec>;
  if (typeof s.title !== "string" || s.title.trim() === "") {
    throw new TypeError("deck spec needs a non-empty `title`");
  }
  if (!Array.isArray(s.slides) || s.slides.length === 0) {
    throw new TypeError("deck spec needs a non-empty `slides` array — a deck with no slides is not a deck");
  }
  s.slides.forEach((slide, i) => {
    if (!slide || typeof slide !== "object") {
      throw new TypeError(`slides[${i}] must be an object, got ${typeof slide}`);
    }
    if (typeof slide.title !== "string" || slide.title.trim() === "") {
      throw new TypeError(`slides[${i}] needs a non-empty \`title\` — it is what describe() lists as the outline`);
    }
    if (slide.table !== undefined) {
      if (!Array.isArray(slide.table) || !slide.table.every((r) => Array.isArray(r))) {
        throw new TypeError(`slides[${i}].table must be an array of rows, each row an array of cell strings`);
      }
    }
    if (slide.bullets !== undefined && !Array.isArray(slide.bullets)) {
      throw new TypeError(`slides[${i}].bullets must be an array of strings`);
    }
  });
}

export const slides = () =>
  defineAdapter({
    name: "slides",
    description: "Build PowerPoint decks and read them back: create, describe, extract text and speaker notes, outline.",
    types: SLIDES_TYPES,
    docs: SLIDES_DOCS,
    handles: {
      extensions: [".pptx"],
      // A pptx is a ZIP, and so are .docx and .xlsx — the signature alone
      // cannot tell them apart. Claiming PK here would steal every Office
      // file from the adapter that actually owns it, so the extension is the
      // claim and `describe` verifies by looking for ppt/slides/ inside.
      magic: [],
    },
    create: (vfs: EnvFsHandle) => {
      /** Read, verify it really is a deck, and hand back parsed content. */
      const open = async (path: string) => {
        const bytes = await vfs.readBytes(path);
        if (!looksZip(bytes)) {
          throw new Error(
            `${path} is not a PowerPoint deck — it does not start with a ZIP signature. ` +
              `A .pptx is a ZIP container; this file is something else.`,
          );
        }
        return { bytes, deck: readDeck(bytes) };
      };

      return {
        async describe(path: string): Promise<DeckSummary> {
          const { bytes, deck } = await open(path);
          const total = deck.slides.reduce(
            (n, s) => n + words(s.title) + s.body.reduce((m, b) => m + words(b), 0) + words(s.notes),
            0,
          );
          return {
            path,
            format: "pptx",
            bytes: bytes.byteLength,
            slides: deck.slides.length,
            titles: deck.slides.map((s) => s.title),
            words: total,
            media: deck.media.length,
          };
        },

        async extract(path: string): Promise<SlideText[]> {
          return (await open(path)).deck.slides;
        },

        async outline(path: string): Promise<string> {
          const { deck } = await open(path);
          return deck.slides
            .map((s) => {
              const parts = [`## Slide ${s.slide}: ${s.title}`];
              if (s.body.length > 0) parts.push(s.body.join("\n"));
              if (s.notes) parts.push(`> notes: ${s.notes.replace(/\n/g, " ")}`);
              return parts.join("\n");
            })
            .join("\n\n");
        },

        async create(spec: DeckSpec, output: string): Promise<string> {
          assertSpec(spec);

          const pptx = new PptxGenJS();
          pptx.layout = "LAYOUT_16x9";
          pptx.title = spec.title;

          // The footer goes on a slide master, not onto each slide.
          //
          // Structurally that is where PowerPoint puts repeating chrome, and
          // it also keeps `extract()` honest: a footer stamped into every
          // slide's own XML comes back as a body line on every slide, so a
          // 30-slide deck yields 30 copies of "Confidential" and any summary
          // built from the text inherits them. Chrome is not content.
          const MASTER = "glove-content";
          if (spec.footer) {
            pptx.defineSlideMaster({
              title: MASTER,
              objects: [
                { text: { text: spec.footer, options: { x: 0.6, y: 5.05, w: 8.8, h: 0.3, fontSize: 10, color: MUTED } } },
              ],
            });
          }

          const cover = pptx.addSlide();
          cover.addText(spec.title, { x: 0.6, y: 2.1, w: 8.8, h: 1.0, fontSize: 40, bold: true, color: INK });
          if (spec.subtitle) {
            cover.addText(spec.subtitle, { x: 0.6, y: 3.1, w: 8.8, h: 0.5, fontSize: 18, color: MUTED });
          }
          cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.9, w: 1.2, h: 0.06, fill: { color: ACCENT } });

          for (const slide of spec.slides) {
            const s = spec.footer ? pptx.addSlide({ masterName: MASTER }) : pptx.addSlide();
            s.addText(slide.title, { x: 0.6, y: 0.4, w: 8.8, h: 0.7, fontSize: 26, bold: true, color: INK });
            s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.12, w: 8.8, h: 0.02, fill: { color: RULE } });

            // Content width halves when an image shares the slide.
            const hasImage = typeof slide.image === "string" && slide.image !== "";
            const w = hasImage ? 4.2 : 8.8;

            if (slide.bullets && slide.bullets.length > 0) {
              s.addText(
                slide.bullets.map((line) => {
                  const { text, level } = bulletIndent(line);
                  return { text, options: { bullet: true, indentLevel: level, fontSize: level > 0 ? 14 : 16 } };
                }),
                { x: 0.6, y: 1.5, w, h: 3.3, color: INK, lineSpacingMultiple: 1.3 },
              );
            } else if (slide.table && slide.table.length > 0) {
              const [header, ...rows] = slide.table;
              s.addTable(
                [
                  header.map((c) => ({ text: String(c), options: { bold: true, color: "FFFFFF", fill: { color: ACCENT } } })),
                  ...rows.map((r) => r.map((c) => ({ text: String(c), options: { color: INK } }))),
                ],
                { x: 0.6, y: 1.5, w, fontSize: 13, border: { pt: 0.5, color: RULE }, autoPage: false },
              );
            } else if (slide.metric) {
              s.addText(slide.metric.value, { x: 0.6, y: 1.9, w, h: 1.2, fontSize: 60, bold: true, color: ACCENT });
              s.addText(slide.metric.caption, { x: 0.6, y: 3.1, w, h: 0.6, fontSize: 16, color: MUTED });
            } else if (slide.body) {
              s.addText(slide.body, { x: 0.6, y: 1.5, w, h: 3.3, fontSize: 15, color: INK, lineSpacingMultiple: 1.3 });
            }

            if (hasImage) {
              // Read through the guarded handle: an image the script produced
              // with env:images lives in the VFS, not on the host.
              const data = await vfs.readBytes(slide.image!);
              const ext = (slide.image!.split(".").pop() ?? "png").toLowerCase();
              s.addImage({
                data: `image/${ext === "jpg" ? "jpeg" : ext};base64,${Buffer.from(data).toString("base64")}`,
                x: 5.2,
                y: 1.5,
                w: 4.2,
                h: 3.3,
                sizing: { type: "contain", w: 4.2, h: 3.3 },
              });
            }

            if (slide.notes) s.addNotes(slide.notes);
          }

          const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
          await vfs.writeFile(output, new Uint8Array(buffer));
          return output;
        },
      };
    },
  });

export default slides;
