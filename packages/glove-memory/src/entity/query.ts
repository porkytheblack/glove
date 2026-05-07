import { z } from "zod";

/**
 * Closed set of filter operators. Adapters that can't implement an operator
 * (e.g. the in-memory adapter has no trigram support) MUST throw
 * `MemoryQueryError("operator_not_supported", op)` rather than silently
 * degrading.
 */
export const FilterOpSchema = z.union([
  z.object({ eq: z.unknown() }),
  z.object({ neq: z.unknown() }),
  z.object({ in: z.array(z.unknown()) }),
  z.object({ not_in: z.array(z.unknown()) }),
  z.object({ exists: z.boolean() }),
  z.object({ fuzzy: z.string() }),
  z.object({ contains: z.string() }),
  z.object({ starts_with: z.string() }),
  z.object({ ends_with: z.string() }),
  z.object({ gt: z.union([z.number(), z.string()]) }),
  z.object({ gte: z.union([z.number(), z.string()]) }),
  z.object({ lt: z.union([z.number(), z.string()]) }),
  z.object({ lte: z.union([z.number(), z.string()]) }),
  z.object({ between: z.tuple([z.unknown(), z.unknown()]) }),
]);

export type FilterOp = z.infer<typeof FilterOpSchema>;

export const NodeFilterSchema: z.ZodType<NodeFilter> = z.record(
  z.string(),
  z.union([FilterOpSchema, z.array(FilterOpSchema)]),
);

export type NodeFilter = {
  [propertyName: string]: FilterOp | FilterOp[];
};

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

export interface QuerySpec {
  /** Root node class. */
  from: string;
  where?: NodeFilter;
  /** Relationship traversal. */
  expand?: ExpandSpec;
  /** Property allowlist on the root nodes. */
  select?: string[];
  /** "propertyName:asc" | "propertyName:desc". */
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export const QuerySpecSchema: z.ZodType<QuerySpec> = z.object({
  from: z.string().min(1),
  where: NodeFilterSchema.optional(),
  expand: ExpandSpecSchema.optional(),
  select: z.array(z.string()).optional(),
  orderBy: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

/** Result row from `query`. Matches the spec's open shape — adapter-specific. */
export interface QueryResultRow {
  id: string;
  className: string;
  props: Record<string, unknown>;
  /** Expanded relationships keyed by type name. */
  related?: Record<string, QueryResultRow[]>;
}

export interface QueryResult {
  rows: QueryResultRow[];
  /** Total matches before limit/offset, when the adapter can compute it. */
  total?: number;
}

/** Names of all currently-defined operators. Useful for adapter validation. */
export const FILTER_OPERATORS = [
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

export type FilterOperatorName = (typeof FILTER_OPERATORS)[number];

/** Inspect a filter op object and return the single operator key it carries. */
export function filterOpName(op: FilterOp): FilterOperatorName {
  const keys = Object.keys(op) as FilterOperatorName[];
  return keys[0]!;
}
