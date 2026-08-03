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
  /**
   * Exports declared with `let`/`var` that the module also reassigns.
   *
   * A NAMED import of one of these is a snapshot here and a live binding in
   * real ESM — the one divergence the transform cannot fix without rewriting
   * every identifier reference, which needs a parser. Recording the names
   * lets the importer be told, instead of quietly reading a stale value.
   */
  mutableExports: string[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const CONTINUATION_CHARS = new Set([",", "=", "+", "-", "*", "/", "%", "<", ">", "&", "|", "^", "?", ":", "(", "[", "{", ".", "!", "~"]);

/** `function g`, `function *g`, `function*g`, `async function* g`, `class X`. */
const NAMED_DECL_RE = /(?:async[ \t]+)?function[\s]*\*?[\s]*([A-Za-z_$][\w$]*)|class[\s]+([A-Za-z_$][\w$]*)/y;

/**
 * Match a named function/class declaration at `at`. Sticky rather than
 * slice-based: a fixed lookahead window truncates long names and silently
 * exports the wrong binding.
 */
function matchNamedDecl(src: string, at: number): RegExpExecArray | null {
  NAMED_DECL_RE.lastIndex = at;
  return NAMED_DECL_RE.exec(src);
}

/** Blank out comments so specifier lists can be split on commas safely. */
function stripComments(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i += 1;
      continue;
    }
    if (s[i] === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** Replace a span with newlines only, keeping line numbers stable. */
const blank = (span: string) => span.replace(/[^\n]/g, "");

/**
 * Export a binding LIVE. Node's module namespaces track the exporting
 * module's bindings, so a value mutated after evaluation is visible to
 * importers; a plain `__exports.x = x` snapshot is not.
 */
const liveExport = (exported: string, local: string) =>
  `Object.defineProperty(__exports, ${JSON.stringify(exported)}, { get: () => ${local}, enumerable: true, configurable: true });`;

export function transformModule(rawSrc: string, modulePath: string): TransformedModule {
  // A hashbang is legal at the top of a module but is a syntax error once the
  // body is wrapped in a function. Blank it, preserving the line.
  const src = rawSrc.startsWith("#!") ? rawSrc.replace(/^#![^\n]*/, (m) => blank(m)) : rawSrc;
  const { mask, hits } = scanModule(src);
  const edits: Edit[] = [];
  const prelude: string[] = [];
  const footer: string[] = [];
  const mutableCandidates: string[] = [];
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

  /**
   * The names a destructuring pattern binds.
   *
   * `start` points at the opening `{` or `[`; returns the bound names and the
   * index just past the matching close. Lexical, like everything else here —
   * no parser — but the grammar of a *pattern* is small and closed, which is
   * what makes that tractable where rewriting arbitrary identifier references
   * (see the live-binding limitation) is not.
   *
   * Handles renames (`{ a: b }` binds `b`), defaults (`{ a = 1 }` binds `a`),
   * rest (`...xs`), computed keys (`{ [k]: v }` binds `v`), array holes, and
   * nesting to any depth.
   */
  const patternNames = (start: number): { names: string[]; end: number } => {
    const open = src[start];
    if (open !== "{" && open !== "[") throw fail(start, `expected a destructuring pattern`);
    const close = matchDelim(src, mask, start);
    if (close < 0) throw fail(start, `unterminated destructuring pattern`);
    const names: string[] = [];

    /** Skip an initializer or computed key: forward to the next `,` at pattern depth. */
    const skipToSeparator = (from: number): number => {
      let depth = 0;
      let i = from;
      while (i < close) {
        if (!mask[i]) {
          i += 1;
          continue;
        }
        const c = src[i];
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") depth -= 1;
        else if (c === "," && depth === 0) return i;
        i += 1;
      }
      return close;
    };

    let i = skipTrivia(start + 1);
    while (i < close) {
      if (src[i] === ",") {
        i = skipTrivia(i + 1); // array hole, or the separator we just consumed
        continue;
      }
      const wasRest = src.startsWith("...", i);
      if (wasRest) i = skipTrivia(i + 3);

      // In an ARRAY pattern (or after a rest), a leading brace/bracket is a
      // nested pattern. In an OBJECT pattern it is a computed key — `{ [k]: v }`
      // binds `v`, not `k` — so it must not be recursed into.
      if ((open === "[" || wasRest) && (src[i] === "{" || src[i] === "[")) {
        const nested = patternNames(i);
        names.push(...nested.names);
        i = skipTrivia(skipToSeparator(nested.end));
        continue;
      }
      if (open === "{" && src[i] === "[") {
        const keyEnd = matchDelim(src, mask, i);
        if (keyEnd < 0) throw fail(i, `unterminated computed key in this destructuring pattern`);
        const afterKey = skipTrivia(keyEnd + 1);
        if (src[afterKey] !== ":") throw fail(afterKey, `expected ":" after a computed key in this destructuring pattern`);
        const target = skipTrivia(afterKey + 1);
        if (src[target] === "{" || src[target] === "[") {
          const nested = patternNames(target);
          names.push(...nested.names);
          i = skipTrivia(skipToSeparator(nested.end));
          continue;
        }
        const bound = readIdent(target);
        if (!bound) throw fail(target, `expected a binding name after a computed key`);
        names.push(bound.name);
        i = skipTrivia(skipToSeparator(bound.end));
        continue;
      }
      if (src[i] === "{" || src[i] === "[") {
        const nested = patternNames(i);
        names.push(...nested.names);
        i = skipTrivia(skipToSeparator(nested.end));
        continue;
      }

      const id = readIdent(i);
      if (!id) throw fail(i, `could not read the binding name in this destructuring pattern`);

      let after = skipTrivia(id.end);
      if (open === "{" && src[after] === ":") {
        // Renamed or nested: the binding is what follows the colon.
        after = skipTrivia(after + 1);
        if (src[after] === "{" || src[after] === "[") {
          const nested = patternNames(after);
          names.push(...nested.names);
          i = skipTrivia(skipToSeparator(nested.end));
          continue;
        }
        const target = readIdent(after);
        if (!target) throw fail(after, `expected a binding name after ":" in this destructuring pattern`);
        names.push(target.name);
        i = skipTrivia(skipToSeparator(target.end));
        continue;
      }

      names.push(id.name);
      i = skipTrivia(skipToSeparator(after));
    }
    return { names, end: close + 1 };
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

  /** Skip an `with { … }` / `assert { … }` import-attributes clause. */
  const skipAttributes = (i: number): number => {
    const j = skipTrivia(i);
    const kw = readIdent(j);
    if (!kw || (kw.name !== "with" && kw.name !== "assert")) return i;
    const braceAt = skipTrivia(kw.end);
    if (src[braceAt] !== "{") return i;
    const close = matchDelim(src, mask, braceAt);
    return close === -1 ? i : close + 1;
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
    const inner = stripComments(src.slice(openIdx + 1, close));
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
      // `import(` is also how a method named `import` is DEFINED
      // (`class A { import() {} }`). A definition is followed by its body,
      // a dynamic import by an expression continuation.
      const open = src.indexOf("(", hit.index);
      const close = open === -1 ? -1 : matchDelim(src, mask, open);
      let after = close + 1;
      while (after < src.length && /\s/.test(src[after])) after += 1;
      if (close !== -1 && src[after] === "{") continue; // method definition
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
        const stmtEnd = eatSemi(skipAttributes(end));
        edits.push({ start: hit.index, end: stmtEnd, text: blank(src.slice(hit.index, stmtEnd)) });
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
      const stmtEnd = eatSemi(skipAttributes(end));

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
      const decl = matchNamedDecl(src, after);
      if (decl) {
        const name = decl[1] ?? decl[2];
        edits.push({ start: hit.index, end: after, text: blank(src.slice(hit.index, after)) });
        footer.push(liveExport("default", name));
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
          footer.push(liveExport(it.local, it.outer));
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
      const names: string[] = [];
      let scanFrom: number;
      if (src[afterKind] === "{" || src[afterKind] === "[") {
        const pattern = patternNames(afterKind);
        names.push(...pattern.names);
        scanFrom = pattern.end;
      } else {
        const first = readIdent(afterKind);
        if (!first) throw fail(afterKind, `expected a binding name after "export ${kindId.name}"`);
        names.push(first.name);
        scanFrom = first.end;
      }
      // Scan the rest of the declaration for `, name` at declaration depth.
      let depth = 0;
      let k = scanFrom;
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
          // A declaration continues if the line ENDS with an operator or the
          // next line STARTS with one (comma-first style).
          const nextMeaningful = src[skipTrivia(k + 1)] ?? "";
          const continues =
            (lastCode !== "" && CONTINUATION_CHARS.has(lastCode)) || CONTINUATION_CHARS.has(nextMeaningful);
          if (!continues) break;
        } else if (depth === 0 && c === ",") {
          const next = skipTrivia(k + 1);
          if (src[next] === "{" || src[next] === "[") {
            const pattern = patternNames(next);
            names.push(...pattern.names);
            k = pattern.end;
            lastCode = src[pattern.end - 1];
            continue scan;
          }
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
      for (const n of names) footer.push(liveExport(n, n));
      if (kindId.name !== "const") mutableCandidates.push(...names);
      continue;
    }

    if (kindId && (kindId.name === "function" || kindId.name === "async" || kindId.name === "class")) {
      const m = matchNamedDecl(src, i);
      if (!m) throw fail(i, `exported functions and classes must be named`);
      const name = m[1] ?? m[2];
      edits.push({ start: hit.index, end: i, text: blank(src.slice(hit.index, i)) });
      footer.push(liveExport(name, name));
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

  return { prelude, body, footer, mutableExports: reassigned(mutableCandidates) };

  /**
   * Which of the `export let`/`export var` names the module actually mutates.
   *
   * `export let n = 0` that is never reassigned behaves identically whether
   * imported by name or through the namespace, so refusing it would cost a
   * retry for nothing. Only a binding that is genuinely written to later can
   * diverge. Lexical and deliberately narrow: an assignment operator or
   * ++/-- applied to the bare name at a code position, not after a dot.
   */
  function reassigned(candidates: string[]): string[] {
    if (candidates.length === 0) return [];
    const unique = [...new Set(candidates)];
    const hitNames = new Set<string>();
    for (const name of unique) {
      let from = 0;
      for (;;) {
        const at = src.indexOf(name, from);
        if (at < 0) break;
        from = at + name.length;
        if (!mask[at]) continue; // inside a string, comment, or template text
        const before = src[at - 1] ?? "";
        const after = src[from] ?? "";
        if (/[A-Za-z0-9_$]/.test(before) || /[A-Za-z0-9_$]/.test(after)) continue; // part of a longer name
        // Walk back over whitespace: a property access (`o.n = 1`) is not it.
        let b = at - 1;
        while (b >= 0 && /\s/.test(src[b])) b -= 1;
        if (src[b] === "." || src[b] === "?") continue;
        let f = from;
        while (f < src.length && /\s/.test(src[f])) f += 1;
        const tail = src.slice(f, f + 3);
        if (/^(\+\+|--)/.test(tail)) {
          hitNames.add(name);
          break;
        }
        // `=` but not `==`, `===`, `=>`; or a compound assignment.
        if (/^=[^=>]/.test(tail) || /^=$/.test(tail) || /^([+\-*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)=[^=]/.test(tail)) {
          // The declaration itself is an assignment; skip the one that IS it.
          let d = b;
          while (d >= 0 && /\s/.test(src[d])) d -= 1;
          const wordEnd = d + 1;
          while (d >= 0 && /[A-Za-z0-9_$]/.test(src[d])) d -= 1;
          if (["let", "var", "const"].includes(src.slice(d + 1, wordEnd))) continue;
          hitNames.add(name);
          break;
        }
      }
    }
    return [...hitNames];
  }
}
