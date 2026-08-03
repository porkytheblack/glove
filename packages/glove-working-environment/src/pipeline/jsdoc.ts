/**
 * Zero-dependency JSDoc extraction: the block comment immediately preceding
 * the module's `export default` (or, failing that, the first JSDoc block in
 * the file followed by a declaration). Only what `.d.ts` generation needs —
 * description, `@param`, `@returns`.
 */
import { scanModule } from "../executor/scan";

export interface JsDocParam {
  /** Raw name as written: `args`, `args.input`, possibly `[args.format]`-optional. */
  name: string;
  type?: string;
  optional: boolean;
  description?: string;
}

export interface JsDocInfo {
  description: string;
  params: JsDocParam[];
  returns?: string;
}

/** Find the JSDoc block that documents the default export, if any. */
export function jsDocForDefaultExport(src: string): JsDocInfo | null {
  const { hits } = scanModule(src);
  const exportHit = hits.find((h) => h.keyword === "export" && h.depth === 0 && /^export\s+default\b/.test(src.slice(h.index, h.index + 60)));
  if (!exportHit) return null;
  const block = jsDocEndingBefore(src, exportHit.index);
  return block ? parseJsDocBlock(block) : null;
}

/** One-line description for listings ("the listing is the capability catalog"). */
export function scriptOneLiner(src: string): string | null {
  const doc = jsDocForDefaultExport(src);
  if (!doc || !doc.description) return null;
  const line = doc.description.split("\n")[0].trim();
  return line || null;
}

/** The JSDoc block comment whose end is separated from `index` by whitespace only. */
function jsDocEndingBefore(src: string, index: number): string | null {
  const tail = src.slice(0, index).replace(/\s+$/, "");
  if (!tail.endsWith("*/")) return null;
  const start = tail.lastIndexOf("/**");
  if (start === -1) return null;
  const inner = tail.slice(start + 3, tail.length - 2);
  return inner.includes("*/") ? null : inner;
}

export function parseJsDocBlock(inner: string): JsDocInfo {
  const lines = inner.split("\n").map((l) => l.replace(/^\s*\*? ?/, "").replace(/\s+$/, ""));
  const descLines: string[] = [];
  const params: JsDocParam[] = [];
  let returns: string | undefined;

  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@")) {
    descLines.push(lines[i]);
    i += 1;
  }

  while (i < lines.length) {
    let line = lines[i];
    // A tag's type annotation may span lines; join continuation lines that
    // don't start a new tag.
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("@")) {
      line += " " + lines[j].trim();
      j += 1;
    }
    i = j;

    const tagMatch = /^@(\w+)\s*([\s\S]*)$/.exec(line);
    if (!tagMatch) continue;
    const [, tag, restRaw] = tagMatch;
    if (tag === "param" || tag === "arg" || tag === "argument") {
      const { type, rest } = readBraceType(restRaw);
      const nameMatch = /^\s*(\[[^\]]+\]|[\w$.]+)\s*-?\s*([\s\S]*)$/.exec(rest);
      if (!nameMatch) continue;
      let name = nameMatch[1];
      let optional = false;
      if (name.startsWith("[")) {
        optional = true;
        name = name.slice(1, -1).split("=")[0].trim();
      }
      params.push({ name, type, optional, description: nameMatch[2].trim() || undefined });
    } else if (tag === "returns" || tag === "return") {
      const { type } = readBraceType(restRaw);
      if (type) returns = type;
    }
  }

  return {
    description: descLines.join("\n").trim(),
    params,
    returns,
  };
}

/** Read a balanced `{ … }` type annotation from the start of a tag body. */
function readBraceType(s: string): { type?: string; rest: string } {
  const t = s.replace(/^\s+/, "");
  if (!t.startsWith("{")) return { rest: t };
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "{") depth += 1;
    else if (t[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { type: normalizeJsDocType(t.slice(1, i).trim()), rest: t.slice(i + 1) };
      }
    }
  }
  return { rest: t };
}

function normalizeJsDocType(t: string): string {
  if (t === "*" || t === "") return "any";
  return t;
}
