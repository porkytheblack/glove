/**
 * DOCX: compose with the `docx` library, read back with our own ZIP + XML.
 *
 * `docx` is write-only, so `describe`/`extractText` unpack the OOXML package
 * directly. A .docx body is a predictable, machine-generated XML shape —
 * paragraphs (`w:p`) of runs (`w:t`) — which is why text recovery here is a
 * scan rather than a full XML parse.
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
import { readZip, readZipEntry } from "./zip";

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

const DOCUMENT_PART = "word/document.xml";

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

async function readDocumentXml(vfs: EnvFsHandle, path: string): Promise<string> {
  const bytes = await vfs.readBytes(path);
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw new Error(`${path} could not be read as a .docx: ${e instanceof Error ? e.message : String(e)}`);
  }
  const entry = entries.get(DOCUMENT_PART);
  if (!entry) {
    throw new Error(
      `${path} is a ZIP but not a Word document (no ${DOCUMENT_PART}) — .xlsx and .pptx are also ZIPs, check the file`,
    );
  }
  return readZipEntry(bytes, entry).toString("utf8");
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
