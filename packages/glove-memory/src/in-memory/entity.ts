import type { Provenance } from "../core/provenance";
import { MemorySchema } from "../core/schema";
import {
  MemoryNotFoundError,
  MemoryQueryError,
  MemorySchemaError,
  MemoryWriteError,
} from "../core/errors";
import type {
  EntityMemoryAdapter,
  FindNodesOptions,
} from "../entity/adapter";
import type {
  EdgeWriteResult,
  MemoryEdge,
  MemoryNode,
  NodeWriteResult,
} from "../entity/types";
import {
  type ExpandSpec,
  type FilterOp,
  filterOpName,
  type NodeFilter,
  type QueryResult,
  type QueryResultRow,
  type QuerySpec,
} from "../entity/query";

export interface InMemoryEntityAdapterOptions {
  identifier?: string;
  schema: MemorySchema;
}

/**
 * In-process reference implementation of `EntityMemoryAdapter`. Intended
 * for development and tests — production deployments should use
 * `glove-memory-sqlite` or `glove-memory-postgres`.
 */
export class InMemoryEntityMemoryAdapter implements EntityMemoryAdapter {
  identifier: string;
  schema: MemorySchema;

  private nodes = new Map<string, MemoryNode>();
  private edges = new Map<string, MemoryEdge>();
  /** className → identityKeySetSig → nodeId. */
  private identityIndex = new Map<string, Map<string, string>>();
  private nodeCounter = 0;
  private edgeCounter = 0;

  constructor(opts: InMemoryEntityAdapterOptions) {
    this.identifier = opts.identifier ?? `in-memory-entity_${Date.now()}`;
    this.schema = opts.schema;
  }

  // ─── Node operations ─────────────────────────────────────────────────────

  async addNode(
    className: string,
    props: unknown,
    provenance: Provenance,
  ): Promise<NodeWriteResult> {
    requireProvenance(provenance);
    const def = this.schema.requireNodeClass(className);
    let validated: Record<string, unknown>;
    try {
      validated = this.schema.validateNodeProps(className, props) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof MemorySchemaError) {
        throw new MemoryWriteError("validation_failed", e.message, e.details);
      }
      throw e;
    }

    // Identity-key match. First successful key set wins; if two key sets
    // resolve to *different* existing nodes, that's identity-ambiguous.
    const matched = this.findByIdentityKeys(className, validated);
    if (matched.length > 1) {
      throw new MemoryWriteError(
        "identity_ambiguous",
        `Write to "${className}" matched multiple existing nodes via different identity key sets`,
        { matchedIds: matched },
      );
    }

    const now = new Date().toISOString();

    if (matched.length === 1) {
      const existing = this.nodes.get(matched[0]!)!;
      const merged = mergePropsOnIdentityHit(existing.props, validated);
      // Always append provenance, even if no props changed. The merge
      // operation itself is meaningful audit information.
      const updatedProvenance = [
        ...existing.provenance,
        annotateProvenance(provenance, merged.conflicts),
      ];
      const updated: MemoryNode = {
        ...existing,
        props: merged.props,
        updatedAt: now,
        provenance: updatedProvenance,
      };
      this.nodes.set(existing.id, updated);
      this.refreshIdentityIndex(def.name, existing.id, updated.props);

      return { id: existing.id, created: false, mergedInto: existing.id };
    }

    const id = this.nextNodeId();
    const node: MemoryNode = {
      id,
      className,
      props: { ...validated },
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    };
    this.nodes.set(id, node);
    this.refreshIdentityIndex(def.name, id, node.props);

    return { id, created: true };
  }

  async getNode(id: string): Promise<MemoryNode | null> {
    return this.nodes.get(id) ?? null;
  }

  async updateNode(
    id: string,
    props: Record<string, unknown>,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const node = this.nodes.get(id);
    if (!node) throw new MemoryNotFoundError(`Node ${id} not found`);
    const newProps = { ...node.props, ...props };
    try {
      this.schema.validateNodeProps(node.className, newProps);
    } catch (e) {
      if (e instanceof MemorySchemaError) {
        throw new MemoryWriteError("validation_failed", e.message, e.details);
      }
      throw e;
    }
    node.props = newProps;
    node.updatedAt = new Date().toISOString();
    node.provenance = [...node.provenance, provenance];
    this.refreshIdentityIndex(node.className, id, newProps);
  }

  async mergeNodes(
    keepId: string,
    mergeId: string,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    if (keepId === mergeId) return;
    const keep = this.nodes.get(keepId);
    const merge = this.nodes.get(mergeId);
    if (!keep) throw new MemoryNotFoundError(`Node ${keepId} not found`);
    if (!merge) throw new MemoryNotFoundError(`Node ${mergeId} not found`);
    if (keep.className !== merge.className) {
      throw new MemoryWriteError(
        "validation_failed",
        `Cannot merge nodes of different classes: ${keep.className} vs ${merge.className}`,
      );
    }

    const merged = mergePropsOnIdentityHit(keep.props, merge.props);
    keep.props = merged.props;
    keep.updatedAt = new Date().toISOString();
    keep.provenance = [
      ...keep.provenance,
      ...merge.provenance,
      annotateProvenance(provenance, merged.conflicts, `merged ${mergeId} into ${keepId}`),
    ];

    // Rewrite edges that referenced the merged node.
    for (const edge of this.edges.values()) {
      let touched = false;
      if (edge.fromId === mergeId) {
        edge.fromId = keepId;
        touched = true;
      }
      if (edge.toId === mergeId) {
        edge.toId = keepId;
        touched = true;
      }
      if (touched) {
        edge.updatedAt = keep.updatedAt;
        edge.provenance = [
          ...edge.provenance,
          { ...provenance, note: `${provenance.note ?? ""}${provenance.note ? "; " : ""}rewritten by merge ${mergeId}->${keepId}` },
        ];
      }
    }

    // Drop the merged node from the index and the store.
    this.removeFromIdentityIndex(merge.className, mergeId);
    this.nodes.delete(mergeId);
    this.refreshIdentityIndex(keep.className, keepId, keep.props);

    // After rewriting both sides we may have collapsed two distinct edges
    // into the same (from, to, type). Dedup non-multi edges.
    this.deduplicateEdges();
  }

  // ─── Edge operations ─────────────────────────────────────────────────────

  async connect(
    fromId: string,
    toId: string,
    relType: string,
    props: unknown | undefined,
    provenance: Provenance,
  ): Promise<EdgeWriteResult> {
    requireProvenance(provenance);
    const def = this.schema.requireRelationship(relType);
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from) throw new MemoryNotFoundError(`Node ${fromId} not found`);
    if (!to) throw new MemoryNotFoundError(`Node ${toId} not found`);
    if (from.className !== def.from) {
      throw new MemoryWriteError(
        "validation_failed",
        `Relationship "${relType}" expects from-class "${def.from}", got "${from.className}"`,
      );
    }
    if (to.className !== def.to) {
      throw new MemoryWriteError(
        "validation_failed",
        `Relationship "${relType}" expects to-class "${def.to}", got "${to.className}"`,
      );
    }

    let validatedProps: Record<string, unknown> | undefined;
    try {
      const v = this.schema.validateRelationshipProps(relType, props);
      validatedProps = v as Record<string, unknown> | undefined;
    } catch (e) {
      if (e instanceof MemorySchemaError) {
        throw new MemoryWriteError("validation_failed", e.message, e.details);
      }
      throw e;
    }

    const now = new Date().toISOString();

    if (!def.multi) {
      const existing = [...this.edges.values()].find(
        (e) => e.fromId === fromId && e.toId === toId && e.type === relType,
      );
      if (existing) {
        existing.props = validatedProps ?? existing.props;
        existing.updatedAt = now;
        existing.provenance = [...existing.provenance, provenance];
        return { id: existing.id, created: false };
      }
    }

    const id = this.nextEdgeId();
    const edge: MemoryEdge = {
      id,
      fromId,
      toId,
      type: relType,
      props: validatedProps,
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    };
    this.edges.set(id, edge);
    return { id, created: true };
  }

  async disconnect(edgeId: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    if (!this.edges.has(edgeId)) {
      throw new MemoryNotFoundError(`Edge ${edgeId} not found`);
    }
    this.edges.delete(edgeId);
  }

  // ─── Query operations ────────────────────────────────────────────────────

  async findNodes(
    className: string,
    where: NodeFilter,
    opts: FindNodesOptions = {},
  ): Promise<MemoryNode[]> {
    const def = this.schema.requireNodeClass(className);
    const allowFuzzy = opts.fuzzy === true;
    const candidates: MemoryNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.className !== className) continue;
      if (!matchesNodeFilter(node, where, { allowFuzzy, searchableProperties: def.searchableProperties })) continue;
      candidates.push(node);
    }
    return paginate(candidates, opts.limit, opts.offset);
  }

  async edgesForNode(
    nodeId: string,
    opts: { limit?: number; types?: string[] } = {},
  ): Promise<MemoryEdge[]> {
    const types = opts.types ? new Set(opts.types) : null;
    const out: MemoryEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.fromId !== nodeId && edge.toId !== nodeId) continue;
      if (types && !types.has(edge.type)) continue;
      out.push(edge);
    }
    return paginate(out, opts.limit);
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    this.schema.requireNodeClass(spec.from);
    let candidates: MemoryNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.className !== spec.from) continue;
      if (spec.where && !matchesNodeFilter(node, spec.where, { allowFuzzy: true })) continue;
      candidates.push(node);
    }

    if (spec.orderBy) {
      sortByOrderBy(candidates, spec.orderBy);
    }

    const total = candidates.length;
    candidates = paginate(candidates, spec.limit, spec.offset);

    const rows = candidates.map((n) => this.buildRow(n, spec.select, spec.expand));
    return { rows, total };
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private buildRow(
    node: MemoryNode,
    select: string[] | undefined,
    expand: ExpandSpec | undefined,
  ): QueryResultRow {
    const row: QueryResultRow = {
      id: node.id,
      className: node.className,
      props: pickProps(node.props, select),
    };
    if (!expand) return row;

    const related: Record<string, QueryResultRow[]> = {};
    for (const [relType, relSpec] of Object.entries(expand)) {
      const relDef = this.schema.requireRelationship(relType);
      let neighbours: MemoryNode[] = [];
      for (const edge of this.edges.values()) {
        if (edge.type !== relType) continue;
        let neighbourId: string | null = null;
        if (relDef.from === node.className && edge.fromId === node.id) neighbourId = edge.toId;
        else if (relDef.to === node.className && edge.toId === node.id) neighbourId = edge.fromId;
        if (!neighbourId) continue;
        const n = this.nodes.get(neighbourId);
        if (!n) continue;
        if (relSpec.where && !matchesNodeFilter(n, relSpec.where, { allowFuzzy: true })) continue;
        neighbours.push(n);
      }
      if (relSpec.orderBy) sortByOrderBy(neighbours, relSpec.orderBy);
      neighbours = paginate(neighbours, relSpec.limit);
      related[relType] = neighbours.map((n) => this.buildRow(n, relSpec.select, relSpec.expand));
    }

    row.related = related;
    return row;
  }

  private nextNodeId(): string {
    this.nodeCounter += 1;
    return `node_${Date.now().toString(36)}_${this.nodeCounter}`;
  }

  private nextEdgeId(): string {
    this.edgeCounter += 1;
    return `edge_${Date.now().toString(36)}_${this.edgeCounter}`;
  }

  /** Look up existing nodes by every identity key set declared on the class. */
  private findByIdentityKeys(
    className: string,
    props: Record<string, unknown>,
  ): string[] {
    const def = this.schema.requireNodeClass(className);
    if (!def.identityKeys || def.identityKeys.length === 0) return [];
    const idx = this.identityIndex.get(className);
    if (!idx) return [];
    const matches = new Set<string>();
    for (const keySet of def.identityKeys) {
      const sig = identitySignature(keySet, props);
      if (sig === null) continue;
      const existingId = idx.get(sig);
      if (existingId) matches.add(existingId);
    }
    return [...matches];
  }

  private refreshIdentityIndex(
    className: string,
    nodeId: string,
    props: Record<string, unknown>,
  ): void {
    const def = this.schema.requireNodeClass(className);
    if (!def.identityKeys || def.identityKeys.length === 0) return;
    let idx = this.identityIndex.get(className);
    if (!idx) {
      idx = new Map();
      this.identityIndex.set(className, idx);
    }
    // Clear any stale signatures for this node — we don't track them
    // separately, so walk and rebuild.
    for (const [sig, id] of [...idx.entries()]) {
      if (id === nodeId) idx.delete(sig);
    }
    for (const keySet of def.identityKeys) {
      const sig = identitySignature(keySet, props);
      if (sig !== null) idx.set(sig, nodeId);
    }
  }

  private removeFromIdentityIndex(className: string, nodeId: string): void {
    const idx = this.identityIndex.get(className);
    if (!idx) return;
    for (const [sig, id] of [...idx.entries()]) {
      if (id === nodeId) idx.delete(sig);
    }
  }

  private deduplicateEdges(): void {
    const seen = new Map<string, string>();
    for (const edge of [...this.edges.values()]) {
      const def = this.schema.getRelationship(edge.type);
      if (def?.multi) continue;
      const sig = `${edge.fromId}|${edge.toId}|${edge.type}`;
      const existingId = seen.get(sig);
      if (!existingId) {
        seen.set(sig, edge.id);
        continue;
      }
      // Keep the older edge, fold provenance from the duplicate.
      const keep = this.edges.get(existingId)!;
      keep.provenance = [...keep.provenance, ...edge.provenance];
      keep.props = { ...(keep.props ?? {}), ...(edge.props ?? {}) };
      keep.updatedAt = new Date().toISOString();
      this.edges.delete(edge.id);
    }
  }
}

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p) {
    throw new MemoryWriteError(
      "provenance_required",
      "Provenance is required on every memory write",
    );
  }
  if (!p.source || !p.actor || !p.timestamp) {
    throw new MemoryWriteError(
      "provenance_required",
      "Provenance must include `source`, `actor`, and `timestamp`",
    );
  }
}

function annotateProvenance(
  base: Provenance,
  conflicts: string[],
  extraNote?: string,
): Provenance {
  const conflictsNote = conflicts.length > 0 ? `conflicts: ${conflicts.join(", ")}` : "";
  const parts = [base.note, extraNote, conflictsNote].filter(Boolean) as string[];
  return parts.length > 0 ? { ...base, note: parts.join("; ") } : base;
}

/** Return null when the key set has any property missing (can't form a signature). */
function identitySignature(
  keySet: string[],
  props: Record<string, unknown>,
): string | null {
  const parts: string[] = [];
  for (const key of keySet) {
    const v = props[key];
    if (v === undefined || v === null) return null;
    parts.push(`${key}=${normaliseScalar(v)}`);
  }
  return parts.join("|");
}

function normaliseScalar(v: unknown): string {
  if (typeof v === "string") return v.toLowerCase();
  return JSON.stringify(v);
}

interface PropMergeResult {
  props: Record<string, unknown>;
  conflicts: string[];
}

/**
 * Identity-hit merge: missing properties on the existing node are filled
 * from the new write; conflicting properties are LEFT UNTOUCHED on the
 * existing node and recorded as conflicts in provenance.
 */
function mergePropsOnIdentityHit(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): PropMergeResult {
  const out: Record<string, unknown> = { ...existing };
  const conflicts: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    const existingVal = existing[k];
    if (existingVal === undefined || existingVal === null) {
      out[k] = v;
      continue;
    }
    if (!deepEqual(existingVal, v)) {
      conflicts.push(k);
    }
  }
  return { props: out, conflicts };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

interface FilterContext {
  allowFuzzy: boolean;
  searchableProperties?: string[];
}

function matchesNodeFilter(
  node: MemoryNode,
  filter: NodeFilter,
  ctx: FilterContext,
): boolean {
  for (const [propName, ops] of Object.entries(filter)) {
    const opList = Array.isArray(ops) ? ops : [ops];
    for (const op of opList) {
      if (!matchesFilterOp(node.props[propName], op, ctx, propName)) return false;
    }
  }
  return true;
}

function matchesFilterOp(
  value: unknown,
  op: FilterOp,
  ctx: FilterContext,
  propName: string,
): boolean {
  const name = filterOpName(op);
  switch (name) {
    case "eq":
      return deepEqual(value, (op as { eq: unknown }).eq);
    case "neq":
      return !deepEqual(value, (op as { neq: unknown }).neq);
    case "in":
      return (op as { in: unknown[] }).in.some((v) => deepEqual(value, v));
    case "not_in":
      return !(op as { not_in: unknown[] }).not_in.some((v) => deepEqual(value, v));
    case "exists":
      return ((op as { exists: boolean }).exists) === (value !== undefined && value !== null);
    case "fuzzy": {
      if (!ctx.allowFuzzy) {
        throw new MemoryQueryError(
          "operator_not_supported",
          `Operator "fuzzy" requires fuzzy matching to be enabled (set { fuzzy: true } on findNodes)`,
        );
      }
      if (typeof value !== "string") return false;
      if (ctx.searchableProperties && !ctx.searchableProperties.includes(propName)) return false;
      const needle = (op as { fuzzy: string }).fuzzy.toLowerCase();
      return value.toLowerCase().includes(needle);
    }
    case "contains":
      return typeof value === "string" && value.includes((op as { contains: string }).contains);
    case "starts_with":
      return (
        typeof value === "string" &&
        value.startsWith((op as { starts_with: string }).starts_with)
      );
    case "ends_with":
      return (
        typeof value === "string" &&
        value.endsWith((op as { ends_with: string }).ends_with)
      );
    case "gt":
      return compare(value, (op as { gt: number | string }).gt) > 0;
    case "gte":
      return compare(value, (op as { gte: number | string }).gte) >= 0;
    case "lt":
      return compare(value, (op as { lt: number | string }).lt) < 0;
    case "lte":
      return compare(value, (op as { lte: number | string }).lte) <= 0;
    case "between": {
      const [lo, hi] = (op as { between: [unknown, unknown] }).between;
      return compare(value, lo) >= 0 && compare(value, hi) <= 0;
    }
    default:
      throw new MemoryQueryError(
        "operator_not_supported",
        `Unknown filter operator: ${String(name)}`,
      );
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // Fallback string compare
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function pickProps(
  props: Record<string, unknown>,
  select: string[] | undefined,
): Record<string, unknown> {
  if (!select) return { ...props };
  const out: Record<string, unknown> = {};
  for (const k of select) {
    if (k in props) out[k] = props[k];
  }
  return out;
}

function sortByOrderBy(nodes: MemoryNode[], orderBy: string): void {
  const [field, dir = "asc"] = orderBy.split(":");
  if (!field) return;
  const sign = dir === "desc" ? -1 : 1;
  nodes.sort((a, b) => sign * compare(a.props[field], b.props[field]));
}

function paginate<T>(arr: T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0;
  const end = limit !== undefined ? start + limit : undefined;
  return arr.slice(start, end);
}
