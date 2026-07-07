/**
 * Authoring resource tables.
 *
 *   - {@link defineResource} — the primary, explicit contract. Wire each CRUD
 *     verb to a resolver (often a different underlying Glove tool per verb).
 *     Pass a Zod `schema` and ONE object is your columns AND your end-to-end row
 *     type: it flows into every resolver (`select` returns rows of it, `insert`
 *     takes them, `update`'s `set` is a partial) and into `bindings.one("col")`,
 *     which now autocompletes the schema's column names.
 *   - {@link resourceFromTool} — convenience for the trivial single-verb case:
 *     turn ONE Glove tool into a one-verb resource (`get_time` → `time`,
 *     a search tool → rows, `send_email` → an INSERT-only `emails`).
 *
 * Required-key columns (WHERE-pushdown arguments) are derived from the tool's
 * input schema: a required `inputSchema` field (Zod) or a `jsonSchema.required`
 * entry (bridged MCP/OpenAPI tools) becomes a `requiredKey` column.
 */
import { z } from "zod";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type {
  Bindings,
  ResourceColumn,
  ResourceContext,
  ResourceTable,
  TypedBindings,
  Volatility,
} from "./provider";

// The display argument of a tool's `do` — derived from the type so we don't have
// to import DisplayManagerAdapter directly.
type DisplayArg = Parameters<GloveFoldArgs<unknown>["do"]>[1];

/** A resolver invoking a tool's `do` must supply a display + glove. SQL resolvers
 *  run headless, so these are inert stand-ins; tools that try to use an
 *  interactive display surface a clear error rather than hanging. */
const NOOP_DISPLAY = new Proxy(
  {},
  { get: () => async () => undefined },
) as unknown as DisplayArg;
const NOOP_GLOVE = new Proxy(
  {},
  { get: () => async () => undefined },
) as unknown as IGloveRunnable;

export interface DefineResourceSpec {
  name: string;
  description?: string;
  columns: ResourceColumn[];
  volatility: Volatility;
  select?: (bindings: Bindings, ctx: ResourceContext) => Promise<unknown>;
  insert?: (rows: Record<string, unknown>[], ctx: ResourceContext) => Promise<unknown>;
  update?: (set: Record<string, unknown>, bindings: Bindings, ctx: ResourceContext) => Promise<unknown>;
  delete?: (bindings: Bindings, ctx: ResourceContext) => Promise<unknown>;
}

// ── Zod → columns ─────────────────────────────────────────────────────────────

/** A Zod object schema — the source of a resource's columns AND its row type. */
type AnyZodObject = z.ZodObject<any, any>;

/** Read the unwrapped (optional/nullable/default/… stripped) Zod `def.type` per
 *  field. Two column types — `bigint` and `date` — are unrepresentable in JSON
 *  Schema, so we read them straight from the runtime shape rather than the
 *  round-tripped output. */
function baseDefTypes(schema: AnyZodObject): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const shape = (schema as { shape?: Record<string, unknown> }).shape ?? {};
  const wrappers = new Set(["optional", "nullable", "default", "catch", "readonly", "nonoptional"]);
  for (const [key, field] of Object.entries(shape)) {
    let inner = field as { def?: { type?: string; innerType?: unknown } } | undefined;
    while (inner?.def && wrappers.has(inner.def.type ?? "")) {
      inner = inner.def.innerType as typeof inner;
    }
    out[key] = inner?.def?.type;
  }
  return out;
}

/** Map one JSON-Schema property (+ its base Zod `def.type`) to a Postgres-dialect
 *  type string. An explicit `.meta({ pgType })` override always wins. */
function propToPg(prop: Record<string, any> | undefined, baseType: string | undefined): string {
  if (prop && typeof prop.pgType === "string") return prop.pgType; // z.string().meta({ pgType: "timestamptz" })
  if (baseType === "bigint") return "bigint";
  if (baseType === "date") return "timestamptz";
  const t = Array.isArray(prop?.type) ? prop!.type.find((x: string) => x !== "null") : prop?.type;
  switch (t) {
    case "integer":
      return "bigint";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "string":
      return prop?.format === "date-time" || prop?.format === "date" ? "timestamptz" : "text";
    default:
      return "jsonb"; // object / array / unrepresentable → reachable via -> / ->>
  }
}

/**
 * Derive {@link ResourceColumn}s from a Zod object schema — one declaration is
 * both the table's columns (name, Postgres type, description) and the row type
 * the resolvers speak. Field types map to Postgres types (`z.number().int()` →
 * `bigint`, `z.number()` → `double precision`, `z.boolean()` → `boolean`,
 * `z.date()` / `z.iso.datetime()` → `timestamptz`, nested objects/arrays →
 * `jsonb`); `.describe(...)` becomes the column description (where authors put
 * enum/allowed-value hints); `.meta({ pgType })` forces an exact type. Names in
 * `keys` are marked as required-key (WHERE-pushdown argument) columns.
 */
export function columnsFromZod(schema: AnyZodObject, keys: readonly string[] = []): ResourceColumn[] {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" }) as { properties?: Record<string, any> };
  const props = json.properties ?? {};
  for (const k of keys) {
    if (!(k in props)) {
      throw new Error(`columnsFromZod: key "${k}" is not a property of the schema.`);
    }
  }
  const bases = baseDefTypes(schema);
  const keySet = new Set(keys);
  return Object.entries(props).map(([name, prop]) => {
    const col: ResourceColumn = { name, type: propToPg(prop, bases[name]) };
    if (prop && typeof prop.description === "string") col.description = prop.description;
    if (keySet.has(name)) col.requiredKey = true;
    return col;
  });
}

/** The row type of a resource's Zod schema. */
type Row<S extends AnyZodObject> = z.infer<S>;

/** Rows a `select` returns or an `insert` accepts: required-key columns are
 *  auto-stamped from the pushed-down WHERE, so a resolver MAY omit them. */
type WriteRow<S extends AnyZodObject, K extends keyof Row<S>> = Omit<Row<S>, K> &
  Partial<Pick<Row<S>, K>>;

type MaybeArray<T> = T | readonly T[];

/**
 * A Zod-first resource spec. `schema` is the single source of truth: it becomes
 * the columns (via {@link columnsFromZod}) AND the row type that flows through
 * every resolver, so the whole definition is type-checked end to end.
 */
export interface DefineZodResourceSpec<
  S extends AnyZodObject,
  K extends keyof Row<S> & string = never,
> {
  name: string;
  description?: string;
  volatility: Volatility;
  /** Columns AND end-to-end row type in one object. */
  schema: S;
  /** Columns that MUST be equated in WHERE (pushdown arguments). Typed to `schema`'s keys. */
  keys?: readonly K[];
  /** Read rows. Returns rows of the schema (key columns optional — they're stamped). */
  select?: (bindings: TypedBindings<Row<S>>, ctx: ResourceContext) => Promise<MaybeArray<WriteRow<S, K>>>;
  /** Create rows of the schema. */
  insert?: (rows: WriteRow<S, K>[], ctx: ResourceContext) => Promise<unknown>;
  /** Update columns (`set`, a partial row) for the WHERE-matched keys. */
  update?: (set: Partial<Row<S>>, bindings: TypedBindings<Row<S>>, ctx: ResourceContext) => Promise<unknown>;
  /** Delete the WHERE-matched keys. */
  delete?: (bindings: TypedBindings<Row<S>>, ctx: ResourceContext) => Promise<unknown>;
}

/** Build a {@link ResourceTable} from an explicit column list. */
export function defineResource(spec: DefineResourceSpec): ResourceTable;
/**
 * Build a {@link ResourceTable} from a Zod schema — end-to-end typed. The schema
 * is your columns and your row type at once; resolvers, `set` payloads, and
 * `bindings.one(col)` are all inferred from it.
 *
 * ```ts
 * defineResource({
 *   name: "github_pr",
 *   volatility: "stable",
 *   schema: z.object({
 *     number: z.number().int().describe("PR number"),
 *     title: z.string(),
 *     merged: z.boolean(),
 *   }),
 *   keys: ["number"],                                  // required WHERE-pushdown key
 *   select: (b) => listPrs({ number: b.one("number") }),  // b.one autocompletes columns
 *   insert: (rows) => createPr(rows[0]),                  // rows: { number?, title, merged }[]
 *   update: (set, b) => updatePr(b.one("number"), set),   // set: Partial<{ number; title; merged }>
 *   delete: (b) => closePr(b.one("number")),
 * });
 * ```
 */
export function defineResource<S extends AnyZodObject, const K extends keyof Row<S> & string = never>(
  spec: DefineZodResourceSpec<S, K>,
): ResourceTable;
export function defineResource(
  spec: DefineResourceSpec | DefineZodResourceSpec<AnyZodObject, string>,
): ResourceTable {
  if (!spec.name || !spec.name.trim()) throw new Error("defineResource: name is required");
  const columns =
    "schema" in spec ? columnsFromZod(spec.schema, spec.keys ?? []) : spec.columns;
  if (!columns || columns.length === 0) {
    throw new Error(
      `defineResource("${spec.name}"): at least one column is required (declare "columns" or a "schema").`,
    );
  }
  const { select, insert, update, delete: del } = spec as DefineResourceSpec;
  if (!select && !insert && !update && !del) {
    throw new Error(`defineResource("${spec.name}"): at least one of select/insert/update/delete is required`);
  }
  return {
    name: spec.name,
    description: spec.description ?? spec.name,
    columns,
    volatility: spec.volatility,
    select,
    insert,
    update,
    delete: del,
  };
}

export interface ResourceFromToolSpec {
  /** Resource (table) name. */
  name: string;
  description?: string;
  /** Effect classification — REQUIRED (no safe default for an effectful tool). */
  volatility: Volatility;
  /** Which verb this tool backs. Default `"select"`. */
  op?: "select" | "insert" | "update" | "delete";
  /**
   * Declared output (+ key) columns. STRONGLY recommended, and REQUIRED for a
   * volatile read (a stable schema can't be inferred from a zero-row first call).
   */
  columns?: ResourceColumn[];
  /**
   * Declare the output columns with a Zod object instead of {@link columns} —
   * the field types map to Postgres types (see {@link columnsFromZod}). The
   * tool's own input schema still supplies the required-key columns.
   */
  schema?: z.ZodObject<any, any>;
  /**
   * Override / augment the input-schema-derived key columns. Map a tool input
   * field to a column name and mark it required (a WHERE-pushdown argument).
   */
  inputs?: Record<string, { column?: string; required?: boolean; description?: string }>;
  /** Extract the row array from the tool result (e.g. `(d) => d.items`). Default: identity. */
  rows?: (data: unknown) => unknown;
  /** Build the tool input from the SQL operation. Defaults derive from `inputs`. */
  buildInput?: (args: {
    bindings?: Bindings;
    row?: Record<string, unknown>;
    set?: Record<string, unknown>;
  }) => unknown;
}

interface InputColumn {
  field: string;
  column: string;
  required: boolean;
  type: string;
}

/** Read `{ properties, required }` from a tool's Zod or JSON schema, uniformly. */
function toolSchema(tool: GloveFoldArgs<unknown>): { properties: Record<string, any>; required: string[] } {
  const js = (tool as { jsonSchema?: Record<string, unknown> }).jsonSchema;
  if (js && typeof js === "object") {
    return {
      properties: (js.properties as Record<string, any>) ?? {},
      required: (js.required as string[]) ?? [],
    };
  }
  const zs = (tool as { inputSchema?: z.ZodType }).inputSchema;
  if (zs) {
    try {
      const j = z.toJSONSchema(zs) as { properties?: Record<string, any>; required?: string[] };
      return { properties: j.properties ?? {}, required: j.required ?? [] };
    } catch {
      /* fall through */
    }
  }
  return { properties: {}, required: [] };
}

function jsonTypeToPg(t: unknown): string {
  const s = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  switch (s) {
    case "integer":
      return "bigint";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "string":
      return "text";
    default:
      return "jsonb";
  }
}

function inputColumns(tool: GloveFoldArgs<unknown>, spec: ResourceFromToolSpec): InputColumn[] {
  const { properties, required } = toolSchema(tool);
  const out: InputColumn[] = [];
  const overrides = spec.inputs ?? {};
  const fields = new Set<string>([...Object.keys(properties), ...Object.keys(overrides)]);
  for (const field of fields) {
    const ov = overrides[field];
    out.push({
      field,
      column: ov?.column ?? field,
      required: ov?.required ?? required.includes(field),
      type: jsonTypeToPg(properties[field]?.type),
    });
  }
  return out;
}

/** Turn one Glove tool into a single-verb resource. */
export function resourceFromTool<I>(tool: GloveFoldArgs<I>, spec: ResourceFromToolSpec): ResourceTable {
  const op = spec.op ?? "select";
  // Output columns come from either the explicit list or a Zod schema.
  const declaredColumns = spec.columns ?? (spec.schema ? columnsFromZod(spec.schema) : undefined);
  if (op === "select" && spec.volatility === "volatile" && !declaredColumns) {
    throw new Error(
      `resourceFromTool("${spec.name}"): a volatile SELECT resource must declare columns (via "columns" or "schema" — the schema can't be inferred from data)`,
    );
  }
  const keys = inputColumns(tool as GloveFoldArgs<unknown>, spec);

  // Columns = declared output columns ∪ key columns (deduped by name), with
  // requiredKey set from the input schema.
  const byName = new Map<string, ResourceColumn>();
  for (const c of declaredColumns ?? []) byName.set(c.name, { ...c });
  for (const k of keys) {
    const existing = byName.get(k.column);
    if (existing) {
      if (k.required) existing.requiredKey = true;
    } else {
      byName.set(k.column, { name: k.column, type: k.type, requiredKey: k.required || undefined });
    }
  }
  const columns = [...byName.values()];

  const fromBindings = (bindings?: Bindings): Record<string, unknown> => {
    const input: Record<string, unknown> = {};
    if (!bindings) return input;
    for (const k of keys) if (bindings.has(k.column)) input[k.field] = bindings.one(k.column);
    return input;
  };
  const fromRow = (row?: Record<string, unknown>): Record<string, unknown> => {
    const input: Record<string, unknown> = {};
    if (!row) return input;
    // Map columns back onto tool input fields (key columns by their field name,
    // everything else by its own name).
    const fieldByColumn = new Map(keys.map((k) => [k.column, k.field] as const));
    for (const [col, val] of Object.entries(row)) input[fieldByColumn.get(col) ?? col] = val;
    return input;
  };

  const call = async (input: unknown, ctx: ResourceContext): Promise<unknown> => {
    const res = await tool.do(input as I, NOOP_DISPLAY, NOOP_GLOVE, ctx.signal);
    if (res.status !== "success") {
      throw new Error(res.message ?? `tool "${tool.name}" failed`);
    }
    return spec.rows ? spec.rows(res.data) : res.data;
  };

  const base: DefineResourceSpec = {
    name: spec.name,
    description: spec.description ?? tool.description,
    columns,
    volatility: spec.volatility,
  };

  if (op === "select") {
    base.select = (bindings, ctx) =>
      call(spec.buildInput ? spec.buildInput({ bindings }) : fromBindings(bindings), ctx);
  } else if (op === "insert") {
    base.insert = async (rows, ctx) => {
      const out: unknown[] = [];
      for (const row of rows) {
        out.push(await call(spec.buildInput ? spec.buildInput({ row }) : fromRow(row), ctx));
      }
      return out;
    };
  } else if (op === "update") {
    base.update = (set, bindings, ctx) =>
      call(spec.buildInput ? spec.buildInput({ set, bindings }) : { ...fromBindings(bindings), ...set }, ctx);
  } else {
    base.delete = (bindings, ctx) =>
      call(spec.buildInput ? spec.buildInput({ bindings }) : fromBindings(bindings), ctx);
  }

  return defineResource(base);
}
