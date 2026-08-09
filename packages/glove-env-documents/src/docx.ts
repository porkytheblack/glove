/**
 * DOCX: compose with the `docx` library, read back with our own ZIP + XML.
 *
 * `docx` is write-only, so `describe`/`extractText` unpack the OOXML package
 * directly. A .docx body is a predictable, machine-generated XML shape —
 * paragraphs (`w:p`) of runs (`w:t`) — which is why text recovery here is a
 * scan rather than a full XML parse.
 *
 * `replaceText` is the third direction, and it goes through neither library.
 * Editing an existing document by re-composing it means re-composing only
 * what this file's spec can express, which is a fraction of what a real
 * contract contains: measured on a document with a header, a coloured run and
 * a logo, an extract-and-rebuild cycle dropped `word/header1.xml`, its
 * relationships and `word/media/*.png`, and returned the bold red client name
 * as plain text. So the edit is made in the package: the one part that
 * contains the text is inflated, spliced and re-deflated, and every other
 * entry is copied across still compressed.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from "docx";
import type { EnvFsHandle } from "glove-working-environment";
import {
  cellText,
  isBullets,
  isHeading,
  isImage,
  isPageBreak,
  isTable,
  isText,
  validateSpec,
  type DocumentSpec,
} from "./model";
import { readZip, readZipEntry, rewriteZip } from "./zip";
import { normalizeRules, replaceInPart, WORD_TAGS, type ReplaceRule } from "./ooxml";

export interface DocxSummary {
  path: string;
  format: "docx";
  bytes: number;
  paragraphs: number;
  words: number;
  characters: number;
  /** Headings in document order — an outline to navigate by. */
  headings: Array<{ level: number; text: string }>;
  tables: number;
  /** First few paragraphs, so the shape is visible without extracting. */
  preview: string[];
}

export interface DocxText {
  path: string;
  paragraphs: string[];
  text: string;
  characters: number;
}

export interface DocxReplaceOptions {
  /** Where to write. Default: back over `path`. */
  output?: string;
  /**
   * `"all"` (default) also edits headers, footers, footnotes and endnotes —
   * a client name usually appears in a header too. `"body"` is document.xml
   * alone.
   */
  parts?: "body" | "all";
}

export interface DocxEdit {
  /** The file written. */
  path: string;
  /** Total occurrences replaced. */
  replacements: number;
  /** Which parts changed, and by how much. */
  parts: Array<{ part: string; replacements: number }>;
  /** Search strings that matched nothing. Empty when every rule landed. */
  unmatched: string[];
}

const DOCUMENT_PART = "word/document.xml";

/**
 * The parts that carry document text.
 *
 * Deliberately not `word/comments.xml` (a comment is someone else's writing,
 * not the document's), nor `docProps/*` (metadata has its own verb), nor
 * anything under `word/glossary/` (building blocks, not this document).
 */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

const HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

interface ParsedParagraph {
  text: string;
  /** 1–9 for Heading1..9, 0 for body text. */
  headingLevel: number;
}

/** Pull paragraphs, their text and their heading level out of word/document.xml. */
export function parseDocumentXml(xml: string): { paragraphs: ParsedParagraph[]; tables: number } {
  const paragraphs: ParsedParagraph[] = [];
  const body = /<w:body[\s>][\s\S]*?<\/w:body>/.exec(xml)?.[0] ?? xml;

  for (const match of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    const inner = match[1] ?? "";
    let text = "";
    // Runs, breaks and tabs, in document order.
    for (const node of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g)) {
      if (node[1] !== undefined) text += decodeXml(node[1]);
      else if (node[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
    }
    const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(inner)?.[1] ?? "";
    const heading = /^Heading(\d)$/i.exec(style);
    paragraphs.push({ text, headingLevel: heading ? Number(heading[1]) : 0 });
  }

  const tables = [...body.matchAll(/<w:tbl(?:\s[^>]*)?>/g)].length;
  return { paragraphs, tables };
}

/**
 * What any one part may inflate to.
 *
 * Read off the live environment rather than left to the module default, so a
 * host that lowered `maxVfsBytes` gets the lower ceiling it asked for. Every
 * read path in this file goes through it — a new one that did not would
 * reopen the bomb the cap exists to stop.
 */
function inflationBudget(vfs: EnvFsHandle): number {
  return Math.max(1, vfs.limits.maxVfsBytes);
}

/** Open a .docx through the guarded handle, refusing anything that is not one. */
async function openDocx(vfs: EnvFsHandle, path: string) {
  const bytes = await vfs.readBytes(path);
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw new Error(`${path} could not be read as a .docx: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!entries.has(DOCUMENT_PART)) {
    throw new Error(
      `${path} is a ZIP but not a Word document (no ${DOCUMENT_PART}) — .xlsx and .pptx are also ZIPs, check the file`,
    );
  }
  return { bytes, entries };
}

async function readDocumentXml(vfs: EnvFsHandle, path: string): Promise<string> {
  const { bytes, entries } = await openDocx(vfs, path);
  return readZipEntry(bytes, entries.get(DOCUMENT_PART)!, inflationBudget(vfs)).toString("utf8");
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function createDocxBindings(vfs: EnvFsHandle) {
  return {
    /** Outline and size of a .docx, without pulling its full text into context. */
    async describe(path: string): Promise<DocxSummary> {
      const { paragraphs, tables } = parseDocumentXml(await readDocumentXml(vfs, path));
      const nonEmpty = paragraphs.filter((p) => p.text.trim() !== "");
      const text = nonEmpty.map((p) => p.text).join("\n");
      return {
        path,
        format: "docx",
        bytes: (await vfs.stat(path))?.size ?? 0,
        paragraphs: nonEmpty.length,
        words: words(text),
        characters: text.length,
        headings: nonEmpty
          .filter((p) => p.headingLevel > 0)
          .map((p) => ({ level: p.headingLevel, text: p.text })),
        tables,
        preview: nonEmpty.slice(0, 5).map((p) => (p.text.length > 120 ? `${p.text.slice(0, 119)}…` : p.text)),
      };
    },

    /** Full text, paragraph by paragraph. */
    async extractText(path: string): Promise<DocxText> {
      const { paragraphs } = parseDocumentXml(await readDocumentXml(vfs, path));
      const kept = paragraphs.map((p) => p.text).filter((t) => t.trim() !== "");
      const text = kept.join("\n");
      return { path, paragraphs: kept, text, characters: text.length };
    },

    /**
     * Find and replace text inside an existing .docx, in place.
     *
     * This is an **edit**, not a re-render: only the parts that carry the
     * matched text are rewritten, and every other entry in the package —
     * styles, numbering, themes, images, headers you did not match, the
     * relationship graph — is copied across byte for byte. Formatting around
     * a replacement survives because the surrounding runs are never touched,
     * and the replacement itself lands in the run the match started in, so it
     * inherits that run's formatting.
     *
     * Matching is literal, case-sensitive, and within a paragraph.
     */
    async replaceText(
      path: string,
      replacements: Record<string, string> | ReplaceRule[],
      options: DocxReplaceOptions = {},
    ): Promise<DocxEdit> {
      const rules = normalizeRules(replacements);
      const { bytes, entries } = await openDocx(vfs, path);
      const budget = inflationBudget(vfs);

      const wanted = [...entries.keys()].filter((name) =>
        options.parts === "body" ? name === DOCUMENT_PART : TEXT_PARTS.test(name),
      );

      const edited = new Map<string, Uint8Array>();
      const parts: Array<{ part: string; replacements: number }> = [];
      const perRule = rules.map(() => 0);

      for (const name of wanted) {
        const xml = readZipEntry(bytes, entries.get(name)!, budget).toString("utf8");
        const result = replaceInPart(xml, rules, WORD_TAGS);
        if (result.count === 0) continue;
        edited.set(name, Buffer.from(result.xml, "utf8"));
        parts.push({ part: name, replacements: result.count });
        result.perRule.forEach((n, i) => (perRule[i] += n));
      }

      const total = perRule.reduce((a, b) => a + b, 0);
      if (total === 0) {
        // Writing a byte-identical copy and reporting success is the failure
        // that costs a run: the model believes the rename happened. The text
        // is there to be checked, so say what was searched for and where to
        // look.
        throw new Error(
          `nothing to replace in ${path}: none of ${rules.map((r) => JSON.stringify(r.find)).join(", ")} appears in it. ` +
            `Matching is literal and case-sensitive — read docx.extractText('${path}') and copy the text exactly as it is written.`,
        );
      }

      const output = options.output ?? path;
      await vfs.writeFile(output, rewriteZip(bytes, edited));
      return {
        path: output,
        replacements: total,
        parts,
        unmatched: rules.filter((_, i) => perRule[i] === 0).map((r) => r.find),
      };
    },

    /** Render a document spec to a .docx. Returns the output path. */
    async create(path: string, spec: DocumentSpec): Promise<string> {
      validateSpec(spec);
      const children: FileChild[] = [];

      if (spec.title) {
        children.push(new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }));
      }

      for (const block of spec.content) {
        if (isPageBreak(block)) {
          children.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })], pageBreakBefore: true }));
          continue;
        }
        if (isHeading(block)) {
          children.push(new Paragraph({ text: block.heading, heading: HEADINGS[block.level ?? 1] ?? HEADINGS[1] }));
          continue;
        }
        if (isText(block)) {
          // Keep authored newlines as line breaks rather than collapsing the
          // paragraph into one run.
          const lines = block.text.split("\n");
          children.push(
            new Paragraph({
              children: lines.map((line, i) => new TextRun(i === 0 ? line : { text: line, break: 1 })),
            }),
          );
          continue;
        }
        if (isBullets(block)) {
          for (const item of block.bullets) {
            children.push(new Paragraph({ text: String(item), bullet: { level: 0 } }));
          }
          continue;
        }
        if (isTable(block)) {
          const { headers, rows } = block.table;
          const columns = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length), 1);
          const makeRow = (cells: Array<string | number | boolean | null>, bold: boolean) =>
            new TableRow({
              children: Array.from({ length: columns }, (_, c) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: cellText(cells[c]), bold })] })],
                }),
              ),
            });
          const tableRows: TableRow[] = [];
          if (headers && headers.length > 0) tableRows.push(makeRow(headers, true));
          for (const row of rows) tableRows.push(makeRow(row, false));
          children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          // Word renders back-to-back tables as one; a spacer keeps them apart.
          children.push(new Paragraph({ text: "" }));
          continue;
        }
        if (isImage(block)) {
          const raw = await vfs.readBytes(block.image);
          const isPng = raw[0] === 0x89 && raw[1] === 0x50;
          const isJpeg = raw[0] === 0xff && raw[1] === 0xd8;
          if (!isPng && !isJpeg) {
            throw new Error(`${block.image} is neither PNG nor JPEG — convert it first (env:images can)`);
          }
          children.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [
                new ImageRun({
                  type: isPng ? "png" : "jpg",
                  data: Buffer.from(raw),
                  transformation: { width: block.width ?? 400, height: block.height ?? 300 },
                }),
              ],
            }),
          );
        }
      }

      const doc = new Document({
        title: spec.title,
        creator: spec.author,
        subject: spec.subject,
        sections: [{ children }],
      });
      await vfs.writeFile(path, new Uint8Array(await Packer.toBuffer(doc)));
      return path;
    },
  };
}
