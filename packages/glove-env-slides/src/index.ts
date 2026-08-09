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
import { defineAdapter, defineBuilder, methodsOf, type EnvFsHandle, type FileSummary } from "glove-working-environment";
import { readDeck, looksZip, notesPartFor, readPart, readZip, rewriteZip, slidePartsOf, type SlideText } from "./pptx";
import { normalizeRules, parseSlides, replaceInPart, type ReplaceRule } from "./edit";
import { SLIDES_DOCS, SLIDES_TYPES } from "./docs";
import { SLIDES_SKILLS } from "./skills";

export type { SlideText };
export type { ReplaceRule } from "./edit";
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

export interface ReplaceTextOptions {
  /** 1-based slide numbers, as `extract`/`describe` number them. Default: every slide. */
  slides?: number | number[];
  /** Also edit speaker notes. Default false — a typo on a slide is rarely in its notes. */
  notes?: boolean;
  /** Where to write. Default: back over the input path. */
  output?: string;
}

export interface DeckEdit {
  /** The file written. */
  path: string;
  /** Total occurrences replaced. */
  replacements: number;
  /** Which slides changed, and by how much. */
  slides: Array<{ slide: number; replacements: number }>;
  /** Search strings that matched nothing. Empty when every rule landed. */
  unmatched: string[];
}

/**
 * The shape pptxgenjs records a pending media read in, on every slide, layout
 * and master. Not in the library's published types — but it is where a `path`
 * lands whichever API named it, and the only thing `write()` consults before
 * opening the file itself, so it is the one place worth watching.
 */
interface MediaRel {
  path?: string;
  type?: string;
  data?: string | null;
}
interface MediaSurface {
  _relsMedia?: MediaRel[];
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
    skills: SLIDES_SKILLS,
    handles: {
      extensions: [".pptx"],
      // A pptx is a ZIP, and so are .docx and .xlsx — the signature alone
      // cannot tell them apart. Claiming PK here would steal every Office
      // file from the adapter that actually owns it, so the extension is the
      // claim and `describe` verifies by looking for ppt/slides/ inside.
      magic: [],
    },
    create: (vfs: EnvFsHandle) => {
      /**
       * `PptxGenJS` itself, with its real API.
       *
       * A model that has read pptxgenjs writes `new PptxGenJS()`, then
       * `addSlide()`, then `slide.addText(text, opts)`. Anything else makes it
       * translate, and translation is where the eval showed models burning
       * turns — one reached for a name our own API did not have precisely
       * because the library has a class.
       *
       * The allowlist is read off the library rather than typed out, so it is
       * the real surface and stays right when the dependency moves.
       */
      const probe = new PptxGenJS();
      const probeSlide = probe.addSlide();
      const enums = ["AlignH", "AlignV", "ChartType", "OutputType", "SchemeColor", "ShapeType"] as const;

      /** Bytes from the tree, base64, or a sentence about why the path is not readable. */
      const base64Of = async (path: string): Promise<string> => {
        try {
          return Buffer.from(await vfs.readBytes(path)).toString("base64");
        } catch (e) {
          throw new Error(
            `${path} is not in this environment's filesystem — a deck's images, media and backgrounds are read ` +
              `from the tree, never from the host disk: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      };

      /**
       * `{ path }` → `{ data }`, resolved through the guarded VFS handle.
       *
       * pptxgenjs opens a `path` itself — off the HOST filesystem — which
       * would let a script pull any host file it can name into a deck. The
       * path is resolved here instead and handed on as inline bytes.
       *
       * It also puts the failure where it belongs: the library defers reading
       * until write time, so a missing image otherwise surfaced against
       * `writeFile()` instead of the call that named it.
       */
      const inlinePath = async (value: unknown, mime: string): Promise<Record<string, unknown>> => {
        const opts = { ...((value ?? {}) as Record<string, unknown>) };
        const path = opts.path;
        if (typeof path !== "string") return opts;
        const ext = (path.split(".").pop() ?? "png").toLowerCase();
        delete opts.path;
        opts.data = `${mime}/${ext === "jpg" ? "jpeg" : ext};base64,${await base64Of(path)}`;
        return opts;
      };

      /**
       * Anything pptxgenjs still means to open on the host, resolved before it
       * can — the same defence as `rewrite` below, one step later.
       *
       * A background is *assigned* (`slide.background = { path }`), not
       * called, and a builder only rewrites the arguments of calls, so the map
       * cannot reach that route at all. Every path does end up here though,
       * because this list is exactly what the writer walks when it decides
       * what to read, so covering it closes the assignment and anything else
       * carrying a path that the named rewrites miss.
       */
      const resolveMedia = async (pptx: InstanceType<typeof PptxGenJS>): Promise<void> => {
        const deck = pptx as unknown as {
          masterSlide?: MediaSurface;
          slides?: MediaSurface[];
          slideLayouts?: MediaSurface[];
        };
        for (const surface of [deck.masterSlide, ...(deck.slides ?? []), ...(deck.slideLayouts ?? [])]) {
          for (const rel of surface?._relsMedia ?? []) {
            // `preencoded` is the library's own marker for a rel that already
            // carries its bytes; an `online` rel is a link, not a file.
            if (rel.data || !rel.path || rel.type === "online" || rel.path.includes("preencoded")) continue;
            rel.data = await base64Of(rel.path);
          }
        }
      };

      const Pptx = defineBuilder<InstanceType<typeof PptxGenJS>>({
        name: "PptxGenJS",
        construct: () => new PptxGenJS(),
        allow: [...new Set([...methodsOf(probe), ...methodsOf(probeSlide)])],
        data: Object.fromEntries(enums.map((k) => [k, probe[k]])),
        rewrite: {
          async addImage(args) {
            return [await inlinePath(args[0], "image"), ...args.slice(1)];
          },
          /**
           * Audio and video land in the same place: `addMediaDefinition`
           * stores `opt.path` and the writer opens it with the same
           * `readFileSync` that reads an image. The mime prefix has to be the
           * media's own type, because with no path left the library takes the
           * part's extension from the data URI instead.
           */
          async addMedia(args) {
            const type = (args[0] as { type?: unknown } | undefined)?.type;
            return [await inlinePath(args[0], typeof type === "string" ? type : "audio"), ...args.slice(1)];
          },
          /** A master's background arrives as an argument, so it is reachable here. */
          async defineSlideMaster(args) {
            const props = { ...((args[0] ?? {}) as Record<string, unknown>) };
            if (props.background) props.background = await inlinePath(props.background, "image");
            return [props, ...args.slice(1)];
          },
        },
        finish: {
          /**
           * The library's own `writeFile` would write to the host filesystem.
           * It is replaced, not wrapped: the bytes are produced in memory and
           * land in the VFS through the guarded handle, so zones, limits and
           * versioning apply exactly as they do to any other write.
           */
          async writeFile(pptx, args) {
            const opts = (args[0] ?? {}) as { fileName?: string };
            const path = typeof opts === "string" ? opts : opts.fileName;
            if (!path) {
              throw new Error("writeFile needs a path: writeFile({ fileName: '/out/deck.pptx' })");
            }
            await resolveMedia(pptx);
            const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
            await vfs.writeFile(path, new Uint8Array(buffer));
            return path;
          },
          /** `write()` hands the bytes back instead of storing them. */
          async write(pptx) {
            await resolveMedia(pptx);
            return new Uint8Array((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
          },
        },
      });

      /**
       * The inflation cap comes from the environment rather than a constant of
       * our own: a budget this adapter invented would either be uselessly
       * small or exactly the hole that lets a crafted deck exhaust the heap.
       * Every part this adapter inflates — reading or editing — passes it.
       */
      const budget = () => Math.max(1, vfs.limits.maxVfsBytes);

      /** Bytes through the guarded handle, refusing anything that is not a deck. */
      const openBytes = async (path: string): Promise<Uint8Array> => {
        const bytes = await vfs.readBytes(path);
        if (!looksZip(bytes)) {
          throw new Error(
            `${path} is not a PowerPoint deck — it does not start with a ZIP signature. ` +
              `A .pptx is a ZIP container; this file is something else.`,
          );
        }
        return bytes;
      };

      /** Read, verify it really is a deck, and hand back parsed content. */
      const open = async (path: string) => {
        const bytes = await openBytes(path);
        return { bytes, deck: readDeck(bytes, budget()) };
      };

      return {
        PptxGenJS: Pptx,

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

        /**
         * Find and replace text in an existing deck, in place.
         *
         * This is an **edit**, not a regeneration. Only the slide parts that
         * contain the matched text are rewritten; the master, the layouts, the
         * theme, the images, the animations and every slide you did not scope
         * to are copied across byte for byte. A replacement lands in the run
         * the match started in, so it keeps that run's font, size and colour.
         *
         * Matching is literal, case-sensitive, and within a paragraph.
         */
        async replaceText(
          path: string,
          replacements: Record<string, string> | ReplaceRule[],
          options: ReplaceTextOptions = {},
        ): Promise<DeckEdit> {
          const rules = normalizeRules(replacements);
          const bytes = await openBytes(path);
          const max = budget();
          const entries = readZip(bytes);
          const parts = slidePartsOf(entries);
          if (parts.length === 0) {
            throw new Error(
              "this is a ZIP but not a PowerPoint deck (no ppt/slides/) — .docx and .xlsx are also ZIPs, check the file",
            );
          }

          const edited = new Map<string, Uint8Array>();
          const touched: Array<{ slide: number; replacements: number }> = [];
          const perRule = rules.map(() => 0);

          for (const index of parseSlides(options.slides, parts.length)) {
            const slidePart = parts[index];
            const targets = [slidePart];
            if (options.notes) {
              const notes = notesPartFor(bytes, entries, slidePart, max);
              if (notes) targets.push(notes);
            }

            let onThisSlide = 0;
            for (const name of targets) {
              const result = replaceInPart(readPart(bytes, entries.get(name)!, max), rules);
              if (result.count === 0) continue;
              edited.set(name, Buffer.from(result.xml, "utf8"));
              onThisSlide += result.count;
              result.perRule.forEach((n, i) => (perRule[i] += n));
            }
            if (onThisSlide > 0) touched.push({ slide: index + 1, replacements: onThisSlide });
          }

          const total = perRule.reduce((a, b) => a + b, 0);
          if (total === 0) {
            // Writing a byte-identical deck and reporting success is the
            // failure that costs a run: the model believes the fix landed. The
            // text is right there to be checked, so say what was looked for.
            const where = options.slides === undefined ? "" : ` on slide ${JSON.stringify(options.slides)}`;
            throw new Error(
              `nothing to replace in ${path}${where}: none of ` +
                `${rules.map((r) => JSON.stringify(r.find)).join(", ")} appears there. ` +
                `Matching is literal and case-sensitive — read outline('${path}') and copy the text exactly as it is written.`,
            );
          }

          const out = options.output ?? path;
          await vfs.writeFile(out, rewriteZip(bytes, edited));
          return {
            path: out,
            replacements: total,
            slides: touched,
            unmatched: rules.filter((_, i) => perRule[i] === 0).map((r) => r.find),
          };
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
                {
                  x: 0.6,
                  y: 1.5,
                  w,
                  fontSize: 13,
                  border: { pt: 0.5, color: RULE },
                  // Continue onto further slides rather than running off the
                  // bottom of this one. Measured without it: a 40-row table
                  // drew all 40 rows on a single slide, most of them past the
                  // edge — and because the text is still in the file,
                  // `extract()` finds every row and nothing looks wrong until
                  // someone opens the deck. A silently unreadable deliverable
                  // is the worst outcome available here.
                  autoPage: true,
                  autoPageRepeatHeader: true,
                  autoPageSlideStartY: 0.6,
                },
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
