/**
 * `env:documents` — pdf-lib and docx bridged into the agent's virtual
 * filesystem.
 *
 * Paths in, paths out, with one document model behind both renderers: the
 * same spec that produces a PDF produces a DOCX, so choosing a format is a
 * change of output path rather than a change of API.
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import { createPdfBindings, type PdfSummary } from "./pdf";
import { createDocxBindings, type DocxSummary } from "./docx";
import { defineDocxBuilders, docxEnums } from "./compose";
import { DOCUMENTS_DOCS, DOCUMENTS_TYPES } from "./docs";
import { DOCUMENTS_SKILLS } from "./skills";

export type { DocumentSpec, Block, PageSize, FontSpec } from "./model";
export type {
  PdfSummary,
  PdfMetadata,
  StampOptions,
  ExtractedText,
  PdfFormField,
  PdfFormContents,
  FillFormOptions,
  FilledForm,
} from "./pdf";
export type { DocxSummary, DocxText, DocxEdit, DocxReplaceOptions } from "./docx";

export type DocumentSummary = PdfSummary | DocxSummary;

/** Sniff the format from magic bytes; the extension is a hint, not a fact. */
async function detect(vfs: EnvFsHandle, path: string): Promise<"pdf" | "docx"> {
  const head = (await vfs.readBytes(path)).subarray(0, 4);
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "docx"; // any ZIP; readDocumentXml checks it is Word
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  throw new Error(
    `cannot tell what kind of document ${path} is — it starts with neither %PDF nor a ZIP header. Supported: .pdf, .docx`,
  );
}

export const documents = () =>
  defineAdapter({
    name: "documents",
    description: "Compose, inspect and rearrange PDF and DOCX documents; extract their text.",
    types: DOCUMENTS_TYPES,
    docs: DOCUMENTS_DOCS,
    skills: DOCUMENTS_SKILLS,
    // Only PDF gets a magic claim. DOCX is a ZIP, and so is XLSX — a `PK`
    // signature cannot tell them apart, so the ZIP-based formats are claimed
    // by extension and left to disagree politely with env:spreadsheets.
    handles: {
      extensions: [".pdf", ".docx"],
      magic: [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
    },
    create: (vfs: EnvFsHandle) => {
      const pdf = createPdfBindings(vfs);
      const docx = createDocxBindings(vfs);
      return {
        /** Summarise a PDF or DOCX, whichever it turns out to be. */
        async describe(path: string): Promise<DocumentSummary> {
          return (await detect(vfs, path)) === "pdf" ? pdf.describe(path) : docx.describe(path);
        },
        pdf,
        docx,
        // The `docx` library itself, for documents `docx.create` cannot
        // express. Constructors and enums sit at the top level because that
        // is where a model expects them after `import { Document, Paragraph }
        // from 'docx'`.
        ...defineDocxBuilders(),
        ...docxEnums(),
      };
    },
  });

export default documents;
