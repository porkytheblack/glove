import { z } from "zod";

/**
 * Closed operator set for property filters. Adding operators is a versioned
 * change to the DSL, not an ad-hoc extension. Adapters that can't implement
 * an operator should throw `MemoryQueryError("operator_not_supported", op)`
 * rather than silently degrading.
 */
export const FilterOpSchema = z.union([
  z.object({ eq: z.unknown() }).strict(),
  z.object({ neq: z.unknown() }).strict(),
  z.object({ in: z.array(z.unknown()) }).strict(),
  z.object({ not_in: z.array(z.unknown()) }).strict(),
  z.object({ exists: z.boolean() }).strict(),
  z.object({ fuzzy: z.string() }).strict(),
  z.object({ contains: z.string() }).strict(),
  z.object({ starts_with: z.string() }).strict(),
  z.object({ ends_with: z.string() }).strict(),
  z.object({ gt: z.union([z.number(), z.string()]) }).strict(),
  z.object({ gte: z.union([z.number(), z.string()]) }).strict(),
  z.object({ lt: z.union([z.number(), z.string()]) }).strict(),
  z.object({ lte: z.union([z.number(), z.string()]) }).strict(),
  z.object({
    between: z
      .tuple([z.unknown(), z.unknown()])
      .refine((v): v is [unknown, unknown] => Array.isArray(v) && v.length === 2),
  }).strict(),
]);

export type FilterOp = z.infer<typeof FilterOpSchema>;

/** All known operator keys, exported for adapters to introspect. */
export const FILTER_OP_KEYS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "exists",
  "fuzzy",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
] as const;

export type FilterOpKey = typeof FILTER_OP_KEYS[number];

/** Pull the active operator key out of a `FilterOp`. */
export function getFilterOpKey(op: FilterOp): FilterOpKey {
  for (const k of FILTER_OP_KEYS) {
    if (k in op) return k;
  }
  // Schema validation guarantees one key is present.
  throw new Error("FilterOp has no recognised operator key");
}

/**
 * A node filter is a map from property name to either a single operator or
 * an array of operators (interpreted as conjunction).
 */
export const NodeFilterSchema: z.ZodType<NodeFilter> = z.record(
  z.string(),
  z.union([FilterOpSchema, z.array(FilterOpSchema)]),
);

export type NodeFilter = {
  [propertyName: string]: FilterOp | FilterOp[];
};

/**
 * Recursive expansion spec for traversing relationships.
 */
export interface ExpandSpec {
  [relationshipType: string]: {
    select?: string[];
    where?: NodeFilter;
    expand?: ExpandSpec;
    limit?: number;
    orderBy?: string;
  };
}

export const ExpandSpecSchema: z.ZodType<ExpandSpec> = z.lazy(() =>
  z.record(
    z.string(),
    z.object({
      select: z.array(z.string()).optional(),
      where: NodeFilterSchema.optional(),
      expand: ExpandSpecSchema.optional(),
      limit: z.number().int().positive().optional(),
      orderBy: z.string().optional(),
    }),
  ),
);

export const QuerySpecSchema = z.object({
  /** Root node class. */
  from: z.string().min(1),
  where: NodeFilterSchema.optional(),
  expand: ExpandSpecSchema.optional(),
  /** Property allowlist on the root nodes. Default: all. */
  select: z.array(z.string()).optional(),
  /** `propertyName:asc` | `propertyName:desc`. */
  orderBy: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type QuerySpec = z.infer<typeof QuerySpecSchema>;

/**
 * Result of a structured query. Each row is a root node (with selected
 * properties) and a tree of expanded neighbours keyed by relationship type.
 */
export interface QueryResult {
  rows: QueryRow[];
}

export interface QueryRow {
  id: string;
  className: string;
  props: Record<string, unknown>;
  expanded?: Record<string, QueryRow[]>;
}

/** Parse `"prop:asc"` / `"prop:desc"`, defaulting to ascending. */
export function parseOrderBy(orderBy: string | undefined): { property: string; direction: "asc" | "desc" } | undefined {
  if (!orderBy) return undefined;
  const [property, direction] = orderBy.split(":");
  if (!property) return undefined;
  return {
    property,
    direction: direction === "desc" ? "desc" : "asc",
  };
}
