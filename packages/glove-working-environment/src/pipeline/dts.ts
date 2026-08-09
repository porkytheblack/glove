/**
 * Sibling `.d.ts` generation — a derived artifact, regenerated on every
 * script mutation, never hand-edited.
 *
 * Strategy (zero-dep; only the default export's signature is needed):
 *  1. Parameter list from `fn.toString()` — exact param source text,
 *     including destructured names and defaults.
 *  2. JSDoc from a source scan — the block preceding `export default`.
 *  3. Return type from `@returns` when present, else `Promise<unknown>`.
 */
import { scanModule, matchDelim } from "../executor/scan";
import { jsDocForDefaultExport, type JsDocInfo } from "./jsdoc";

export interface DtsResult {
  dts: string;
  /** False when the default export has no JSDoc block (drives the soft nudge). */
  hasJsDoc: boolean;
}

/**
 * The default export, described rather than held.
 *
 * Only `name` and the function's own source text are ever needed, and both
 * are strings — which is what lets a `.d.ts` be generated from a module that
 * was evaluated in another thread. `Function.prototype.toString` cannot be
 * faked on a stand-in object, so passing the text is the only honest way to
 * do this across a boundary.
 */
export interface DefaultExportInfo {
  /** `fn.name`, or "" when anonymous. */
  name: string;
  /** `Function.prototype.toString.call(fn)`. */
  source: string;
}

export function generateDts(source: string, fn: DefaultExportInfo, fileName: string): DtsResult {
  const doc = jsDocForDefaultExport(source);
  const name = fnName(fn, fileName);
  const argsType = paramType(fn, doc);
  const returnType = doc?.returns ?? "Promise<unknown>";

  const lines: string[] = [];
  if (doc?.description) {
    const descLines = doc.description.split("\n");
    if (descLines.length === 1) {
      lines.push(`/** ${descLines[0]} */`);
    } else {
      lines.push("/**", ...descLines.map((l) => ` * ${l}`.trimEnd()), " */");
    }
  }
  const params = argsType === null ? "" : `args: ${argsType}`;
  lines.push(`declare function ${name}(${params}): ${returnType};`);
  lines.push(`export default ${name};`);
  return { dts: lines.join("\n") + "\n", hasJsDoc: doc !== null };
}

function fnName(fn: DefaultExportInfo, fileName: string): string {
  const n = fn.name;
  if (n && /^[A-Za-z_$][\w$]*$/.test(n) && n !== "default") return n;
  const base = fileName.replace(/\.[^.]*$/, "").replace(/[^\w$]/g, "_");
  return /^[0-9]/.test(base) ? `_${base}` : base || "script";
}

/** Null when the function takes no parameters. */
function paramType(fn: DefaultExportInfo, doc: JsDocInfo | null): string | null {
  const src = fn.source;
  const paramSrc = firstParamSource(src);

  // Direct `@param {T} args` for the first parameter wins.
  if (doc && paramSrc !== null) {
    const rootName = /^[A-Za-z_$][\w$]*$/.test(paramSrc) ? paramSrc : null;
    const direct = doc.params.find((p) => !p.name.includes(".") && (rootName === null || p.name === rootName));
    const dotted = doc.params.filter((p) => p.name.includes("."));
    if (dotted.length > 0) {
      const props = dotted
        .filter((p) => p.name.split(".").length === 2)
        .map((p) => `${p.name.split(".")[1]}${p.optional ? "?" : ""}: ${p.type ?? "any"}`);
      if (props.length > 0) return `{ ${props.join("; ")} }`;
    }
    if (direct?.type && direct.type !== "any" && !/^object$/i.test(direct.type)) return direct.type;
  }

  if (paramSrc === null) return null;
  if (/^[A-Za-z_$][\w$]*$/.test(paramSrc)) return "any";
  if (paramSrc.startsWith("{")) {
    const props = destructuredProps(paramSrc);
    if (props) return props;
  }
  return "any";
}

/** Source text of the first parameter, or null when there are none. */
function firstParamSource(fnSrc: string): string | null {
  let s = fnSrc.trim();
  if (s.startsWith("class")) return "args"; // class default export — constructor params stay opaque
  s = s.replace(/^async\s+/, "");
  if (!s.startsWith("(") && !s.startsWith("function")) {
    // `async args => …` single-param arrow without parens
    const m = /^([A-Za-z_$][\w$]*)\s*=>/.exec(s);
    return m ? m[1] : null;
  }
  const open = s.indexOf("(");
  if (open === -1) return null;
  const { mask } = scanModule(s);
  const close = matchDelim(s, mask, open);
  if (close === -1) return null;
  const inner = s.slice(open + 1, close).trim();
  if (inner === "") return null;
  // First parameter only — the contract shape is fn(args).
  const first = splitTopLevel(inner)[0]?.trim() ?? "";
  if (first === "") return null;
  return first.split("=")[0].trim().startsWith("{") ? first : first.replace(/=.*$/s, "").trim();
}

/** `{ input, format = 'a4' }` → `{ input: any; format?: any }`, or null when too clever. */
function destructuredProps(paramSrc: string): string | null {
  const { mask } = scanModule(paramSrc);
  const open = paramSrc.indexOf("{");
  const close = matchDelim(paramSrc, mask, open);
  if (close === -1) return null;
  const inner = paramSrc.slice(open + 1, close).trim();
  if (inner === "") return "{}";
  const props: string[] = [];
  for (const piece of splitTopLevel(inner)) {
    const p = piece.trim();
    if (p === "") continue;
    if (p.startsWith("...")) {
      props.push(`[key: string]: any`);
      continue;
    }
    const hasDefault = /=/.test(p);
    const name = p.split(/[=:]/)[0].trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null; // nested pattern — give up, use any
    props.push(`${name}${hasDefault ? "?" : ""}: any`);
  }
  return `{ ${props.join("; ")} }`;
}

/**
 * Split on separators that sit outside (), [], {}; strings handled crudely by
 * depth only. Exported because arg pre-flight needs the same scan, and two
 * copies of a brace-counter is one too many.
 */
export function splitTopLevel(s: string, separators = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && separators.includes(c)) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the first `needle` outside brackets/strings, or -1. */
export function indexOfTopLevel(s: string, needle: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && c === needle) return i;
  }
  return -1;
}
