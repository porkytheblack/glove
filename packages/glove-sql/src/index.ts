/**
 * glove-sql — a zero-dependency, pure-JS Postgres-subset SQL engine.
 *
 * An in-memory store whose tables are *constructed at runtime* from whatever data
 * is ingested (no fixed schema), driven by a small SQL engine — tokenizer +
 * recursive-descent parser + evaluator. It speaks a *defined Postgres subset*:
 *
 *   - DDL:   CREATE TABLE [IF NOT EXISTS] / CREATE TABLE … AS <select> /
 *            DROP TABLE [IF EXISTS] … [CASCADE]
 *   - DML:   INSERT … VALUES (…), (…)  ·  DELETE … [WHERE …]   (with $n params)
 *   - Query: SELECT [DISTINCT] … FROM (table | subquery | information_schema.columns)
 *            [INNER|LEFT|RIGHT|FULL|CROSS JOIN … ON …] [WHERE] [GROUP BY] [HAVING]
 *            [ORDER BY] [LIMIT] [OFFSET], WITH (CTEs), set ops (UNION/EXCEPT/INTERSECT),
 *            subqueries (scalar / IN / EXISTS, correlated), CASE, BETWEEN, FILTER,
 *            window functions (ROW_NUMBER / RANK / aggregate OVER / LAG / LEAD),
 *            a library of scalar functions, jsonb -> / ->>, and CAST / ::type.
 *
 * Anything outside the subset throws a clear error rather than silently
 * mis-answering. The whole store serialises to bytes via {@link MemoryBackend.dump}
 * and is reconstructed via {@link MemoryBackend.create}`({ load })` — "computation
 * as a value" with none of a real database's data-dir overhead.
 */

/**
 * The result of a query: rows plus the output field names, in order.
 * (Postgres returns far more field metadata; agents only need names.)
 */
export interface SqlResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID?: number }[];
}

/**
 * The minimal contract an embedded SQL engine exposes. {@link MemoryBackend} is
 * the zero-dependency pure-JS implementation; a consumer can also bring its own
 * backend (e.g. real Postgres / SQLite / PGlite) that speaks the same subset.
 */
export interface SqlBackend {
  /** Run a parameterised query (`$1`, `$2`, … placeholders). */
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  /** Run one or more statements with no result rows (DDL / batched DML). */
  exec(sql: string): Promise<void>;
  /** Serialise the entire backing state to bytes — "computation as a value". */
  dump(): Promise<Uint8Array>;
  /** Release any resources. */
  close(): Promise<void>;
}

/** Internal alias so the relocated engine body reads unchanged. */
type BackendResult = SqlResult;

// ─────────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────────

/** A stored column: its name and its Postgres-dialect type string. */
interface CatColumn {
  name: string;
  /** Postgres type as it appears in `information_schema` (e.g. `"bigint"`). */
  type: string;
  /** A default expression to apply when the column is omitted from an INSERT. */
  default?: Expr;
}

interface CatTable {
  name: string;
  columns: CatColumn[];
  rows: Record<string, unknown>[];
}

interface SerializedState {
  v: 1;
  clock: number;
  tables: Array<{ name: string; columns: CatColumn[]; rows: Record<string, unknown>[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────────────────

type TokType = "ident" | "string" | "number" | "param" | "op" | "punct" | "eof";

interface Token {
  type: TokType;
  /** Raw text for op/punct; value for string/number; identifier text for ident. */
  value: string;
  /** True for double-quoted identifiers (case preserved, never a keyword). */
  quoted?: boolean;
  /** 1-based index for `$n` params. */
  paramIndex?: number;
}

const MULTI_OPS = ["->>", "->", "::", "<=", ">=", "<>", "!=", "||"];
const SINGLE = new Set(["(", ")", ",", ".", "*", "+", "-", "/", "%", "=", "<", ">", ";"]);

function tokenize(sql: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    // line comment
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comment
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string literal
    if (c === "'") {
      i++;
      let s = "";
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += sql[i++];
      }
      toks.push({ type: "string", value: s });
      continue;
    }
    // quoted identifier
    if (c === '"') {
      i++;
      let s = "";
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += sql[i++];
      }
      toks.push({ type: "ident", value: s, quoted: true });
      continue;
    }
    // param $n
    if (c === "$" && /[0-9]/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(sql[j])) j++;
      toks.push({ type: "param", value: sql.slice(i, j), paramIndex: Number(sql.slice(i + 1, j)) });
      i = j;
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      if (sql[j] === "e" || sql[j] === "E") {
        j++;
        if (sql[j] === "+" || sql[j] === "-") j++;
        while (j < n && /[0-9]/.test(sql[j])) j++;
      }
      toks.push({ type: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    // word (identifier or keyword)
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      toks.push({ type: "ident", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    // multi-char operators
    let matched = false;
    for (const op of MULTI_OPS) {
      if (sql.startsWith(op, i)) {
        toks.push({ type: "op", value: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // single-char op / punct
    if (SINGLE.has(c)) {
      toks.push({ type: c === "(" || c === ")" || c === "," || c === "." ? "punct" : "op", value: c });
      i++;
      continue;
    }
    throw new Error(`MemoryBackend: unexpected character '${c}' at ${i} in SQL`);
  }
  toks.push({ type: "eof", value: "" });
  return toks;
}

// ─────────────────────────────────────────────────────────────────────────────
// AST
// ─────────────────────────────────────────────────────────────────────────────

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  | { k: "param"; i: number }
  | { k: "star" }
  | { k: "col"; table?: string; name: string }
  | { k: "func"; name: string; args: Expr[]; star?: boolean; filter?: Expr; over?: WindowSpec; distinct?: boolean }
  | { k: "unary"; op: string; e: Expr }
  | { k: "not"; e: Expr }
  | { k: "binary"; op: string; l: Expr; r: Expr }
  | { k: "is"; e: Expr; negated: boolean }
  | { k: "in"; e: Expr; list?: Expr[]; sub?: SelectStmt; negated: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; negated: boolean }
  | { k: "case"; operand?: Expr; whens: Array<{ when: Expr; then: Expr }>; els?: Expr }
  | { k: "subquery"; select: SelectStmt }
  | { k: "exists"; select: SelectStmt }
  | { k: "cast"; e: Expr; type: string }
  | { k: "json"; op: "->" | "->>"; l: Expr; r: Expr };

interface SelectItem {
  /** `*` (all aliases) */
  star?: boolean;
  /** `alias.*` */
  starQualifier?: string;
  expr?: Expr;
  alias?: string;
}

type FromItem =
  | { kind: "table"; name: string; alias: string }
  | { kind: "subquery"; select: SelectStmt; alias: string }
  | { kind: "infoschema"; alias: string };

interface JoinClause {
  type: "inner" | "left" | "right" | "full" | "cross";
  item: FromItem;
  on?: Expr;
}

interface OrderKey {
  expr: Expr;
  dir: "asc" | "desc";
}

/** `OVER (PARTITION BY … ORDER BY …)` — the window a window-function evaluates within. */
interface WindowSpec {
  partitionBy: Expr[];
  orderBy: OrderKey[];
}

type SetOp = "union" | "unionAll" | "intersect" | "except";

interface SelectStmt {
  k: "select";
  with?: Array<{ name: string; select: SelectStmt }>;
  distinct: boolean;
  items: SelectItem[];
  from?: FromItem;
  joins: JoinClause[];
  where?: Expr;
  groupBy: Expr[];
  having?: Expr;
  /** UNION/EXCEPT/INTERSECT branches; ORDER BY/LIMIT/OFFSET apply to the combined result. */
  setOps?: Array<{ op: SetOp; select: SelectStmt }>;
  orderBy: OrderKey[];
  limit?: number;
  offset?: number;
}

interface CreateTableStmt {
  k: "createTable";
  name: string;
  ifNotExists: boolean;
  columns: CatColumn[];
  asSelect?: SelectStmt;
}

interface DropTableStmt {
  k: "dropTable";
  name: string;
  ifExists: boolean;
}

interface InsertStmt {
  k: "insert";
  table: string;
  columns?: string[];
  rows: Expr[][];
}

interface DeleteStmt {
  k: "delete";
  table: string;
  where?: Expr;
}

type Stmt = SelectStmt | CreateTableStmt | DropTableStmt | InsertStmt | DeleteStmt;

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

const AGG_FUNCS = new Set(["count", "sum", "avg", "min", "max"]);

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(o = 0): Token {
    return this.toks[this.pos + o] ?? { type: "eof", value: "" };
  }
  private next(): Token {
    return this.toks[this.pos++] ?? { type: "eof", value: "" };
  }
  /** Match a keyword (case-insensitive, unquoted identifier) without consuming. */
  private isKw(kw: string, o = 0): boolean {
    const t = this.peek(o);
    return t.type === "ident" && !t.quoted && t.value.toLowerCase() === kw;
  }
  private acceptKw(kw: string): boolean {
    if (this.isKw(kw)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expectKw(kw: string): void {
    if (!this.acceptKw(kw)) throw this.err(`expected '${kw.toUpperCase()}'`);
  }
  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.type === "op" || t.type === "punct") && t.value === v;
  }
  private acceptOp(v: string): boolean {
    if (this.isOp(v)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expectOp(v: string): void {
    if (!this.acceptOp(v)) throw this.err(`expected '${v}'`);
  }
  private err(msg: string): Error {
    const t = this.peek();
    return new Error(`MemoryBackend SQL parse error: ${msg} (near '${t.value || "<eof>"}')`);
  }

  parseStatement(): Stmt {
    if (this.isKw("with") || this.isKw("select")) return this.parseSelect();
    if (this.isKw("create")) return this.parseCreate();
    if (this.isKw("drop")) return this.parseDrop();
    if (this.isKw("insert")) return this.parseInsert();
    if (this.isKw("delete")) return this.parseDelete();
    throw this.err("unsupported statement");
  }

  atEnd(): boolean {
    return this.peek().type === "eof";
  }

  // ── identifiers ───────────────────────────────────────────────────────────
  private ident(): string {
    const t = this.peek();
    if (t.type !== "ident") throw this.err("expected identifier");
    this.pos++;
    return t.value;
  }

  // ── CREATE ──────────────────────────────────────────────────────────────
  private parseCreate(): CreateTableStmt {
    this.expectKw("create");
    this.expectKw("table");
    const ifNotExists = this.acceptKw("if") ? (this.expectKw("not"), this.expectKw("exists"), true) : false;
    const name = this.ident();
    if (this.acceptKw("as")) {
      const select = this.parseSelect();
      return { k: "createTable", name, ifNotExists, columns: [], asSelect: select };
    }
    this.expectOp("(");
    const columns: CatColumn[] = [];
    do {
      // Could be a table-level constraint (PRIMARY KEY (...), FOREIGN KEY ...) — skip those.
      if (this.isKw("primary") || this.isKw("foreign") || this.isKw("unique") || this.isKw("constraint") || this.isKw("check")) {
        this.skipBalancedUntilColumnBoundary();
      } else {
        columns.push(this.parseColumnDef());
      }
    } while (this.acceptOp(","));
    this.expectOp(")");
    return { k: "createTable", name, ifNotExists, columns };
  }

  private parseColumnDef(): CatColumn {
    const name = this.ident();
    // type: one or more bare words until a constraint keyword / comma / close paren
    const typeWords: string[] = [];
    while (
      this.peek().type === "ident" &&
      !this.isConstraintKw() &&
      !this.isOp(",") &&
      !this.isOp(")")
    ) {
      typeWords.push(this.next().value);
      // some types carry a parenthesised size, e.g. varchar(255) — consume & ignore
      if (this.isOp("(")) this.skipParens();
    }
    const type = typeWords.join(" ").toLowerCase() || "text";
    let def: Expr | undefined;
    // constraints until a top-level comma or the closing paren
    while (!this.isOp(",") && !this.isOp(")") && this.peek().type !== "eof") {
      if (this.acceptKw("default")) {
        def = this.parseExpr();
        continue;
      }
      if (this.acceptKw("references")) {
        this.ident();
        if (this.isOp("(")) this.skipParens();
        continue;
      }
      if (this.acceptKw("check")) {
        if (this.isOp("(")) this.skipParens();
        continue;
      }
      // primary key / not null / unique / null — consume one token
      this.next();
    }
    return { name, type, default: def };
  }

  private isConstraintKw(): boolean {
    return (
      this.isKw("primary") ||
      this.isKw("not") ||
      this.isKw("null") ||
      this.isKw("default") ||
      this.isKw("references") ||
      this.isKw("unique") ||
      this.isKw("check") ||
      this.isKw("constraint")
    );
  }

  private skipParens(): void {
    this.expectOp("(");
    let depth = 1;
    while (depth > 0 && this.peek().type !== "eof") {
      if (this.isOp("(")) depth++;
      else if (this.isOp(")")) depth--;
      this.pos++;
    }
  }

  private skipBalancedUntilColumnBoundary(): void {
    let depth = 0;
    while (this.peek().type !== "eof") {
      if (this.isOp("(")) depth++;
      else if (this.isOp(")")) {
        if (depth === 0) break;
        depth--;
      } else if (this.isOp(",") && depth === 0) break;
      this.pos++;
    }
  }

  // ── DROP ────────────────────────────────────────────────────────────────
  private parseDrop(): DropTableStmt {
    this.expectKw("drop");
    this.expectKw("table");
    const ifExists = this.acceptKw("if") ? (this.expectKw("exists"), true) : false;
    const name = this.ident();
    this.acceptKw("cascade");
    this.acceptKw("restrict");
    return { k: "dropTable", name, ifExists };
  }

  // ── INSERT ──────────────────────────────────────────────────────────────
  private parseInsert(): InsertStmt {
    this.expectKw("insert");
    this.expectKw("into");
    const table = this.ident();
    let columns: string[] | undefined;
    if (this.isOp("(")) {
      this.expectOp("(");
      columns = [];
      do {
        columns.push(this.ident());
      } while (this.acceptOp(","));
      this.expectOp(")");
    }
    this.expectKw("values");
    const rows: Expr[][] = [];
    do {
      this.expectOp("(");
      const row: Expr[] = [];
      if (!this.isOp(")")) {
        do {
          row.push(this.parseExpr());
        } while (this.acceptOp(","));
      }
      this.expectOp(")");
      rows.push(row);
    } while (this.acceptOp(","));
    return { k: "insert", table, columns, rows };
  }

  // ── DELETE ──────────────────────────────────────────────────────────────
  private parseDelete(): DeleteStmt {
    this.expectKw("delete");
    this.expectKw("from");
    const table = this.ident();
    let where: Expr | undefined;
    if (this.acceptKw("where")) where = this.parseExpr();
    return { k: "delete", table, where };
  }

  // ── SELECT ──────────────────────────────────────────────────────────────
  private parseSelect(): SelectStmt {
    const stmt = this.parseSelectCore();
    // Set operations — the right side is a core; ORDER BY/LIMIT bind to the whole.
    while (this.isKw("union") || this.isKw("except") || this.isKw("intersect")) {
      const kw = this.next().value.toLowerCase();
      const all = this.acceptKw("all");
      const op: SetOp =
        kw === "union" ? (all ? "unionAll" : "union") : kw === "except" ? "except" : "intersect";
      (stmt.setOps ??= []).push({ op, select: this.parseSelectCore() });
    }
    if (this.acceptKw("order")) {
      this.expectKw("by");
      do {
        const expr = this.parseExpr();
        let dir: "asc" | "desc" = "asc";
        if (this.acceptKw("asc")) dir = "asc";
        else if (this.acceptKw("desc")) dir = "desc";
        // optional NULLS FIRST/LAST — accept & ignore (we default nulls-last asc)
        if (this.acceptKw("nulls")) {
          this.acceptKw("first") || this.acceptKw("last");
        }
        stmt.orderBy.push({ expr, dir });
      } while (this.acceptOp(","));
    }
    if (this.acceptKw("limit")) {
      const t = this.next();
      if (t.type !== "number") throw this.err("LIMIT expects a number");
      stmt.limit = Number(t.value);
    }
    if (this.acceptKw("offset")) {
      const t = this.next();
      if (t.type !== "number") throw this.err("OFFSET expects a number");
      stmt.offset = Number(t.value);
    }
    return stmt;
  }

  /** A select core: WITH … SELECT … FROM/JOIN/WHERE/GROUP/HAVING — no set-op, ORDER BY, or LIMIT. */
  private parseSelectCore(): SelectStmt {
    let withClauses: SelectStmt["with"];
    if (this.acceptKw("with")) {
      withClauses = [];
      do {
        const name = this.ident();
        this.expectKw("as");
        this.expectOp("(");
        const sub = this.parseSelect();
        this.expectOp(")");
        withClauses.push({ name, select: sub });
      } while (this.acceptOp(","));
    }

    this.expectKw("select");
    const distinct = this.acceptKw("distinct");

    const items: SelectItem[] = [];
    do {
      items.push(this.parseSelectItem());
    } while (this.acceptOp(","));

    const stmt: SelectStmt = {
      k: "select",
      with: withClauses,
      distinct,
      items,
      joins: [],
      groupBy: [],
      orderBy: [],
    };

    if (this.acceptKw("from")) {
      stmt.from = this.parseFromItem();
      for (;;) {
        if (this.acceptOp(",")) {
          stmt.joins.push({ type: "cross", item: this.parseFromItem() });
          continue;
        }
        const j = this.tryParseJoin();
        if (!j) break;
        stmt.joins.push(j);
      }
    }

    if (this.acceptKw("where")) stmt.where = this.parseExpr();
    if (this.acceptKw("group")) {
      this.expectKw("by");
      do {
        stmt.groupBy.push(this.parseExpr());
      } while (this.acceptOp(","));
    }
    if (this.acceptKw("having")) stmt.having = this.parseExpr();
    return stmt;
  }

  private parseSelectItem(): SelectItem {
    if (this.isOp("*")) {
      this.pos++;
      return { star: true };
    }
    // qualifier.*
    if (this.peek().type === "ident" && this.isOp(".", 1) && this.isOp("*", 2)) {
      const q = this.ident();
      this.expectOp(".");
      this.expectOp("*");
      return { starQualifier: q };
    }
    const expr = this.parseExpr();
    let alias: string | undefined;
    if (this.acceptKw("as")) {
      alias = this.ident();
    } else if (this.peek().type === "ident" && !this.isReservedFollow()) {
      // implicit alias: `expr alias`
      alias = this.ident();
    }
    return { expr, alias };
  }

  /** Keywords that may follow a select expression and must NOT be eaten as an alias. */
  private isReservedFollow(): boolean {
    return (
      this.isKw("from") ||
      this.isKw("where") ||
      this.isKw("group") ||
      this.isKw("order") ||
      this.isKw("having") ||
      this.isKw("limit") ||
      this.isKw("offset") ||
      this.isKw("join") ||
      this.isKw("inner") ||
      this.isKw("left") ||
      this.isKw("right") ||
      this.isKw("full") ||
      this.isKw("outer") ||
      this.isKw("cross") ||
      this.isKw("on") ||
      this.isKw("as") ||
      this.isKw("union") ||
      this.isKw("except") ||
      this.isKw("intersect")
    );
  }

  private parseFromItem(): FromItem {
    if (this.isOp("(")) {
      this.expectOp("(");
      const select = this.parseSelect();
      this.expectOp(")");
      const alias = this.parseAlias() ?? "_sub";
      return { kind: "subquery", select, alias };
    }
    // dotted name (schema.table) — only information_schema.columns is special
    let name = this.ident();
    if (this.isOp(".")) {
      this.expectOp(".");
      name = `${name}.${this.ident()}`;
    }
    const alias = this.parseAlias();
    if (name.toLowerCase() === "information_schema.columns") {
      return { kind: "infoschema", alias: alias ?? name };
    }
    return { kind: "table", name, alias: alias ?? name };
  }

  private parseAlias(): string | undefined {
    if (this.acceptKw("as")) return this.ident();
    if (this.peek().type === "ident" && !this.isReservedFollow()) return this.ident();
    return undefined;
  }

  private tryParseJoin(): JoinClause | null {
    let type: JoinClause["type"] = "inner";
    const start = this.pos;
    if (this.acceptKw("inner")) {
      type = "inner";
    } else if (this.acceptKw("left")) {
      this.acceptKw("outer");
      type = "left";
    } else if (this.acceptKw("right")) {
      this.acceptKw("outer");
      type = "right";
    } else if (this.acceptKw("full")) {
      this.acceptKw("outer");
      type = "full";
    } else if (this.acceptKw("cross")) {
      type = "cross";
    }
    if (!this.acceptKw("join")) {
      this.pos = start;
      return null;
    }
    const item = this.parseFromItem();
    let on: Expr | undefined;
    if (this.acceptKw("on")) on = this.parseExpr();
    return { type, item, on };
  }

  // ── expressions (precedence climbing) ──────────────────────────────────────
  parseExpr(): Expr {
    return this.parseOr();
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isKw("or")) {
      this.pos++;
      l = { k: "binary", op: "or", l, r: this.parseAnd() };
    }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isKw("and")) {
      this.pos++;
      l = { k: "binary", op: "and", l, r: this.parseNot() };
    }
    return l;
  }
  private parseNot(): Expr {
    if (this.acceptKw("not")) return { k: "not", e: this.parseNot() };
    return this.parseComparison();
  }
  private parseComparison(): Expr {
    let l = this.parseAdditive();
    for (;;) {
      if (this.isOp("=") || this.isOp("<>") || this.isOp("!=") || this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=")) {
        const op = this.next().value;
        l = { k: "binary", op: op === "!=" ? "<>" : op, l, r: this.parseAdditive() };
        continue;
      }
      if (this.isKw("like") || this.isKw("ilike")) {
        const op = this.next().value.toLowerCase();
        l = { k: "binary", op, l, r: this.parseAdditive() };
        continue;
      }
      if (this.isKw("is")) {
        this.pos++;
        const negated = this.acceptKw("not");
        this.expectKw("null");
        l = { k: "is", e: l, negated };
        continue;
      }
      if (this.isKw("in") || (this.isKw("not") && this.isKw("in", 1))) {
        const negated = this.acceptKw("not");
        this.expectKw("in");
        this.expectOp("(");
        if (this.isKw("select") || this.isKw("with")) {
          const sub = this.parseSelect();
          this.expectOp(")");
          l = { k: "in", e: l, sub, negated };
          continue;
        }
        const list: Expr[] = [];
        if (!this.isOp(")")) {
          do {
            list.push(this.parseExpr());
          } while (this.acceptOp(","));
        }
        this.expectOp(")");
        l = { k: "in", e: l, list, negated };
        continue;
      }
      if (this.isKw("between") || (this.isKw("not") && this.isKw("between", 1))) {
        const negated = this.acceptKw("not");
        this.expectKw("between");
        const lo = this.parseAdditive();
        this.expectKw("and");
        const hi = this.parseAdditive();
        l = { k: "between", e: l, lo, hi, negated };
        continue;
      }
      break;
    }
    return l;
  }
  private parseAdditive(): Expr {
    let l = this.parseMultiplicative();
    for (;;) {
      if (this.isOp("+") || this.isOp("-") || this.isOp("||")) {
        const op = this.next().value;
        l = { k: "binary", op, l, r: this.parseMultiplicative() };
        continue;
      }
      break;
    }
    return l;
  }
  private parseMultiplicative(): Expr {
    let l = this.parseUnary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = this.next().value;
        l = { k: "binary", op, l, r: this.parseUnary() };
        continue;
      }
      break;
    }
    return l;
  }
  private parseUnary(): Expr {
    if (this.isOp("-")) {
      this.pos++;
      return { k: "unary", op: "-", e: this.parseUnary() };
    }
    if (this.isOp("+")) {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isOp("->") || this.isOp("->>")) {
        const op = this.next().value as "->" | "->>";
        e = { k: "json", op, l: e, r: this.parsePrimary() };
        continue;
      }
      if (this.isOp("::")) {
        this.pos++;
        // type may be multiple words (double precision)
        const words: string[] = [this.ident()];
        while (this.peek().type === "ident" && !this.isReservedFollow() && !this.isOp(",") && !this.isOp(")")) {
          // only continue for known 2-word types
          if (words.join(" ").toLowerCase() === "double") words.push(this.next().value);
          else break;
        }
        if (this.isOp("(")) this.skipParens(); // e.g. ::numeric(10,2)
        e = { k: "cast", e, type: words.join(" ").toLowerCase() };
        continue;
      }
      break;
    }
    return e;
  }
  private parsePrimary(): Expr {
    const t = this.peek();
    if (this.isOp("(")) {
      this.pos++;
      if (this.isKw("select") || this.isKw("with")) {
        const select = this.parseSelect();
        this.expectOp(")");
        return { k: "subquery", select };
      }
      const e = this.parseExpr();
      this.expectOp(")");
      return e;
    }
    if (t.type === "number") {
      this.pos++;
      return { k: "num", v: Number(t.value) };
    }
    if (t.type === "string") {
      this.pos++;
      return { k: "str", v: t.value };
    }
    if (t.type === "param") {
      this.pos++;
      return { k: "param", i: t.paramIndex! };
    }
    if (this.isOp("*")) {
      this.pos++;
      return { k: "star" };
    }
    if (t.type === "ident") {
      const lower = t.value.toLowerCase();
      if (!t.quoted && lower === "true") {
        this.pos++;
        return { k: "bool", v: true };
      }
      if (!t.quoted && lower === "false") {
        this.pos++;
        return { k: "bool", v: false };
      }
      if (!t.quoted && lower === "null") {
        this.pos++;
        return { k: "null" };
      }
      // EXISTS (subquery)
      if (!t.quoted && lower === "exists" && this.isOp("(", 1)) {
        this.pos++; // exists
        this.expectOp("(");
        const select = this.parseSelect();
        this.expectOp(")");
        return { k: "exists", select };
      }
      // CASE … WHEN … END
      if (!t.quoted && lower === "case") {
        return this.parseCase();
      }
      // CAST(expr AS type) — alternate cast syntax (the `::type` form is in parsePostfix).
      if (!t.quoted && lower === "cast" && this.isOp("(", 1)) {
        this.pos++; // cast
        this.expectOp("(");
        const e = this.parseExpr();
        this.expectKw("as");
        const type = this.parseTypeName();
        this.expectOp(")");
        return { k: "cast", e, type };
      }
      // function call?
      if (this.isOp("(", 1)) {
        const name = this.next().value.toLowerCase();
        this.expectOp("(");
        let star = false;
        let distinct = false;
        const args: Expr[] = [];
        if (this.isOp("*")) {
          this.pos++;
          star = true;
        } else if (!this.isOp(")")) {
          distinct = this.acceptKw("distinct");
          do {
            args.push(this.parseExpr());
          } while (this.acceptOp(","));
        }
        this.expectOp(")");
        // aggregate FILTER (WHERE …)
        let filter: Expr | undefined;
        if (this.isKw("filter")) {
          this.pos++;
          this.expectOp("(");
          this.expectKw("where");
          filter = this.parseExpr();
          this.expectOp(")");
        }
        // window: OVER (PARTITION BY … ORDER BY …)
        let over: WindowSpec | undefined;
        if (this.isKw("over")) {
          this.pos++;
          this.expectOp("(");
          const partitionBy: Expr[] = [];
          if (this.acceptKw("partition")) {
            this.expectKw("by");
            do {
              partitionBy.push(this.parseExpr());
            } while (this.acceptOp(","));
          }
          const orderBy: OrderKey[] = [];
          if (this.acceptKw("order")) {
            this.expectKw("by");
            do {
              const expr = this.parseExpr();
              let dir: "asc" | "desc" = "asc";
              if (this.acceptKw("asc")) dir = "asc";
              else if (this.acceptKw("desc")) dir = "desc";
              if (this.acceptKw("nulls")) this.acceptKw("first") || this.acceptKw("last");
              orderBy.push({ expr, dir });
            } while (this.acceptOp(","));
          }
          this.expectOp(")");
          over = { partitionBy, orderBy };
        }
        return { k: "func", name, args, star, filter, over, distinct };
      }
      // column reference, possibly qualified table.col
      this.pos++;
      if (this.isOp(".")) {
        this.expectOp(".");
        const col = this.ident();
        return { k: "col", table: t.value, name: col };
      }
      return { k: "col", name: t.value };
    }
    throw this.err("unexpected token in expression");
  }

  private parseCase(): Expr {
    this.expectKw("case");
    // Simple form `CASE <operand> WHEN <value> …` vs searched `CASE WHEN <cond> …`.
    let operand: Expr | undefined;
    if (!this.isKw("when")) operand = this.parseExpr();
    const whens: Array<{ when: Expr; then: Expr }> = [];
    while (this.acceptKw("when")) {
      const when = this.parseExpr();
      this.expectKw("then");
      const then = this.parseExpr();
      whens.push({ when, then });
    }
    let els: Expr | undefined;
    if (this.acceptKw("else")) els = this.parseExpr();
    this.expectKw("end");
    return { k: "case", operand, whens, els };
  }

  /** Parse a type name after AS / `::` — handles `double precision` and `numeric(p,s)`. */
  private parseTypeName(): string {
    const words: string[] = [this.ident()];
    if (
      words[0].toLowerCase() === "double" &&
      this.peek().type === "ident" &&
      this.peek().value.toLowerCase() === "precision"
    ) {
      words.push(this.next().value);
    }
    if (this.isOp("(")) this.skipParens(); // e.g. numeric(10,2)
    return words.join(" ").toLowerCase();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

/** A row during FROM/JOIN evaluation: alias → { column → value }. */
type JoinedRow = Map<string, Record<string, unknown>>;

interface RowSet {
  columns: string[];
  rows: Record<string, unknown>[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Infer the Postgres-dialect type string for a derived column from its values. */
function inferPgType(values: unknown[]): string {
  let sawNum = false;
  let sawFloat = false;
  let sawBool = false;
  let sawStr = false;
  let sawJson = false;
  let sawAny = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sawAny = true;
    if (typeof v === "boolean") sawBool = true;
    else if (typeof v === "number") {
      sawNum = true;
      if (!Number.isInteger(v)) sawFloat = true;
    } else if (typeof v === "string") sawStr = true;
    else sawJson = true;
  }
  if (!sawAny) return "text";
  if (sawJson) return "jsonb";
  if (sawBool && !sawNum && !sawStr) return "boolean";
  if (sawNum && !sawBool && !sawStr) return sawFloat ? "double precision" : "bigint";
  if (sawStr && !sawNum && !sawBool) return "text";
  return "jsonb";
}

export interface MemoryBackendOptions {
  /** Restore from a previous {@link Scratchpad.snapshot} (bytes from `dump()`). */
  load?: Uint8Array;
}

/** Sentinel: a column name is absent in a scope (distinct from a null value). */
const COLUMN_ABSENT = Symbol("column_absent");

export class MemoryBackend implements SqlBackend {
  private tables = new Map<string, CatTable>();
  /** Stack of enclosing rows, so a correlated subquery can resolve outer columns. */
  private subqueryOuter: JoinedRow[] = [];
  /** Active window-function values during a windowed projection (expr → value per row). */
  private currentWindow: { vals: Map<Expr, unknown[]>; index: number } | null = null;
  /** Monotonic logical clock backing `now()` so insert order is always stable. */
  private clock: number;

  private constructor(seed: number) {
    this.clock = seed;
  }

  static async create(opts: MemoryBackendOptions = {}): Promise<MemoryBackend> {
    // Seed the clock from wall time for human-readable timestamps; it only ever
    // increases, so ordering is correct regardless of clock resolution.
    const be = new MemoryBackend(Date.now());
    if (opts.load) be.restore(opts.load);
    return be;
  }

  // ── SqlBackend ─────────────────────────────────────────────────────────────

  async query(sql: string, params: unknown[] = []): Promise<BackendResult> {
    let result: BackendResult = { rows: [], fields: [] };
    for (const stmt of this.parseAll(sql)) {
      result = this.run(stmt, params);
    }
    return result;
  }

  async exec(sql: string): Promise<void> {
    for (const stmt of this.parseAll(sql)) this.run(stmt, []);
  }

  async dump(): Promise<Uint8Array> {
    const state: SerializedState = {
      v: 1,
      clock: this.clock,
      tables: [...this.tables.values()].map((t) => ({
        name: t.name,
        columns: t.columns,
        rows: t.rows,
      })),
    };
    return new TextEncoder().encode(JSON.stringify(state));
  }

  async close(): Promise<void> {
    this.tables.clear();
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private restore(bytes: Uint8Array): void {
    const state = JSON.parse(new TextDecoder().decode(bytes)) as SerializedState;
    this.clock = state.clock ?? this.clock;
    this.tables.clear();
    for (const t of state.tables) {
      this.tables.set(t.name, { name: t.name, columns: t.columns, rows: t.rows });
    }
  }

  private now(): string {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }

  private parseAll(sql: string): Stmt[] {
    const toks = tokenize(sql);
    const out: Stmt[] = [];
    // split into statements on top-level ';'
    let segment: Token[] = [];
    for (const t of toks) {
      if ((t.type === "op") && t.value === ";") {
        if (segment.some((s) => s.type !== "eof")) {
          out.push(this.parseSegment(segment));
        }
        segment = [];
        continue;
      }
      if (t.type === "eof") break;
      segment.push(t);
    }
    if (segment.length > 0) out.push(this.parseSegment(segment));
    return out;
  }

  private parseSegment(seg: Token[]): Stmt {
    const p = new Parser([...seg, { type: "eof", value: "" }]);
    const stmt = p.parseStatement();
    if (!p.atEnd()) throw new Error("MemoryBackend: trailing tokens after statement");
    return stmt;
  }

  private getTable(name: string): CatTable {
    const t = this.tables.get(name);
    if (!t) throw new Error(`MemoryBackend: relation "${name}" does not exist`);
    return t;
  }

  // ── statement dispatch ────────────────────────────────────────────────────

  private run(stmt: Stmt, params: unknown[]): BackendResult {
    switch (stmt.k) {
      case "select": {
        const rs = this.execSelect(stmt, params, new Map());
        return { rows: rs.rows, fields: rs.columns.map((name) => ({ name })) };
      }
      case "createTable":
        this.execCreateTable(stmt, params);
        return { rows: [], fields: [] };
      case "dropTable":
        this.tables.delete(stmt.name);
        return { rows: [], fields: [] };
      case "insert":
        this.execInsert(stmt, params);
        return { rows: [], fields: [] };
      case "delete":
        this.execDelete(stmt, params);
        return { rows: [], fields: [] };
    }
  }

  private execCreateTable(stmt: CreateTableStmt, params: unknown[]): void {
    if (this.tables.has(stmt.name)) {
      if (stmt.ifNotExists) return;
      throw new Error(`MemoryBackend: relation "${stmt.name}" already exists`);
    }
    if (stmt.asSelect) {
      const rs = this.execSelect(stmt.asSelect, params, new Map());
      const columns: CatColumn[] = rs.columns.map((name) => ({
        name,
        type: inferPgType(rs.rows.map((r) => r[name])),
      }));
      this.tables.set(stmt.name, { name: stmt.name, columns, rows: rs.rows });
      return;
    }
    this.tables.set(stmt.name, { name: stmt.name, columns: stmt.columns, rows: [] });
  }

  private execInsert(stmt: InsertStmt, params: unknown[]): void {
    const table = this.getTable(stmt.table);
    const colNames = stmt.columns ?? table.columns.map((c) => c.name);
    for (const valueExprs of stmt.rows) {
      if (valueExprs.length !== colNames.length) {
        throw new Error(`MemoryBackend: INSERT column/value count mismatch on "${stmt.table}"`);
      }
      const row: Record<string, unknown> = {};
      const provided = new Set<string>();
      for (let i = 0; i < colNames.length; i++) {
        row[colNames[i]] = this.evalExpr(valueExprs[i], new Map(), params);
        provided.add(colNames[i]);
      }
      for (const col of table.columns) {
        if (provided.has(col.name)) continue;
        row[col.name] = col.default ? this.evalExpr(col.default, new Map(), params) : null;
      }
      table.rows.push(row);
    }
  }

  private execDelete(stmt: DeleteStmt, params: unknown[]): void {
    const table = this.getTable(stmt.table);
    if (!stmt.where) {
      table.rows = [];
      return;
    }
    table.rows = table.rows.filter((r) => {
      const jr: JoinedRow = new Map([[stmt.table, r]]);
      return !truthy(this.evalExpr(stmt.where!, jr, params));
    });
  }

  // ── SELECT ────────────────────────────────────────────────────────────────

  private execSelect(stmt: SelectStmt, params: unknown[], ctes: Map<string, RowSet>): RowSet {
    if (stmt.setOps?.length) return this.execSetOps(stmt, params, ctes);
    // Resolve CTEs first (each can see earlier ones).
    if (stmt.with) {
      const merged = new Map(ctes);
      for (const cte of stmt.with) {
        merged.set(cte.name, this.execSelect(cte.select, params, merged));
      }
      ctes = merged;
    }

    // FROM + JOINs → joined rows with an alias→columns map.
    const aliasCols = new Map<string, string[]>();
    let joined: JoinedRow[];
    if (!stmt.from) {
      joined = [new Map()];
    } else {
      const base = this.resolveFrom(stmt.from, params, ctes);
      aliasCols.set(base.alias, base.columns);
      joined = base.rows.map((r) => new Map([[base.alias, r]]));
      for (const join of stmt.joins) {
        const right = this.resolveFrom(join.item, params, ctes);
        aliasCols.set(right.alias, right.columns);
        joined = this.applyJoin(joined, right, join, params);
      }
    }

    // WHERE
    if (stmt.where) {
      joined = joined.filter((jr) => truthy(this.evalExpr(stmt.where!, jr, params)));
    }

    const hasAgg = stmt.items.some((it) => it.expr && containsAggregate(it.expr)) || stmt.groupBy.length > 0;

    let out: Record<string, unknown>[];
    let columns: string[];
    let outGroups: JoinedRow[][] = [];

    if (hasAgg) {
      ({ out, columns, outGroups } = this.projectAggregate(stmt, joined, params));
    } else {
      columns = this.outputColumns(stmt, aliasCols);
      const winFns = this.collectWindowFuncs(stmt.items);
      if (winFns.length > 0) {
        const winVals = this.computeWindows(winFns, joined, params);
        const prev = this.currentWindow;
        out = joined.map((jr, i) => {
          this.currentWindow = { vals: winVals, index: i };
          return this.projectRow(stmt.items, jr, params, aliasCols);
        });
        this.currentWindow = prev;
      } else {
        out = joined.map((jr) => this.projectRow(stmt.items, jr, params, aliasCols));
      }
    }

    // ORDER BY (evaluate against the joined row, then fall back to output alias)
    if (stmt.orderBy.length > 0) {
      // ORDER BY <ordinal> → the output column at that position.
      const keys = stmt.orderBy.map((k) =>
        k.expr.k === "num" && Number.isInteger(k.expr.v) && k.expr.v >= 1 && k.expr.v <= columns.length
          ? { ...k, expr: { k: "col", name: columns[k.expr.v - 1] } as Expr }
          : k,
      );
      if (hasAgg) {
        // Aggregate query: out has one row per GROUP — evaluate ORDER BY over the
        // group (so ORDER BY <grouping col> / <aggregate> is correct), not over a
        // misaligned pre-aggregation joined row.
        const decorated = out.map((row, idx) => ({ row, group: outGroups[idx], idx }));
        decorated.sort((a, b) => {
          for (const key of keys) {
            const av = this.orderValueAgg(key.expr, a, params);
            const bv = this.orderValueAgg(key.expr, b, params);
            const cmp = compareValues(av, bv);
            if (cmp !== 0) return key.dir === "desc" ? -cmp : cmp;
          }
          return a.idx - b.idx;
        });
        out = decorated.map((d) => d.row);
      } else {
        const decorated = out.map((row, idx) => ({ row, jr: joined[idx], idx }));
        decorated.sort((a, b) => {
          for (const key of keys) {
            const av = this.orderValue(key.expr, a, params);
            const bv = this.orderValue(key.expr, b, params);
            const cmp = compareValues(av, bv);
            if (cmp !== 0) return key.dir === "desc" ? -cmp : cmp;
          }
          return a.idx - b.idx; // stable
        });
        out = decorated.map((d) => d.row);
      }
    }

    if (stmt.distinct) {
      const seen = new Set<string>();
      out = out.filter((r) => {
        const k = stableKey(columns.map((c) => r[c]));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    const offset = stmt.offset ?? 0;
    if (offset > 0) out = out.slice(offset);
    if (stmt.limit !== undefined) out = out.slice(0, Math.max(0, stmt.limit));

    return { columns, rows: out };
  }

  /** UNION / EXCEPT / INTERSECT: combine branch row-sets, then ORDER/OFFSET/LIMIT the whole. */
  private execSetOps(stmt: SelectStmt, params: unknown[], ctes: Map<string, RowSet>): RowSet {
    const left = this.execBranch(stmt, params, ctes);
    const columns = left.columns;
    let rows = left.rows;
    for (const so of stmt.setOps!) {
      const right = this.execBranch(so.select, params, ctes);
      const aligned = this.alignColumns(columns, right.columns, right.rows);
      rows = this.combineSet(so.op, columns, rows, aligned);
    }
    if (stmt.orderBy.length > 0) {
      const valueOf = (row: Record<string, unknown>, key: OrderKey): unknown =>
        key.expr.k === "num"
          ? row[columns[Number(key.expr.v) - 1]]
          : this.evalExpr(key.expr, new Map([["", row]]), params);
      rows = rows.slice().sort((a, b) => {
        for (const key of stmt.orderBy) {
          const cmp = compareValues(valueOf(a, key), valueOf(b, key));
          if (cmp !== 0) return key.dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    const offset = stmt.offset ?? 0;
    if (offset > 0) rows = rows.slice(offset);
    if (stmt.limit !== undefined) rows = rows.slice(0, Math.max(0, stmt.limit));
    return { columns, rows };
  }

  /** Run one set-op branch's core (its own set-ops / ORDER BY / LIMIT are deferred to the parent). */
  private execBranch(stmt: SelectStmt, params: unknown[], ctes: Map<string, RowSet>): RowSet {
    return this.execSelect(
      { ...stmt, setOps: undefined, orderBy: [], limit: undefined, offset: undefined },
      params,
      ctes,
    );
  }

  /** Set operations align by column POSITION — rename the source columns to the target (left) names. */
  private alignColumns(
    target: string[],
    src: string[],
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    if (src.length === target.length && src.every((c, i) => c === target[i])) return rows;
    return rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < target.length; i++) o[target[i]] = r[src[i]];
      return o;
    });
  }

  private combineSet(
    op: SetOp,
    columns: string[],
    left: Record<string, unknown>[],
    right: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const key = (r: Record<string, unknown>) => stableKey(columns.map((c) => r[c]));
    if (op === "unionAll") return left.concat(right);
    if (op === "union") {
      const seen = new Set<string>();
      const out: Record<string, unknown>[] = [];
      for (const r of left.concat(right)) {
        const k = key(r);
        if (!seen.has(k)) { seen.add(k); out.push(r); }
      }
      return out;
    }
    // INTERSECT / EXCEPT — DISTINCT by default.
    const rset = new Set(right.map(key));
    const want = op === "intersect";
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (const r of left) {
      const k = key(r);
      if (rset.has(k) === want && !seen.has(k)) { seen.add(k); out.push(r); }
    }
    return out;
  }

  private orderValue(
    expr: Expr,
    d: { row: Record<string, unknown>; jr: JoinedRow },
    params: unknown[],
  ): unknown {
    // Allow ORDER BY <output alias> when the expr is a bare name present in output.
    if (expr.k === "col" && !expr.table && expr.name in d.row && !this.aliasHasColumn(d.jr, expr.name)) {
      return d.row[expr.name];
    }
    try {
      return this.evalExpr(expr, d.jr, params);
    } catch {
      return expr.k === "col" ? d.row[expr.name] : null;
    }
  }

  /** ORDER BY value for an aggregate query: output alias first, else evaluate over the group. */
  private orderValueAgg(
    expr: Expr,
    d: { row: Record<string, unknown>; group: JoinedRow[] },
    params: unknown[],
  ): unknown {
    if (expr.k === "col" && !expr.table && expr.name in d.row) return d.row[expr.name];
    try {
      return this.evalAggExpr(expr, d.group ?? [], params);
    } catch {
      return expr.k === "col" ? (d.row[expr.name] ?? null) : null;
    }
  }

  private aliasHasColumn(jr: JoinedRow, name: string): boolean {
    for (const rec of jr.values()) if (name in rec) return true;
    return false;
  }

  private outputColumns(stmt: SelectStmt, aliasCols: Map<string, string[]>): string[] {
    const cols: string[] = [];
    for (const it of stmt.items) {
      if (it.star) {
        for (const list of aliasCols.values()) cols.push(...list);
      } else if (it.starQualifier) {
        cols.push(...(aliasCols.get(it.starQualifier) ?? []));
      } else if (it.expr) {
        cols.push(it.alias ?? inferColName(it.expr));
      }
    }
    return cols;
  }

  private projectRow(
    items: SelectItem[],
    jr: JoinedRow,
    params: unknown[],
    aliasCols: Map<string, string[]>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const it of items) {
      if (it.star) {
        for (const [alias, list] of aliasCols) {
          const rec = jr.get(alias) ?? {};
          for (const c of list) row[c] = rec[c];
        }
      } else if (it.starQualifier) {
        const rec = jr.get(it.starQualifier) ?? {};
        for (const c of aliasCols.get(it.starQualifier) ?? []) row[c] = rec[c];
      } else if (it.expr) {
        row[it.alias ?? inferColName(it.expr)] = this.evalExpr(it.expr, jr, params);
      }
    }
    return row;
  }

  private projectAggregate(
    stmt: SelectStmt,
    joined: JoinedRow[],
    params: unknown[],
  ): { out: Record<string, unknown>[]; columns: string[]; outGroups: JoinedRow[][] } {
    const columns = stmt.items.map((it) => it.alias ?? (it.expr ? inferColName(it.expr) : "?column?"));

    // GROUP BY <ordinal> → the matching SELECT item's expression.
    const groupExprs = stmt.groupBy.map((g) =>
      g.k === "num" && Number.isInteger(g.v) && g.v >= 1 && g.v <= stmt.items.length
        ? stmt.items[g.v - 1].expr ?? g
        : g,
    );

    // group rows
    let groups: JoinedRow[][];
    if (groupExprs.length === 0) {
      groups = [joined]; // single group (even when empty → one aggregate row)
    } else {
      const map = new Map<string, JoinedRow[]>();
      const order: string[] = [];
      for (const jr of joined) {
        const key = stableKey(groupExprs.map((g) => this.evalExpr(g, jr, params)));
        if (!map.has(key)) {
          map.set(key, []);
          order.push(key);
        }
        map.get(key)!.push(jr);
      }
      groups = order.map((k) => map.get(k)!);
    }

    const out: Record<string, unknown>[] = [];
    const outGroups: JoinedRow[][] = [];
    for (const group of groups) {
      if (stmt.having && !truthy(this.evalAggExpr(stmt.having, group, params))) continue;
      const row: Record<string, unknown> = {};
      for (const it of stmt.items) {
        if (!it.expr) throw new Error("MemoryBackend: '*' is not valid in an aggregate select");
        row[it.alias ?? inferColName(it.expr)] = this.evalAggExpr(it.expr, group, params);
      }
      out.push(row);
      outGroups.push(group); // parallel to `out`, for ORDER BY over the group
    }
    return { out, columns, outGroups };
  }

  // ── FROM resolution ───────────────────────────────────────────────────────

  private resolveFrom(
    item: FromItem,
    params: unknown[],
    ctes: Map<string, RowSet>,
  ): { alias: string; columns: string[]; rows: Record<string, unknown>[] } {
    if (item.kind === "subquery") {
      const rs = this.execSelect(item.select, params, ctes);
      return { alias: item.alias, columns: rs.columns, rows: rs.rows };
    }
    if (item.kind === "infoschema") {
      return { alias: item.alias, columns: INFO_COLUMNS, rows: this.infoSchemaRows() };
    }
    // CTE shadows a real table of the same name
    const cte = ctes.get(item.name);
    if (cte) return { alias: item.alias, columns: cte.columns, rows: cte.rows };
    const table = this.getTable(item.name);
    return {
      alias: item.alias,
      columns: table.columns.map((c) => c.name),
      rows: table.rows,
    };
  }

  private applyJoin(
    left: JoinedRow[],
    right: { alias: string; columns: string[]; rows: Record<string, unknown>[] },
    join: JoinClause,
    params: unknown[],
  ): JoinedRow[] {
    const result: JoinedRow[] = [];
    const rightNull: Record<string, unknown> = {};
    for (const c of right.columns) rightNull[c] = null;
    const keepLeftUnmatched = join.type === "left" || join.type === "full";
    const keepRightUnmatched = join.type === "right" || join.type === "full";
    const rightMatched = new Array<boolean>(right.rows.length).fill(false);

    for (const ljr of left) {
      let matched = false;
      right.rows.forEach((rrow, ri) => {
        const merged: JoinedRow = new Map(ljr);
        merged.set(right.alias, rrow);
        if (join.type === "cross" || !join.on || truthy(this.evalExpr(join.on, merged, params))) {
          result.push(merged);
          matched = true;
          rightMatched[ri] = true;
        }
      });
      if (!matched && keepLeftUnmatched) {
        const merged: JoinedRow = new Map(ljr);
        merged.set(right.alias, rightNull);
        result.push(merged);
      }
    }

    if (keepRightUnmatched) {
      const leftNull = this.nullLeftTemplate(left);
      right.rows.forEach((rrow, ri) => {
        if (rightMatched[ri]) return;
        const merged: JoinedRow = new Map(leftNull);
        merged.set(right.alias, rrow);
        result.push(merged);
      });
    }
    return result;
  }

  /** A JoinedRow with every existing left alias/column set to null (for RIGHT/FULL unmatched rows). */
  private nullLeftTemplate(left: JoinedRow[]): JoinedRow {
    const tmpl: JoinedRow = new Map();
    if (left.length > 0) {
      for (const [alias, rec] of left[0]) {
        const nullRec: Record<string, unknown> = {};
        for (const c of Object.keys(rec)) nullRec[c] = null;
        tmpl.set(alias, nullRec);
      }
    }
    return tmpl;
  }

  private infoSchemaRows(): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const t of this.tables.values()) {
      t.columns.forEach((c, i) => {
        rows.push({
          table_catalog: "memory",
          table_schema: "public",
          table_name: t.name,
          column_name: c.name,
          data_type: c.type,
          ordinal_position: i + 1,
        });
      });
    }
    return rows;
  }

  // ── window functions ────────────────────────────────────────────────────────

  private collectWindowFuncs(items: SelectItem[]): Array<Extract<Expr, { k: "func" }>> {
    const found: Array<Extract<Expr, { k: "func" }>> = [];
    const seen = new Set<Expr>();
    const visit = (e: Expr) => {
      if (e.k === "func" && e.over && !seen.has(e)) {
        seen.add(e);
        found.push(e);
      }
    };
    for (const it of items) if (it.expr) walkExpr(it.expr, visit);
    return found;
  }

  /** Precompute each window function's value for every joined row. */
  private computeWindows(
    fns: Array<Extract<Expr, { k: "func" }>>,
    joined: JoinedRow[],
    params: unknown[],
  ): Map<Expr, unknown[]> {
    const result = new Map<Expr, unknown[]>();
    const n = joined.length;
    for (const fn of fns) {
      const spec = fn.over!;
      const values = new Array<unknown>(n).fill(null);
      const parts = new Map<string, number[]>();
      const order: string[] = [];
      for (let i = 0; i < n; i++) {
        const key = stableKey(spec.partitionBy.map((e) => this.evalExpr(e, joined[i], params)));
        if (!parts.has(key)) {
          parts.set(key, []);
          order.push(key);
        }
        parts.get(key)!.push(i);
      }
      for (const pk of order) {
        let idxs = parts.get(pk)!;
        if (spec.orderBy.length > 0) {
          idxs = idxs.slice().sort((a, b) => {
            for (const o of spec.orderBy) {
              const c = compareValues(
                this.evalExpr(o.expr, joined[a], params),
                this.evalExpr(o.expr, joined[b], params),
              );
              if (c !== 0) return o.dir === "desc" ? -c : c;
            }
            return a - b; // stable
          });
        }
        this.computeWindowOverPartition(fn, idxs, joined, params, values);
      }
      result.set(fn, values);
    }
    return result;
  }

  private computeWindowOverPartition(
    fn: Extract<Expr, { k: "func" }>,
    idxs: number[],
    joined: JoinedRow[],
    params: unknown[],
    values: unknown[],
  ): void {
    const name = fn.name;
    const ordered = fn.over!.orderBy.length > 0;
    const orderKey = (i: number) => fn.over!.orderBy.map((o) => this.evalExpr(o.expr, joined[i], params));
    const sameKey = (a: unknown[], b: unknown[]) => stableKey(a) === stableKey(b);

    if (name === "row_number") {
      idxs.forEach((rowIdx, p) => (values[rowIdx] = p + 1));
      return;
    }
    if (name === "rank" || name === "dense_rank") {
      let rank = 0;
      let dense = 0;
      let prev: unknown[] | null = null;
      idxs.forEach((rowIdx, p) => {
        const k = orderKey(rowIdx);
        if (prev === null || !sameKey(prev, k)) {
          dense += 1;
          rank = p + 1;
        }
        prev = k;
        values[rowIdx] = name === "rank" ? rank : dense;
      });
      return;
    }
    if (name === "lag" || name === "lead") {
      const off = fn.args[1] ? Math.trunc(num(this.evalExpr(fn.args[1], joined[idxs[0]], params))) : 1;
      idxs.forEach((rowIdx, p) => {
        const tgt = name === "lag" ? p - off : p + off;
        values[rowIdx] =
          tgt >= 0 && tgt < idxs.length
            ? this.evalExpr(fn.args[0], joined[idxs[tgt]], params)
            : fn.args[2]
              ? this.evalExpr(fn.args[2], joined[rowIdx], params)
              : null;
      });
      return;
    }
    if (name === "first_value") {
      const v = idxs.length ? this.evalExpr(fn.args[0], joined[idxs[0]], params) : null;
      idxs.forEach((rowIdx) => (values[rowIdx] = v));
      return;
    }
    if (AGG_FUNCS.has(name)) {
      if (!ordered) {
        const v = this.aggregate(name, fn, idxs.map((i) => joined[i]), params);
        idxs.forEach((rowIdx) => (values[rowIdx] = v));
      } else {
        // Running aggregate: frame = unbounded preceding … current row (peers share a value).
        for (let p = 0; p < idxs.length; ) {
          let end = p;
          const kp = orderKey(idxs[p]);
          while (end + 1 < idxs.length && sameKey(orderKey(idxs[end + 1]), kp)) end++;
          const v = this.aggregate(name, fn, idxs.slice(0, end + 1).map((i) => joined[i]), params);
          for (let q = p; q <= end; q++) values[idxs[q]] = v;
          p = end + 1;
        }
      }
      return;
    }
    throw new Error(`MemoryBackend: unsupported window function '${name}()'`);
  }

  // ── expression evaluation ───────────────────────────────────────────────────

  private evalExpr(expr: Expr, jr: JoinedRow, params: unknown[]): unknown {
    switch (expr.k) {
      case "num":
        return expr.v;
      case "str":
        return expr.v;
      case "bool":
        return expr.v;
      case "null":
        return null;
      case "star":
        return null;
      case "param": {
        if (expr.i < 1 || expr.i > params.length) {
          throw new Error(`MemoryBackend: missing bind parameter $${expr.i}`);
        }
        return params[expr.i - 1];
      }
      case "col":
        return this.resolveColumn(expr, jr);
      case "cast":
        return castValue(this.evalExpr(expr.e, jr, params), expr.type);
      case "json": {
        const base = jsonValue(this.evalExpr(expr.l, jr, params));
        const key = this.evalExpr(expr.r, jr, params);
        const v = jsonAccess(base, key);
        return expr.op === "->>" ? (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v)) : v ?? null;
      }
      case "unary": {
        const v = this.evalExpr(expr.e, jr, params);
        return v === null || v === undefined ? null : -num(v);
      }
      case "not": {
        const v = this.evalExpr(expr.e, jr, params);
        return v === null || v === undefined ? null : !truthy(v);
      }
      case "is": {
        const v = this.evalExpr(expr.e, jr, params);
        const isNull = v === null || v === undefined;
        return expr.negated ? !isNull : isNull;
      }
      case "in": {
        const v = this.evalExpr(expr.e, jr, params);
        let items: unknown[];
        if (expr.sub) {
          const rs = this.execSubquery(expr.sub, jr, params);
          const c = rs.columns[0];
          items = rs.rows.map((row) => row[c]);
        } else {
          items = (expr.list ?? []).map((el) => this.evalExpr(el, jr, params));
        }
        return evalInList(v, items, expr.negated);
      }
      case "between": {
        const v = this.evalExpr(expr.e, jr, params);
        const lo = this.evalExpr(expr.lo, jr, params);
        const hi = this.evalExpr(expr.hi, jr, params);
        if (v === null || v === undefined || lo === null || lo === undefined || hi === null || hi === undefined) return null;
        const inRange = compareValues(v, lo) >= 0 && compareValues(v, hi) <= 0;
        return expr.negated ? !inRange : inRange;
      }
      case "case":
        return this.evalCase(expr, (e) => this.evalExpr(e, jr, params));
      case "subquery": {
        const rs = this.execSubquery(expr.select, jr, params);
        if (rs.rows.length === 0) return null;
        return rs.rows[0][rs.columns[0]] ?? null;
      }
      case "exists":
        return this.execSubquery(expr.select, jr, params).rows.length > 0;
      case "func":
        // Window functions are precomputed per row; look up by AST identity.
        if (expr.over && this.currentWindow) {
          const vals = this.currentWindow.vals.get(expr);
          if (vals) return vals[this.currentWindow.index];
        }
        return this.evalScalarFunc(expr, jr, params);
      case "binary":
        return this.evalBinary(expr, jr, params);
    }
  }

  /** CASE evaluation shared by row-level and group-level evaluators. */
  private evalCase(
    expr: { operand?: Expr; whens: Array<{ when: Expr; then: Expr }>; els?: Expr },
    ev: (e: Expr) => unknown,
  ): unknown {
    if (expr.operand !== undefined) {
      const op = ev(expr.operand);
      for (const w of expr.whens) if (looseEq(op, ev(w.when))) return ev(w.then);
    } else {
      for (const w of expr.whens) if (truthy(ev(w.when))) return ev(w.then);
    }
    return expr.els !== undefined ? ev(expr.els) : null;
  }

  private resolveColumn(expr: { table?: string; name: string }, jr: JoinedRow): unknown {
    const here = this.lookupColumn(expr, jr);
    if (here !== COLUMN_ABSENT) return here;
    // Correlated subquery: walk enclosing scopes outermost-last.
    for (let i = this.subqueryOuter.length - 1; i >= 0; i--) {
      const outer = this.lookupColumn(expr, this.subqueryOuter[i]);
      if (outer !== COLUMN_ABSENT) return outer;
    }
    return null;
  }

  /** Resolve a column in one scope, returning {@link COLUMN_ABSENT} if not present. */
  private lookupColumn(expr: { table?: string; name: string }, jr: JoinedRow): unknown {
    if (expr.table) {
      const rec = jr.get(expr.table);
      if (rec && expr.name in rec) return rec[expr.name];
      for (const [alias, r] of jr) {
        if (alias.toLowerCase() === expr.table.toLowerCase() && expr.name in r) return r[expr.name];
      }
      return COLUMN_ABSENT;
    }
    for (const rec of jr.values()) {
      if (expr.name in rec) return rec[expr.name];
    }
    return COLUMN_ABSENT;
  }

  /** Run a subquery with `jr` pushed as its correlation scope. */
  private execSubquery(select: SelectStmt, jr: JoinedRow, params: unknown[]): RowSet {
    this.subqueryOuter.push(jr);
    try {
      return this.execSelect(select, params, new Map());
    } finally {
      this.subqueryOuter.pop();
    }
  }

  private evalBinary(expr: { op: string; l: Expr; r: Expr }, jr: JoinedRow, params: unknown[]): unknown {
    const op = expr.op;
    if (op === "and") {
      const l = this.evalExpr(expr.l, jr, params);
      if (l !== null && l !== undefined && !truthy(l)) return false;
      const r = this.evalExpr(expr.r, jr, params);
      if (r !== null && r !== undefined && !truthy(r)) return false;
      if (l === null || r === null || l === undefined || r === undefined) return null;
      return true;
    }
    if (op === "or") {
      const l = this.evalExpr(expr.l, jr, params);
      if (truthy(l)) return true;
      const r = this.evalExpr(expr.r, jr, params);
      if (truthy(r)) return true;
      if (l === null || r === null || l === undefined || r === undefined) return null;
      return false;
    }
    const l = this.evalExpr(expr.l, jr, params);
    const r = this.evalExpr(expr.r, jr, params);
    const nullish = l === null || l === undefined || r === null || r === undefined;
    switch (op) {
      // Comparisons with a NULL operand are UNKNOWN (NULL), not true/false.
      case "=":
        return nullish ? null : looseEq(l, r);
      case "<>":
        return nullish ? null : !looseEq(l, r);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        if (nullish) return null;
        const c = compareValues(l, r);
        return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
      }
      case "like":
      case "ilike":
        return nullish ? null : likeMatch(String(l), String(r), op === "ilike");
      // Arithmetic with a NULL operand is NULL (never NaN).
      case "+":
        return nullish ? null : num(l) + num(r);
      case "-":
        return nullish ? null : num(l) - num(r);
      case "*":
        return nullish ? null : num(l) * num(r);
      case "/": {
        if (nullish) return null;
        const d = num(r);
        if (d === 0) throw new Error("MemoryBackend: division by zero");
        return num(l) / d;
      }
      case "%": {
        if (nullish) return null;
        const d = num(r);
        if (d === 0) throw new Error("MemoryBackend: division by zero");
        return num(l) % d;
      }
      // `||` concatenation propagates NULL (unlike the concat() function).
      case "||":
        return nullish ? null : String(l) + String(r);
      default:
        throw new Error(`MemoryBackend: unsupported operator '${op}'`);
    }
  }

  private evalScalarFunc(expr: { name: string; args: Expr[]; star?: boolean }, jr: JoinedRow, params: unknown[]): unknown {
    const name = expr.name;
    if (AGG_FUNCS.has(name)) {
      // An aggregate used in a non-aggregate context → evaluate over the single row.
      return this.aggregate(name, expr, [jr], params);
    }
    const a = expr.args.map((e) => this.evalExpr(e, jr, params));
    return this.applyScalarFunc(name, a);
  }

  /** Apply a non-aggregate scalar function to its already-evaluated arguments. */
  private applyScalarFunc(name: string, a: unknown[]): unknown {
    switch (name) {
      case "now":
        return this.now();
      case "coalesce":
        return a.find((v) => v !== null && v !== undefined) ?? null;
      case "lower":
        return a[0] === null || a[0] === undefined ? null : String(a[0]).toLowerCase();
      case "upper":
        return a[0] === null || a[0] === undefined ? null : String(a[0]).toUpperCase();
      case "length":
        return a[0] === null || a[0] === undefined ? null : String(a[0]).length;
      case "abs":
        return a[0] == null ? null : Math.abs(num(a[0]));
      case "concat":
        return a.map((v) => (v === null || v === undefined ? "" : String(v))).join("");
      // ── numeric ──
      case "round": {
        if (a[0] == null) return null;
        const f = Math.pow(10, a[1] != null ? Math.trunc(num(a[1])) : 0);
        return Math.round(num(a[0]) * f) / f;
      }
      case "trunc": {
        if (a[0] == null) return null;
        const f = Math.pow(10, a[1] != null ? Math.trunc(num(a[1])) : 0);
        return Math.trunc(num(a[0]) * f) / f;
      }
      case "floor":
        return a[0] == null ? null : Math.floor(num(a[0]));
      case "ceil":
      case "ceiling":
        return a[0] == null ? null : Math.ceil(num(a[0]));
      case "sign":
        return a[0] == null ? null : Math.sign(num(a[0]));
      case "sqrt":
        return a[0] == null ? null : Math.sqrt(num(a[0]));
      case "power":
      case "pow":
        return a[0] == null || a[1] == null ? null : Math.pow(num(a[0]), num(a[1]));
      case "mod":
        return a[0] == null || a[1] == null ? null : num(a[0]) % num(a[1]);
      case "greatest": {
        const vals = a.filter((v) => v !== null && v !== undefined);
        return vals.length ? vals.reduce((m, v) => (compareValues(v, m) > 0 ? v : m)) : null;
      }
      case "least": {
        const vals = a.filter((v) => v !== null && v !== undefined);
        return vals.length ? vals.reduce((m, v) => (compareValues(v, m) < 0 ? v : m)) : null;
      }
      case "nullif":
        return looseEq(a[0], a[1]) ? null : a[0];
      // ── string ──
      case "trim":
        return a[0] == null ? null : String(a[0]).trim();
      case "ltrim":
        return a[0] == null ? null : String(a[0]).replace(/^\s+/, "");
      case "rtrim":
        return a[0] == null ? null : String(a[0]).replace(/\s+$/, "");
      case "substr":
      case "substring": {
        if (a[0] == null) return null;
        const s = String(a[0]);
        const start = Math.max(0, (a[1] != null ? Math.trunc(num(a[1])) : 1) - 1); // 1-indexed
        return a.length > 2 && a[2] != null
          ? s.slice(start, start + Math.max(0, Math.trunc(num(a[2]))))
          : s.slice(start);
      }
      case "replace": {
        if (a[0] == null) return null;
        const from = String(a[1] ?? "");
        return from === "" ? String(a[0]) : String(a[0]).split(from).join(String(a[2] ?? ""));
      }
      case "strpos":
        return a[0] == null || a[1] == null ? null : String(a[0]).indexOf(String(a[1])) + 1;
      default:
        throw new Error(`MemoryBackend: unsupported function '${name}()'`);
    }
  }

  /** Evaluate an expression that may contain aggregates, over a group of rows. */
  private evalAggExpr(expr: Expr, group: JoinedRow[], params: unknown[]): unknown {
    switch (expr.k) {
      case "func":
        if (AGG_FUNCS.has(expr.name)) return this.aggregate(expr.name, expr, group, params);
        // A non-aggregate scalar function whose ARGS may contain aggregates
        // (e.g. COALESCE(SUM(x), 0)): evaluate each arg over the group so any
        // nested aggregate collapses correctly, then apply the scalar function.
        return this.applyScalarFunc(
          expr.name,
          expr.args.map((a) => this.evalAggExpr(a, group, params)),
        );
      case "unary": {
        const v = this.evalAggExpr(expr.e, group, params);
        return v === null || v === undefined ? null : -num(v);
      }
      case "is": {
        const v = this.evalAggExpr(expr.e, group, params);
        const isNull = v === null || v === undefined;
        return expr.negated ? !isNull : isNull;
      }
      case "in": {
        // A subquery in an IN over a group isn't aggregate-correlated here —
        // evaluate against the group's representative row.
        if (expr.sub) return this.evalExpr(expr, group[0] ?? new Map(), params);
        const v = this.evalAggExpr(expr.e, group, params);
        const items = (expr.list ?? []).map((el) => this.evalAggExpr(el, group, params));
        return evalInList(v, items, expr.negated);
      }
      case "between": {
        const v = this.evalAggExpr(expr.e, group, params);
        const lo = this.evalAggExpr(expr.lo, group, params);
        const hi = this.evalAggExpr(expr.hi, group, params);
        if (v === null || v === undefined || lo === null || lo === undefined || hi === null || hi === undefined) return null;
        const inRange = compareValues(v, lo) >= 0 && compareValues(v, hi) <= 0;
        return expr.negated ? !inRange : inRange;
      }
      case "case":
        return this.evalCase(expr, (e) => this.evalAggExpr(e, group, params));
      case "cast":
        return castValue(this.evalAggExpr(expr.e, group, params), expr.type);
      case "binary": {
        if (expr.op === "and" || expr.op === "or") {
          const l = this.evalAggExpr(expr.l, group, params);
          const r = this.evalAggExpr(expr.r, group, params);
          return expr.op === "and" ? truthy(l) && truthy(r) : truthy(l) || truthy(r);
        }
        const l = this.evalAggExpr(expr.l, group, params);
        const r = this.evalAggExpr(expr.r, group, params);
        return this.combine(expr.op, l, r);
      }
      case "not":
        return !truthy(this.evalAggExpr(expr.e, group, params));
      case "json": {
        const base = jsonValue(this.evalAggExpr(expr.l, group, params));
        const key = this.evalAggExpr(expr.r, group, params);
        const v = jsonAccess(base, key);
        return expr.op === "->>" ? (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v)) : v ?? null;
      }
      default:
        // non-aggregate scalar — evaluate against the group's representative row
        return this.evalExpr(expr, group[0] ?? new Map(), params);
    }
  }

  private combine(op: string, l: unknown, r: unknown): unknown {
    const nullish = l === null || l === undefined || r === null || r === undefined;
    switch (op) {
      case "=":
        return nullish ? null : looseEq(l, r);
      case "<>":
        return nullish ? null : !looseEq(l, r);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        if (nullish) return null;
        const c = compareValues(l, r);
        return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
      }
      case "+":
        return nullish ? null : num(l) + num(r);
      case "-":
        return nullish ? null : num(l) - num(r);
      case "*":
        return nullish ? null : num(l) * num(r);
      case "/": {
        if (nullish) return null;
        const d = num(r);
        if (d === 0) throw new Error("MemoryBackend: division by zero");
        return num(l) / d;
      }
      case "%": {
        if (nullish) return null;
        const d = num(r);
        if (d === 0) throw new Error("MemoryBackend: division by zero");
        return num(l) % d;
      }
      case "||":
        return nullish ? null : String(l) + String(r);
      default:
        throw new Error(`MemoryBackend: unsupported operator '${op}' in aggregate`);
    }
  }

  private aggregate(
    name: string,
    expr: { args: Expr[]; star?: boolean; filter?: Expr; distinct?: boolean },
    group: JoinedRow[],
    params: unknown[],
  ): unknown {
    // FILTER (WHERE …) restricts which rows of the group the aggregate sees.
    const rows = expr.filter
      ? group.filter((jr) => truthy(this.evalExpr(expr.filter!, jr, params)))
      : group;
    if (name === "count" && expr.star) return rows.length;

    // Collect the (non-null) argument values, deduping when DISTINCT is given.
    let vals: unknown[] = [];
    const seen = expr.distinct ? new Set<string>() : null;
    for (const jr of rows) {
      const v = this.evalExpr(expr.args[0], jr, params);
      if (v === null || v === undefined) continue;
      if (seen) {
        const k = stableKey([v]);
        if (seen.has(k)) continue;
        seen.add(k);
      }
      vals.push(v);
    }

    if (name === "count") return vals.length;
    if (vals.length === 0) return null;
    switch (name) {
      case "sum":
        return vals.reduce((acc: number, v) => acc + num(v), 0);
      case "avg":
        return vals.reduce((acc: number, v) => acc + num(v), 0) / vals.length;
      case "min":
        return vals.reduce((m, v) => (compareValues(v, m) < 0 ? v : m));
      case "max":
        return vals.reduce((m, v) => (compareValues(v, m) > 0 ? v : m));
      default:
        throw new Error(`MemoryBackend: unsupported aggregate '${name}'`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Value helpers
// ─────────────────────────────────────────────────────────────────────────────

const INFO_COLUMNS = ["table_catalog", "table_schema", "table_name", "column_name", "data_type", "ordinal_position"];

function truthy(v: unknown): boolean {
  return v === true || v === 1;
}

function num(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return Number(v);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") {
    return num(a) === num(b);
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  // jsonb / array / object: deep value equality, not JS reference identity.
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return a === b;
    }
  }
  return a === b;
}

/**
 * Three-valued IN / NOT IN. TRUE on a match; if there's no match but the list
 * holds a NULL the result is UNKNOWN (NULL) — so `x NOT IN (.. NULL ..)` yields
 * no rows, the classic Postgres gotcha; FALSE only when there's no match and no NULL.
 */
function evalInList(v: unknown, items: unknown[], negated: boolean): unknown {
  if (v === null || v === undefined) return null;
  let sawNull = false;
  for (const item of items) {
    if (item === null || item === undefined) {
      sawNull = true;
      continue;
    }
    if (looseEq(v, item)) return !negated;
  }
  return sawNull ? null : negated;
}

function compareValues(a: unknown, b: unknown): number {
  // nulls sort last (Postgres default for ASC)
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const as = typeof a === "string" ? a : JSON.stringify(a);
  const bs = typeof b === "string" ? b : JSON.stringify(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function stableKey(values: unknown[]): string {
  return JSON.stringify(values.map((v) => (v === undefined ? null : v)));
}

function castValue(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "jsonb":
    case "json":
      return typeof v === "string" ? safeJsonParse(v) : v;
    case "int":
    case "integer":
    case "bigint":
    case "smallint":
      return Math.trunc(num(v));
    case "double precision":
    case "double":
    case "real":
    case "float":
    case "numeric":
    case "decimal":
      return num(v);
    case "boolean":
    case "bool":
      return typeof v === "string" ? v === "t" || v === "true" : truthy(v) || v === true;
    case "text":
    case "varchar":
    case "char":
      return typeof v === "string" ? v : JSON.stringify(v);
    default:
      return v;
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Normalise a value into navigable JSON (parse strings that hold JSON). */
function jsonValue(v: unknown): unknown {
  if (typeof v === "string") {
    const t = v.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      return safeJsonParse(v);
    }
  }
  return v;
}

function jsonAccess(base: unknown, key: unknown): unknown {
  if (base === null || base === undefined) return null;
  if (Array.isArray(base)) {
    const idx = typeof key === "number" ? key : Number(key);
    if (!Number.isInteger(idx)) return null;
    return base[idx < 0 ? base.length + idx : idx] ?? null;
  }
  if (isPlainObject(base)) {
    return base[String(key)] ?? null;
  }
  return null;
}

function likeMatch(value: string, pattern: string, ci: boolean): boolean {
  let re = "^";
  for (const ch of pattern) {
    if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";
  return new RegExp(re, ci ? "is" : "s").test(value);
}

function containsAggregate(expr: Expr): boolean {
  switch (expr.k) {
    case "func":
      // A windowed func (`… OVER (…)`) is NOT a grouping aggregate.
      if (AGG_FUNCS.has(expr.name) && !expr.over) return true;
      return expr.args.some(containsAggregate);
    case "cast":
    case "not":
    case "unary":
      return containsAggregate(expr.e);
    case "binary":
    case "json":
      return containsAggregate(expr.l) || containsAggregate(expr.r);
    case "is":
      return containsAggregate(expr.e);
    case "in":
      return containsAggregate(expr.e) || (expr.list ?? []).some(containsAggregate);
    case "between":
      return containsAggregate(expr.e) || containsAggregate(expr.lo) || containsAggregate(expr.hi);
    case "case":
      return (
        (expr.operand ? containsAggregate(expr.operand) : false) ||
        expr.whens.some((w) => containsAggregate(w.when) || containsAggregate(w.then)) ||
        (expr.els ? containsAggregate(expr.els) : false)
      );
    default:
      return false;
  }
}

/** Visit every sub-expression (used to collect window functions). Subqueries are a separate scope. */
function walkExpr(expr: Expr, visit: (e: Expr) => void): void {
  visit(expr);
  switch (expr.k) {
    case "func":
      expr.args.forEach((a) => walkExpr(a, visit));
      if (expr.filter) walkExpr(expr.filter, visit);
      if (expr.over) {
        expr.over.partitionBy.forEach((e) => walkExpr(e, visit));
        expr.over.orderBy.forEach((o) => walkExpr(o.expr, visit));
      }
      break;
    case "unary":
    case "not":
    case "cast":
    case "is":
      walkExpr(expr.e, visit);
      break;
    case "binary":
    case "json":
      walkExpr(expr.l, visit);
      walkExpr(expr.r, visit);
      break;
    case "in":
      walkExpr(expr.e, visit);
      (expr.list ?? []).forEach((e) => walkExpr(e, visit));
      break;
    case "between":
      walkExpr(expr.e, visit);
      walkExpr(expr.lo, visit);
      walkExpr(expr.hi, visit);
      break;
    case "case":
      if (expr.operand) walkExpr(expr.operand, visit);
      expr.whens.forEach((w) => {
        walkExpr(w.when, visit);
        walkExpr(w.then, visit);
      });
      if (expr.els) walkExpr(expr.els, visit);
      break;
    // subquery / exists: separate scope — not descended for window collection
  }
}

function inferColName(expr: Expr): string {
  switch (expr.k) {
    case "col":
      return expr.name;
    case "cast":
      return inferColName(expr.e);
    case "func":
      return expr.name;
    case "json":
      return "?column?";
    default:
      return "?column?";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public aliases
// ─────────────────────────────────────────────────────────────────────────────

/** Clearer name for the embedded engine in a glove-sql context. */
export { MemoryBackend as MemorySqlDatabase };
export type { MemoryBackendOptions as MemorySqlOptions };
