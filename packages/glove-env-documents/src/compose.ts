/**
 * The `docx` library itself, with its own API.
 *
 * `docx.create(path, spec)` covers the common document in one call and it
 * stays — but it is *our* spec, and everything it does not name is
 * unreachable through it: a coloured run, a page-numbered footer, a table
 * with borders and column widths, a heading with spacing, landscape pages. A
 * model that knows the library already knows how to do all of those. What it
 * needs from us is the library, not a larger options bag.
 *
 * `docx` is unlike pptxgenjs in shape: there is no root object to call
 * methods on. A document is *assembled* out of constructed values —
 *
 *     Packer.toBuffer(new Document({
 *       sections: [{ children: [new Paragraph({ children: [new TextRun(…)] })] }],
 *     }))
 *
 * — so a Paragraph has to be nameable from inside a Document's arguments.
 * That is what a builder *family* is: every constructor here records into one
 * op list, so a value built by one can be handed to another, and `Packer` is
 * a member that is used without `new`.
 */
import * as docxLib from "docx";
import { defineBuilders, methodsOf, type BuilderMember } from "glove-working-environment";

/**
 * The constructors a document is actually built from.
 *
 * Named rather than taken wholesale: `docx` exports 240 functions, most of
 * them internal XML components, and a list a model reads should be the
 * document vocabulary rather than the library's entire symbol table.
 */
const CONSTRUCTORS = [
  "Document",
  "Paragraph",
  "TextRun",
  "Table",
  "TableRow",
  "TableCell",
  "ImageRun",
  "Header",
  "Footer",
  "PageBreak",
  "ExternalHyperlink",
  "InternalHyperlink",
  "Bookmark",
  "TableOfContents",
  "SimpleField",
  "Numbering",
] as const;

/**
 * Enums, shipped as data rather than as calls.
 *
 * `HeadingLevel.HEADING_1` and `AlignmentType.CENTER` appear in every docx
 * example there is; a model writing one has to get a string back, not a
 * recorder. They cross as plain values, so a read is a read.
 */
const ENUMS = [
  "AlignmentType",
  "BorderStyle",
  "EmphasisMarkType",
  "HeadingLevel",
  "HeightRule",
  "HighlightColor",
  "LevelFormat",
  "LineRuleType",
  "NumberFormat",
  "PageOrientation",
  "PageNumber",
  "SectionType",
  "ShadingType",
  "TabStopPosition",
  "TabStopType",
  "TextDirection",
  "UnderlineType",
  "VerticalAlign",
  "VerticalAlignTable",
  "WidthType",
] as const;

/** The enum objects, for export alongside the constructors. */
export function docxEnums(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of ENUMS) {
    const value = (docxLib as Record<string, unknown>)[name];
    if (value !== null && typeof value === "object") out[name] = value;
  }
  return out;
}

/**
 * Try to build one, to read its method surface off the instance.
 *
 * Several of these throw on empty options — that is fine and expected. The
 * allowlist only needs the names that *do* probe; a constructor whose
 * instances have no callable surface contributes nothing to it anyway,
 * because a docx value is configured through its constructor rather than by
 * calling methods on it.
 */
function probe(ctor: unknown): string[] {
  if (typeof ctor !== "function") return [];
  for (const args of [[{}], [""], []]) {
    try {
      return methodsOf(new (ctor as new (...a: unknown[]) => object)(...args));
    } catch {
      continue;
    }
  }
  return [];
}

export function defineDocxBuilders(): Record<string, unknown> {
  const members: Record<string, BuilderMember> = {};
  const allow = new Set<string>();

  for (const name of CONSTRUCTORS) {
    const ctor = (docxLib as Record<string, unknown>)[name];
    if (typeof ctor !== "function") continue;
    members[name] = {
      construct: (args) => new (ctor as new (...a: unknown[]) => object)(...args),
    };
    for (const method of probe(ctor)) allow.add(method);
  }

  // `Packer` is a namespace, not a constructor: a script uses it directly,
  // which is what `singleton` means here.
  members.Packer = { singleton: docxLib.Packer };

  return defineBuilders({
    family: "docx",
    members,
    allow: [...allow].sort(),
    finish: {
      /**
       * The library's own way of turning a document into bytes. It returns
       * them to the script rather than writing anything: the script then
       * writes through `env:fs`, exactly as it would in a real sandbox, and
       * the write goes through the same gateway as every other write.
       */
      async toBuffer(_packer, args) {
        return new Uint8Array(await docxLib.Packer.toBuffer(asDocument(args[0])));
      },
      /** The same bytes, base64-encoded — some pipelines want a string. */
      async toBase64String(_packer, args) {
        return docxLib.Packer.toBase64String(asDocument(args[0]));
      },
    },
  });
}

/**
 * Names the mistake instead of letting the library fail deep inside itself.
 *
 * `Packer.toBuffer()` with nothing, or with a section array instead of a
 * Document, is an easy slip, and unguarded it surfaces as a TypeError about
 * an internal field.
 */
function asDocument(value: unknown): docxLib.Document {
  if (!(value instanceof docxLib.Document)) {
    throw new Error(
      "Packer.toBuffer needs a Document: await Packer.toBuffer(new Document({ sections: [{ children: [...] }] }))",
    );
  }
  return value;
}
