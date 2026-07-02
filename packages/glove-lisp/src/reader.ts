/**
 * Tokenizer + reader. Source text → {@link Form}s.
 *
 * The read surface is the Clojure a model already writes: `()` calls, `[]`
 * vectors, `{}` maps, `:keywords`, `'quote`, `;` comments, and the `#(… % …)`
 * lambda shorthand (rewritten at read time into `(fn [%1 …] (…))` so the
 * evaluator never sees it). Errors carry position and name the fix — an
 * unreadable program should cost one corrected turn, not a spiral.
 */
import { Form, Keyword, LList, MapLit, Sym, Vec } from "./values";

interface Token {
  kind: "open" | "close" | "vopen" | "vclose" | "mopen" | "mclose" | "quote" | "lambda" | "atom" | "string";
  text: string;
  pos: number;
  line: number;
}

class ReadError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (kind: Token["kind"], text: string, pos: number) => tokens.push({ kind, text, pos, line });
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === ",") {
      i++;
      continue;
    }
    if (c === ";") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "(") { push("open", c, i); i++; continue; }
    if (c === ")") { push("close", c, i); i++; continue; }
    if (c === "[") { push("vopen", c, i); i++; continue; }
    if (c === "]") { push("vclose", c, i); i++; continue; }
    if (c === "{") { push("mopen", c, i); i++; continue; }
    if (c === "}") { push("mclose", c, i); i++; continue; }
    if (c === "'") { push("quote", c, i); i++; continue; }
    if (c === "#" && src[i + 1] === "(") { push("lambda", "#(", i); i += 2; continue; }
    if (c === '"') {
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
          const esc = src[i + 1];
          if (esc === "n") out += "\n";
          else if (esc === "t") out += "\t";
          else if (esc === '"') out += '"';
          else if (esc === "\\") out += "\\";
          else out += esc ?? "";
          i += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        if (ch === "\n") line++;
        out += ch;
        i++;
      }
      if (!closed) throw new ReadError(`line ${line}: unterminated string starting at position ${start} — close it with "`);
      push("string", out, start);
      continue;
    }
    // Atom: symbol / keyword / number / boolean / nil.
    const start = i;
    while (i < src.length && !' \t\r\n,()[]{}";'.includes(src[i])) i++;
    push("atom", src.slice(start, i), start);
  }
  return tokens;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function atom(text: string): Form {
  if (text === "nil") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith(":")) {
    if (text.length === 1) throw new ReadError("a bare ':' is not a keyword — write :name");
    return Keyword.for(text.slice(1));
  }
  if (NUMBER_RE.test(text)) return Number(text);
  return new Sym(text);
}

class Reader {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ReadError("unexpected end of input — a form is unclosed (check parens/brackets/braces balance)");
    this.pos++;
    return t;
  }
  done(): boolean {
    return this.pos >= this.tokens.length;
  }

  readForm(): Form {
    const t = this.next();
    switch (t.kind) {
      case "string":
        return t.text;
      case "atom":
        return atom(t.text);
      case "quote":
        return new LList([new Sym("quote"), this.readForm()]);
      case "open":
        return new LList(this.readSeq("close", `line ${t.line}: unclosed '(' — add the matching ')'`));
      case "vopen":
        return new Vec(this.readSeq("vclose", `line ${t.line}: unclosed '[' — add the matching ']'`));
      case "mopen": {
        const items = this.readSeq("mclose", `line ${t.line}: unclosed '{' — add the matching '}'`);
        if (items.length % 2 !== 0) {
          throw new ReadError(`line ${t.line}: map literal has an odd number of forms — maps are {:key value, …} pairs`);
        }
        const pairs: Array<[Form, Form]> = [];
        for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1]]);
        return new MapLit(pairs);
      }
      case "lambda":
        return rewriteLambda(this.readSeq("close", `line ${t.line}: unclosed '#(' — add the matching ')'`));
      case "close":
      case "vclose":
      case "mclose":
        throw new ReadError(`line ${t.line}: unexpected '${t.text}' — no matching opener`);
    }
  }

  private readSeq(closeKind: Token["kind"], unclosedMsg: string): Form[] {
    const items: Form[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) throw new ReadError(unclosedMsg);
      if (t.kind === closeKind) {
        this.pos++;
        return items;
      }
      items.push(this.readForm());
    }
  }
}

/** `#(= (:state %) "open")` → `(fn [%1] (= (:state %1) "open"))`. */
function rewriteLambda(body: Form[]): LList {
  let maxArg = 0;
  const walk = (f: Form): Form => {
    if (f instanceof Sym) {
      if (f.name === "%") {
        maxArg = Math.max(maxArg, 1);
        return new Sym("%1");
      }
      const m = /^%([1-9])$/.exec(f.name);
      if (m) maxArg = Math.max(maxArg, Number(m[1]));
      return f;
    }
    if (f instanceof LList) return new LList(f.items.map(walk));
    if (f instanceof Vec) return new Vec(f.items.map(walk));
    if (f instanceof MapLit) return new MapLit(f.pairs.map(([k, v]) => [walk(k), walk(v)] as [Form, Form]));
    return f;
  };
  const rewritten = body.map(walk);
  const params = Array.from({ length: maxArg }, (_, i) => new Sym(`%${i + 1}`));
  return new LList([new Sym("fn"), new Vec(params), new LList(rewritten)]);
}

/** Read every top-level form in `src`. */
export function readAll(src: string): Form[] {
  const reader = new Reader(tokenize(src));
  const forms: Form[] = [];
  while (!reader.done()) forms.push(reader.readForm());
  if (forms.length === 0) {
    throw new ReadError("no code to run — pass one or more Lisp forms, e.g. (tables)");
  }
  return forms;
}
