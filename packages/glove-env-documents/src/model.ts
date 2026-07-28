/**
 * One document model, two renderers.
 *
 * An agent composing a report should not have to learn two APIs to emit it
 * as a PDF and as a DOCX. The same `DocumentSpec` goes to `pdf.create` and
 * `docx.create`; only the output path changes.
 */

export type PageSize = "a4" | "letter" | [number, number];

export interface HeadingBlock {
  heading: string;
  /** 1–3. Default 1. */
  level?: 1 | 2 | 3;
}
export interface TextBlock {
  text: string;
}
export interface BulletsBlock {
  bullets: string[];
}
export interface TableBlock {
  table: {
    headers?: string[];
    rows: Array<Array<string | number | boolean | null>>;
  };
}
export interface ImageBlock {
  /** VFS path of a PNG or JPEG. */
  image: string;
  width?: number;
  height?: number;
}
export interface PageBreakBlock {
  pageBreak: true;
}

export type Block = HeadingBlock | TextBlock | BulletsBlock | TableBlock | ImageBlock | PageBreakBlock;

export interface DocumentSpec {
  title?: string;
  author?: string;
  subject?: string;
  /** Default "a4". */
  pageSize?: PageSize;
  /** Points of margin on every side. Default 56 (≈2 cm). */
  margin?: number;
  content: Block[];
}

/** Points, at 72 per inch. */
export const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export function resolvePageSize(size: PageSize | undefined): [number, number] {
  if (size === undefined) return PAGE_SIZES.a4;
  if (Array.isArray(size)) {
    if (size.length !== 2 || !size.every((n) => typeof n === "number" && n > 0)) {
      throw new Error("pageSize as an array must be [width, height] in points, both positive");
    }
    return [size[0], size[1]];
  }
  const known = PAGE_SIZES[String(size).toLowerCase()];
  if (!known) throw new Error(`unknown pageSize ${JSON.stringify(size)} — use "a4", "letter", or [width, height] in points`);
  return known;
}

export function isHeading(b: Block): b is HeadingBlock {
  return typeof (b as HeadingBlock).heading === "string";
}
export function isText(b: Block): b is TextBlock {
  return typeof (b as TextBlock).text === "string";
}
export function isBullets(b: Block): b is BulletsBlock {
  return Array.isArray((b as BulletsBlock).bullets);
}
export function isTable(b: Block): b is TableBlock {
  const t = (b as TableBlock).table;
  return !!t && Array.isArray(t.rows);
}
export function isImage(b: Block): b is ImageBlock {
  return typeof (b as ImageBlock).image === "string";
}
export function isPageBreak(b: Block): b is PageBreakBlock {
  return (b as PageBreakBlock).pageBreak === true;
}

/**
 * Reject a malformed spec before rendering anything. A block the renderer
 * does not recognise would otherwise vanish silently, and a document missing
 * a section is far more expensive to notice than a failed call.
 */
export function validateSpec(spec: DocumentSpec): DocumentSpec {
  if (!spec || typeof spec !== "object") throw new Error("expected a document spec object");
  if (!Array.isArray(spec.content)) {
    throw new Error("document spec needs a `content` array of blocks — e.g. [{ heading: 'Q3' }, { text: '…' }]");
  }
  spec.content.forEach((block, i) => {
    if (!block || typeof block !== "object") throw new Error(`content[${i}] is not a block object`);
    if (
      !isHeading(block) &&
      !isText(block) &&
      !isBullets(block) &&
      !isTable(block) &&
      !isImage(block) &&
      !isPageBreak(block)
    ) {
      throw new Error(
        `content[${i}] is not a recognised block — use { heading }, { text }, { bullets }, { table }, { image } or { pageBreak: true } (got keys: ${Object.keys(block).join(", ") || "none"})`,
      );
    }
    if (isTable(block) && !block.table.rows.every((r) => Array.isArray(r))) {
      throw new Error(`content[${i}].table.rows must be an array of arrays`);
    }
  });
  return spec;
}

export function cellText(v: string | number | boolean | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}
