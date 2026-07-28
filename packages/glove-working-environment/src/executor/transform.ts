/**
 * Transforms an ES module source into a plain function body the vm sandbox
 * can run: static imports are hoisted into `__glove_import` calls, exports
 * become assignments onto `__exports`, dynamic `import()` is rewritten.
 *
 * The transform intentionally preserves line counts (removed statements are
 * blanked, not collapsed) so vm stack traces map back to the original
 * source.
 */
import { lineOf, matchDelim, scanModule } from "./scan";

export class TransformError extends Error {}

export interface TransformedModule {
  /** Hoisted import bindings + re-export blocks, in source order. */
  prelude: string[];
  /** The edited module body (same line count as the source). */
  body: string;
  /** `__exports.x = x` assignments appended after the body. */
  footer: string[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const CONTINUATION_CHARS = new Set([",", "=", "+", "-", "*", "/", "%", "<", ">", "&", "|", "^", "?", ":", "(", "[", "{", ".", "!", "~"]);

/** Replace a span with newlines only, keeping line numbers stable. */
const blank = (span: string) => span.replace(/[^\n]/g, "");

export function transformModule(src: string, modulePath: string): TransformedModule {
  const { mask, hits } = scanModule(src);
  const edits: Edit[] = [];
  const prelude: string[] = [];
  const footer: string[] = [];
  let importCounter = 0;

  const fail = (index: number, msg: string): TransformError =>
    new TransformError(`${modulePath}:${lineOf(src, index)}: ${msg}`);

  const skipTrivia = (i: number): number => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      if (src[i] === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
        i += 2;
        continue;
      }
      return i;
    }
  };

  const readIdent = (i: number): { name: string; end: number } | null => {
    IDENT_RE.lastIndex = i;
    const m = IDENT_RE.exec(src);
    return m ? { name: m[0], end: i + m[0].length } : null;
  };

  const readWord = (i: number, word: string): number | null => {
    const id = readIdent(i);
    return id && id.name === word ? id.end : null;
  };

  const readString = (i: number): { value: string; end: number } => {
    const q = src[i];
    if (q !== '"' && q !== "'") throw fail(i, `expected a string literal`);
    let j = i + 1;
    while (j < src.length && src[j] !== q) {
      if (src[j] === "\\") j += 1;
      j += 1;
    }
    if (j >= src.length) throw fail(i, `unterminated string literal`);
    return { value: src.slice(i + 1, j), end: j + 1 };
  };

  /** Consume trailing spaces + one optional `;` on the same line. */
  const eatSemi = (i: number): number => {
    let j = i;
    while (j < src.length && (src[j] === " " || src[j] === "\t")) j += 1;
    if (src[j] === ";") return j + 1;
    return i;
  };

  const parseNamedList = (openIdx: number, kind: "import" | "export"): { items: Array<{ outer: string; local: string }>; end: number } => {
    const close = matchDelim(src, mask, openIdx);
    if (close === -1) throw fail(openIdx, `unterminated { … } in ${kind} statement`);
    const inner = src.slice(openIdx + 1, close);
    const items: Array<{ outer: string; local: string }> = [];
    for (const raw of inner.split(",")) {
      const item = raw.trim();
      if (item === "") continue;
      if (item.startsWith('"') || item.startsWith("'")) {
        throw fail(openIdx, `string ${kind} names are not supported`);
      }
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/.exec(item);
      if (!m) throw fail(openIdx, `could not parse ${kind} specifier "${item}"`);
      // For imports: outer = the exported name in the source module, local = binding here.
      // For exports: outer = local binding here, local = exported name.
      items.push({ outer: m![1], local: m![2] ?? m![1] });
    }
    return { items, end: close + 1 };
  };

  for (const hit of hits) {
    if (hit.meta) throw fail(hit.index, `import.meta is not available in the working environment`);
    if (hit.dynamic) {
      edits.push({ start: hit.index, end: hit.index + "import".length, text: "__glove_import" });
      continue;
    }
    if (hit.depth !== 0) continue; // property/method names etc. — not declarations

    if (hit.keyword === "import") {
      let i = skipTrivia(hit.index + "import".length);
      const mv = `__glove_m${++importCounter}`;
      if (src[i] === '"' || src[i] === "'") {
        const { value: spec, end } = readString(i);
        prelude.push(`await __glove_import(${JSON.stringify(spec)});`);
        edits.push({ start: hit.index, end: eatSemi(end), text: blank(src.slice(hit.index, eatSemi(end))) });
        continue;
      }
      const bindings: string[] = [];
      let defaultName: string | null = null;
      let nsName: string | null = null;
      let named: Array<{ outer: string; local: string }> = [];

      const id = readIdent(i);
      if (id && id.name !== "from") {
        defaultName = id.name;
        i = skipTrivia(id.end);
        if (src[i] === ",") i = skipTrivia(i + 1);
      }
      if (src[i] === "*") {
        i = skipTrivia(i + 1);
        const asEnd = readWord(i, "as");
        if (asEnd === null) throw fail(i, `expected "as" after * in import statement`);
        i = skipTrivia(asEnd);
        const ns = readIdent(i);
        if (!ns) throw fail(i, `expected a namespace name after "* as"`);
        nsName = ns.name;
        i = skipTrivia(ns.end);
      } else if (src[i] === "{") {
        const list = parseNamedList(i, "import");
        named = list.items;
        i = skipTrivia(list.end);
      }
      if (defaultName === null && nsName === null && named.length === 0) {
        throw fail(hit.index, `could not parse import statement`);
      }
      const fromEnd = readWord(i, "from");
      if (fromEnd === null) throw fail(i, `expected "from" in import statement`);
      i = skipTrivia(fromEnd);
      const { value: spec, end } = readString(i);
      const stmtEnd = eatSemi(end);

      prelude.push(`const ${mv} = await __glove_import(${JSON.stringify(spec)});`);
      if (defaultName) bindings.push(`const ${defaultName} = __glove_pick(${mv}, "default", ${JSON.stringify(spec)});`);
      if (nsName) bindings.push(`const ${nsName} = ${mv};`);
      for (const it of named) {
        bindings.push(`const ${it.local} = __glove_pick(${mv}, ${JSON.stringify(it.outer)}, ${JSON.stringify(spec)});`);
      }
      prelude.push(...bindings);
      edits.push({ start: hit.index, end: stmtEnd, text: blank(src.slice(hit.index, stmtEnd)) });
      continue;
    }

    // ---- export ----
    let i = skipTrivia(hit.index + "export".length);

    const defaultEnd = readWord(i, "default");
    if (defaultEnd !== null) {
      const after = skipTrivia(defaultEnd);
      const decl = /^(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)/.exec(src.slice(after, after + 200));
      if (decl) {
        const name = decl[1] ?? decl[2];
        edits.push({ start: hit.index, end: after, text: blank(src.slice(hit.index, after)) });
        footer.push(`__exports.default = ${name};`);
      } else {
        edits.push({ start: hit.index, end: after, text: `__exports.default = ${blank(src.slice(hit.index, after))}` });
      }
      continue;
    }

    if (src[i] === "{") {
      const list = parseNamedList(i, "export");
      let j = skipTrivia(list.end);
      const fromEnd = readWord(j, "from");
      if (fromEnd !== null) {
        j = skipTrivia(fromEnd);
        const { value: spec, end } = readString(j);
        const stmtEnd = eatSemi(end);
        const mv = `__glove_m${++importCounter}`;
        const lines = [`{ const ${mv} = await __glove_import(${JSON.stringify(spec)});`];
        for (const it of list.items) {
          lines.push(`__exports[${JSON.stringify(it.local)}] = __glove_pick(${mv}, ${JSON.stringify(it.outer)}, ${JSON.stringify(spec)});`);
        }
        lines.push(`}`);
        prelude.push(lines.join(" "));
        edits.push({ start: hit.index, end: stmtEnd, text: blank(src.slice(hit.index, stmtEnd)) });
      } else {
        const stmtEnd = eatSemi(list.end);
        for (const it of list.items) {
          footer.push(`__exports[${JSON.stringify(it.local)}] = ${it.outer};`);
        }
        edits.push({ start: hit.index, end: stmtEnd, text: blank(src.slice(hit.index, stmtEnd)) });
      }
      continue;
    }

    if (src[i] === "*") {
      let j = skipTrivia(i + 1);
      let nsName: string | null = null;
      const asEnd = readWord(j, "as");
      if (asEnd !== null) {
        j = skipTrivia(asEnd);
        const ns = readIdent(j);
        if (!ns) throw fail(j, `expected a name after "* as"`);
        nsName = ns.name;
        j = skipTrivia(ns.end);
      }
      const fromEnd = readWord(j, "from");
      if (fromEnd === null) throw fail(j, `expected "from" in export * statement`);
      j = skipTrivia(fromEnd);
      const { value: spec, end } = readString(j);
      const stmtEnd = eatSemi(end);
      if (nsName) {
        prelude.push(`__exports[${JSON.stringify(nsName)}] = await __glove_import(${JSON.stringify(spec)});`);
      } else {
        const mv = `__glove_m${++importCounter}`;
        prelude.push(
          `{ const ${mv} = await __glove_import(${JSON.stringify(spec)}); for (const __glove_k of Object.keys(${mv})) if (__glove_k !== "default") __exports[__glove_k] = ${mv}[__glove_k]; }`,
        );
      }
      edits.push({ start: hit.index, end: stmtEnd, text: blank(src.slice(hit.index, stmtEnd)) });
      continue;
    }

    const kindId = readIdent(i);
    if (kindId && (kindId.name === "const" || kindId.name === "let" || kindId.name === "var")) {
      const afterKind = skipTrivia(kindId.end);
      if (src[afterKind] === "{" || src[afterKind] === "[") {
        throw fail(afterKind, `destructuring exports are not supported in scripts — declare the binding first, then export { name }`);
      }
      const first = readIdent(afterKind);
      if (!first) throw fail(afterKind, `expected a binding name after "export ${kindId.name}"`);
      const names = [first!.name];
      // Scan the rest of the declaration for `, name` at declaration depth.
      let depth = 0;
      let k = first!.end;
      let lastCode = "";
      scan: while (k < src.length) {
        if (!mask[k]) {
          k += 1;
          continue;
        }
        const c = src[k];
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") depth -= 1;
        else if (depth === 0 && c === ";") break;
        else if (depth === 0 && c === "\n") {
          if (lastCode !== "" && !CONTINUATION_CHARS.has(lastCode)) break;
        } else if (depth === 0 && c === ",") {
          const next = skipTrivia(k + 1);
          const id2 = readIdent(next);
          if (id2) {
            names.push(id2.name);
            k = id2.end;
            lastCode = id2.name[id2.name.length - 1];
            continue scan;
          }
        }
        if (!/\s/.test(c)) lastCode = c;
        k += 1;
      }
      edits.push({ start: hit.index, end: i, text: blank(src.slice(hit.index, i)) });
      for (const n of names) footer.push(`__exports.${n} = ${n};`);
      continue;
    }

    if (kindId && (kindId.name === "function" || kindId.name === "async" || kindId.name === "class")) {
      const m = /^(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)/.exec(src.slice(i, i + 200));
      if (!m) throw fail(i, `exported functions and classes must be named`);
      const name = m[1] ?? m[2];
      edits.push({ start: hit.index, end: i, text: blank(src.slice(hit.index, i)) });
      footer.push(`__exports.${name} = ${name};`);
      continue;
    }

    throw fail(hit.index, `could not parse export statement`);
  }

  // Apply edits back-to-front.
  edits.sort((a, b) => b.start - a.start);
  let body = src;
  for (const e of edits) {
    body = body.slice(0, e.start) + e.text + body.slice(e.end);
  }

  return { prelude, body, footer };
}
