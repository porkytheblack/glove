/**
 * Authoring resource tables.
 *
 *   - {@link defineResource} — the primary, explicit contract. Wire each CRUD
 *     verb to a resolver (often a different underlying Glove tool per verb).
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

/** Build a {@link ResourceTable} from an explicit spec, validating its shape. */
export function defineResource(spec: DefineResourceSpec): ResourceTable {
  if (!spec.name || !spec.name.trim()) throw new Error("defineResource: name is required");
  if (!spec.columns || spec.columns.length === 0) {
    throw new Error(`defineResource("${spec.name}"): at least one column is required`);
  }
  if (!spec.select && !spec.insert && !spec.update && !spec.delete) {
    throw new Error(`defineResource("${spec.name}"): at least one of select/insert/update/delete is required`);
  }
  return {
    name: spec.name,
    description: spec.description ?? spec.name,
    columns: spec.columns,
    volatility: spec.volatility,
    select: spec.select,
    insert: spec.insert,
    update: spec.update,
    delete: spec.delete,
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
  if (op === "select" && spec.volatility === "volatile" && !spec.columns) {
    throw new Error(
      `resourceFromTool("${spec.name}"): a volatile SELECT resource must declare columns (the schema can't be inferred from data)`,
    );
  }
  const keys = inputColumns(tool as GloveFoldArgs<unknown>, spec);

  // Columns = declared output columns ∪ key columns (deduped by name), with
  // requiredKey set from the input schema.
  const byName = new Map<string, ResourceColumn>();
  for (const c of spec.columns ?? []) byName.set(c.name, { ...c });
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
