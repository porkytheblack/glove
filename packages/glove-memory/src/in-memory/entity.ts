import { z } from "zod";
import {
  MemoryNotFoundError,
  MemorySchemaError,
  MemoryWriteError,
} from "../core/errors";
import type { Provenance } from "../core/provenance";
import type { MemorySchema, NodeClassDef, RelationshipDef } from "../core/schema";
import type {
  EntityMemoryAdapter,
  FindNodesOpts,
} from "../entity/adapter";
import type {
  EdgeWriteResult,
  MemoryEdge,
  MemoryNode,
  NodeNeighbour,
  NodeWithNeighbours,
  NodeWriteResult,
} from "../entity/types";
import {
  FILTER_OP_KEYS,
  getFilterOpKey,
  parseOrderBy,
  type ExpandSpec,
  type FilterOp,
  type NodeFilter,
  type QueryResult,
  type QueryRow,
  type QuerySpec,
} from "../entity/query";

/**
 * Reference in-process adapter. Holds nodes and edges in JS Maps; supports
 * the full query DSL using simple linear scans. Intended for development,
 * tests, and short-lived sessions — production deployments should use the
 * SQLite or Postgres companion packages.
 *
 * Single-writer-many-reader by virtue of JavaScript's single-threaded event
 * loop. Writes are not transactional: a multi-step operation that throws
 * partway through (e.g. `mergeNodes`) leaves intermediate state on disk.
 * Acceptable for a reference impl; companion adapters running on real
 * databases handle this with their own transaction primitives.
 */
export class InMemoryEntityAdapter implements EntityMemoryAdapter {
  identifier: string;
  schema: MemorySchema;

  private readonly nodes = new Map<string, MemoryNode>();
  private readonly edges = new Map<string, MemoryEdge>();
  /** Class name → set of node IDs of that class. Used by `findNodes` to scope linear scans. */
  private readonly nodesByClass = new Map<string, Set<string>>();
  private nextId = 1;

  constructor(opts: { schema: MemorySchema; identifier?: string }) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `in-memory-entity-${Date.now()}`;
  }

  // ─── ID generation ──────────────────────────────────────────────────────

  private genId(prefix: string): string {
    const id = `${prefix}_${this.nextId.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.nextId++;
    return id;
  }

  // ─── Node operations ────────────────────────────────────────────────────

  async addNode(
    className: string,
    props: unknown,
    provenance: Provenance,
  ): Promise<NodeWriteResult> {
    requireProvenance(provenance);
    const def = this.schema.requireNodeClass(className);
    const validated = validateAgainst(def.schema, props);

    // Deterministic identity-key match. If two distinct nodes match
    // different sets, that's `identity_ambiguous` — orchestrator merges
    // first.
    const matches = this.findIdentityMatches(def, validated);
    if (matches.size > 1) {
      throw new MemoryWriteError(
        "identity_ambiguous",
        `Write to "${className}" matched ${matches.size} existing nodes via different identity-key sets.`,
        [...matches],
      );
    }

    const now = new Date().toISOString();

    if (matches.size === 1) {
      const existingId = [...matches][0]!;
      const existing = this.nodes.get(existingId)!;
      const { mergedProps, conflicts } = mergeProps(existing.props, validated as Record<string, unknown>);
      existing.props = mergedProps;
      existing.updatedAt = now;
      existing.provenance.push(
        appendNote(provenance, conflicts.length ? `dedup-merge; conflicts: ${conflicts.join(", ")}` : "dedup-merge"),
      );
      // `mergedInto` mirrors `id` on a dedup hit so callers branching on the
      // field (rather than `created`) see which existing node absorbed the
      // write. Same value as `id`; surface convention for readability.
      return { id: existingId, created: false, mergedInto: existingId };
    }

    const id = this.genId(`node_${className.toLowerCase()}`);
    const node: MemoryNode = {
      id,
      className,
      props: validated as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    };
    this.nodes.set(id, node);
    let bucket = this.nodesByClass.get(className);
    if (!bucket) {
      bucket = new Set();
      this.nodesByClass.set(className, bucket);
    }
    bucket.add(id);
    return { id, created: true };
  }

  async getNode(id: string): Promise<MemoryNode | null> {
    const node = this.nodes.get(id);
    if (!node) return null;
    return cloneNode(node);
  }

  async updateNode(
    id: string,
    props: Record<string, unknown>,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const node = this.nodes.get(id);
    if (!node) {
      throw new MemoryNotFoundError(`No node with id "${id}".`);
    }
    const def = this.schema.requireNodeClass(node.className);
    const merged = { ...node.props, ...props };
    const validated = validateAgainst(def.schema, merged);
    node.props = validated as Record<string, unknown>;
    node.updatedAt = new Date().toISOString();
    node.provenance.push(provenance);
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
    if (!keep) throw new MemoryNotFoundError(`No node with id "${keepId}".`);
    if (!merge) throw new MemoryNotFoundError(`No node with id "${mergeId}".`);
    if (keep.className !== merge.className) {
      throw new MemoryWriteError(
        "validation_failed",
        `Cannot merge nodes of different classes ("${keep.className}" vs "${merge.className}").`,
      );
    }

    // 1. Property merge — fill missing on keep from merge; conflicts go in provenance.
    const { mergedProps, conflicts } = mergeProps(keep.props, merge.props);
    keep.props = mergedProps;

    // 2. Edge rewrite — every edge incident to mergeId now points at keepId.
    //    If the rewrite collides with an existing edge, fold properties into
    //    the existing edge and drop the duplicate.
    for (const edge of [...this.edges.values()]) {
      if (edge.fromId !== mergeId && edge.toId !== mergeId) continue;
      const newFromId = edge.fromId === mergeId ? keepId : edge.fromId;
      const newToId = edge.toId === mergeId ? keepId : edge.toId;
      // Self-loops result when both ends pointed at mergeId.
      const relDef = this.schema.getRelationship(edge.type);
      const allowMulti = relDef?.multi ?? false;

      if (!allowMulti) {
        const collision = this.findEdge(newFromId, newToId, edge.type);
        if (collision && collision.id !== edge.id) {
          // Fold the merged edge's properties into the surviving edge.
          collision.props = { ...(collision.props ?? {}), ...(edge.props ?? {}) };
          collision.updatedAt = new Date().toISOString();
          collision.provenance.push(appendNote(provenance, `merged-from-edge ${edge.id}`));
          this.edges.delete(edge.id);
          continue;
        }
      }
      edge.fromId = newFromId;
      edge.toId = newToId;
      edge.updatedAt = new Date().toISOString();
      edge.provenance.push(appendNote(provenance, `rewritten by mergeNodes ${mergeId} -> ${keepId}`));
    }

    // 3. Drop the merged-away node.
    this.nodes.delete(mergeId);
    this.nodesByClass.get(merge.className)?.delete(mergeId);

    keep.updatedAt = new Date().toISOString();
    keep.provenance.push(
      appendNote(
        provenance,
        conflicts.length
          ? `merge ${mergeId} -> ${keepId}; conflicts: ${conflicts.join(", ")}`
          : `merge ${mergeId} -> ${keepId}`,
      ),
    );
  }

  // ─── Edge operations ────────────────────────────────────────────────────

  async connect(
    fromId: string,
    toId: string,
    relType: string,
    props: unknown | undefined,
    provenance: Provenance,
  ): Promise<EdgeWriteResult> {
    requireProvenance(provenance);
    const relDef = this.schema.requireRelationship(relType);
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (!fromNode) throw new MemoryNotFoundError(`No source node with id "${fromId}".`);
    if (!toNode) throw new MemoryNotFoundError(`No target node with id "${toId}".`);
    if (fromNode.className !== relDef.from) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Relationship "${relType}" expects source class "${relDef.from}" but got "${fromNode.className}".`,
      );
    }
    if (toNode.className !== relDef.to) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Relationship "${relType}" expects target class "${relDef.to}" but got "${toNode.className}".`,
      );
    }

    let validatedProps: Record<string, unknown> | undefined;
    if (relDef.propertiesSchema) {
      validatedProps = validateAgainst(relDef.propertiesSchema, props ?? {}) as Record<string, unknown>;
    } else if (props !== undefined && props !== null) {
      validatedProps = props as Record<string, unknown>;
    }

    const now = new Date().toISOString();

    if (!relDef.multi) {
      const existing = this.findEdge(fromId, toId, relType);
      if (existing) {
        existing.props = validatedProps !== undefined ? { ...(existing.props ?? {}), ...validatedProps } : existing.props;
        existing.updatedAt = now;
        existing.provenance.push(provenance);
        return { id: existing.id, created: false };
      }
    }

    const id = this.genId(`edge_${relType.toLowerCase()}`);
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
    const edge = this.edges.get(edgeId);
    if (!edge) {
      throw new MemoryNotFoundError(`No edge with id "${edgeId}".`);
    }
    this.edges.delete(edgeId);
  }

  // ─── Query operations ───────────────────────────────────────────────────

  async findNodes(
    className: string,
    where: NodeFilter,
    opts: FindNodesOpts = {},
  ): Promise<MemoryNode[]> {
    const def = this.schema.requireNodeClass(className);
    const ids = this.nodesByClass.get(className);
    if (!ids || ids.size === 0) return [];

    const matches: MemoryNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node) continue;
      if (matchesFilter(node.props, where, def, opts.fuzzy ?? false)) {
        matches.push(cloneNode(node));
      }
    }

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? matches.length;
    return matches.slice(offset, offset + limit);
  }

  async getNodeWithNeighbours(id: string): Promise<NodeWithNeighbours | null> {
    const node = this.nodes.get(id);
    if (!node) return null;
    const neighbours: NodeNeighbour[] = [];
    for (const edge of this.edges.values()) {
      if (edge.fromId === id) {
        const other = this.nodes.get(edge.toId);
        if (!other) continue;
        neighbours.push({
          edgeId: edge.id,
          edgeType: edge.type,
          direction: "out",
          nodeId: other.id,
          className: other.className,
          edgeProps: edge.props ? { ...edge.props } : undefined,
        });
      } else if (edge.toId === id) {
        const other = this.nodes.get(edge.fromId);
        if (!other) continue;
        neighbours.push({
          edgeId: edge.id,
          edgeType: edge.type,
          direction: "in",
          nodeId: other.id,
          className: other.className,
          edgeProps: edge.props ? { ...edge.props } : undefined,
        });
      }
    }
    return { node: cloneNode(node), neighbours };
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    const def = this.schema.requireNodeClass(spec.from);
    const ids = this.nodesByClass.get(spec.from);
    if (!ids || ids.size === 0) return { rows: [] };

    let candidates: MemoryNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node) continue;
      if (!spec.where || matchesFilter(node.props, spec.where, def, false)) {
        candidates.push(node);
      }
    }

    candidates = sortNodes(candidates, spec.orderBy);
    const offset = spec.offset ?? 0;
    const limit = spec.limit ?? candidates.length;
    candidates = candidates.slice(offset, offset + limit);

    const rows = candidates.map((n) => this.buildRow(n, spec.select, spec.expand));
    return { rows };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  private buildRow(
    node: MemoryNode,
    select: string[] | undefined,
    expand: ExpandSpec | undefined,
  ): QueryRow {
    const row: QueryRow = {
      id: node.id,
      className: node.className,
      props: pickProps(node.props, select),
    };
    if (expand) {
      row.expanded = {};
      for (const [relType, sub] of Object.entries(expand)) {
        const relDef = this.schema.getRelationship(relType);
        if (!relDef) continue;
        const linked = this.expandFromNode(node.id, relType, relDef);
        const filtered: MemoryNode[] = [];
        for (const target of linked) {
          const targetClassDef = this.schema.getNodeClass(target.className);
          if (!targetClassDef) continue;
          if (sub.where && !matchesFilter(target.props, sub.where, targetClassDef, false)) {
            continue;
          }
          filtered.push(target);
        }
        const ordered = sortNodes(filtered, sub.orderBy);
        const limited = sub.limit ? ordered.slice(0, sub.limit) : ordered;
        row.expanded[relType] = limited.map((t) => this.buildRow(t, sub.select, sub.expand));
      }
    }
    return row;
  }

  private expandFromNode(
    nodeId: string,
    relType: string,
    relDef: RelationshipDef<any>,
  ): MemoryNode[] {
    const out: MemoryNode[] = [];
    for (const edge of this.edges.values()) {
      if (edge.type !== relType) continue;
      // Default direction: source -> target. Allow inbound traversal too —
      // a node on either side of the relationship may want to walk the edge.
      if (edge.fromId === nodeId) {
        const other = this.nodes.get(edge.toId);
        if (other && other.className === relDef.to) out.push(other);
      } else if (edge.toId === nodeId) {
        const other = this.nodes.get(edge.fromId);
        if (other && other.className === relDef.from) out.push(other);
      }
    }
    return out;
  }

  private findIdentityMatches(
    def: NodeClassDef<any>,
    props: unknown,
  ): Set<string> {
    const matches = new Set<string>();
    if (!def.identityKeys || def.identityKeys.length === 0) return matches;
    const propsRecord = props as Record<string, unknown>;
    const ids = this.nodesByClass.get(def.name);
    if (!ids) return matches;
    for (const keySet of def.identityKeys) {
      // Skip key sets where any required key is missing on the new write —
      // identity is "all keys in the set match", so an undefined key disqualifies.
      const incomplete = keySet.some((k) => propsRecord[k] === undefined || propsRecord[k] === null);
      if (incomplete) continue;
      for (const id of ids) {
        const candidate = this.nodes.get(id);
        if (!candidate) continue;
        const allMatch = keySet.every((k) => deepEqual(candidate.props[k], propsRecord[k]));
        if (allMatch) matches.add(id);
      }
    }
    return matches;
  }

  private findEdge(fromId: string, toId: string, type: string): MemoryEdge | undefined {
    for (const edge of this.edges.values()) {
      if (edge.fromId === fromId && edge.toId === toId && edge.type === type) {
        return edge;
      }
    }
    return undefined;
  }
}

// ─── Validation / merge helpers ───────────────────────────────────────────

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p || typeof p !== "object") {
    throw new MemoryWriteError("provenance_required", "A provenance record is required on every write.");
  }
  if (typeof p.source !== "string" || typeof p.actor !== "string" || typeof p.timestamp !== "string") {
    throw new MemoryWriteError(
      "provenance_required",
      "Provenance must include `source`, `actor`, and `timestamp` strings.",
    );
  }
}

function validateAgainst<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MemoryWriteError(
      "validation_failed",
      `Property validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
    );
  }
  return parsed.data;
}

/**
 * Fill missing keys on the existing object from `incoming`. Conflicting
 * values stay on `existing`; conflict keys are returned for the caller to
 * record in provenance.
 */
function mergeProps(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): { mergedProps: Record<string, unknown>; conflicts: string[] } {
  const mergedProps = { ...existing };
  const conflicts: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined || v === null) continue;
    if (mergedProps[k] === undefined || mergedProps[k] === null) {
      mergedProps[k] = v;
    } else if (!deepEqual(mergedProps[k], v)) {
      conflicts.push(k);
    }
  }
  return { mergedProps, conflicts };
}

function appendNote(p: Provenance, note: string): Provenance {
  return p.note ? { ...p, note: `${p.note}; ${note}` } : { ...p, note };
}

function cloneNode(n: MemoryNode): MemoryNode {
  return {
    ...n,
    props: { ...n.props },
    provenance: [...n.provenance],
  };
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

function sortNodes(nodes: MemoryNode[], orderBy: string | undefined): MemoryNode[] {
  const parsed = parseOrderBy(orderBy);
  if (!parsed) return nodes;
  const { property, direction } = parsed;
  const sorted = [...nodes].sort((a, b) => compareValues(a.props[property], b.props[property]));
  return direction === "desc" ? sorted.reverse() : sorted;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// ─── Filter evaluation ────────────────────────────────────────────────────

function matchesFilter(
  props: Record<string, unknown>,
  filter: NodeFilter,
  classDef: NodeClassDef<any>,
  fuzzyDefault: boolean,
): boolean {
  for (const [propName, opOrOps] of Object.entries(filter)) {
    const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
    for (const op of ops) {
      if (!evalOp(props, propName, op, classDef, fuzzyDefault)) return false;
    }
  }
  return true;
}

function evalOp(
  props: Record<string, unknown>,
  propName: string,
  op: FilterOp,
  classDef: NodeClassDef<any>,
  fuzzyDefault: boolean,
): boolean {
  const value = props[propName];
  const key = getFilterOpKey(op);
  switch (key) {
    case "eq": {
      const expected = (op as { eq: unknown }).eq;
      // Opportunistic fuzzy when caller asked for it and the property is searchable.
      if (
        fuzzyDefault &&
        typeof expected === "string" &&
        typeof value === "string" &&
        classDef.searchableProperties?.includes(propName)
      ) {
        return fuzzyMatch(value, expected);
      }
      return deepEqual(value, expected);
    }
    case "neq":
      return !deepEqual(value, (op as { neq: unknown }).neq);
    case "in":
      return (op as { in: unknown[] }).in.some((v) => deepEqual(value, v));
    case "not_in":
      return !(op as { not_in: unknown[] }).not_in.some((v) => deepEqual(value, v));
    case "exists": {
      const want = (op as { exists: boolean }).exists;
      const has = value !== undefined && value !== null;
      return want === has;
    }
    case "fuzzy": {
      const needle = (op as { fuzzy: string }).fuzzy;
      if (typeof value !== "string") return false;
      return fuzzyMatch(value, needle);
    }
    case "contains": {
      const needle = (op as { contains: string }).contains;
      if (typeof value !== "string") return false;
      return value.toLowerCase().includes(needle.toLowerCase());
    }
    case "starts_with": {
      const needle = (op as { starts_with: string }).starts_with;
      if (typeof value !== "string") return false;
      return value.toLowerCase().startsWith(needle.toLowerCase());
    }
    case "ends_with": {
      const needle = (op as { ends_with: string }).ends_with;
      if (typeof value !== "string") return false;
      return value.toLowerCase().endsWith(needle.toLowerCase());
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const target = (op as Record<string, number | string>)[key];
      return numericOrLexCompare(value, target, key);
    }
    case "between": {
      const [lo, hi] = (op as { between: [unknown, unknown] }).between;
      return numericOrLexCompare(value, lo, "gte") && numericOrLexCompare(value, hi, "lte");
    }
  }
  // Schema-validated FilterOp guarantees coverage; this guards future additions.
  const exhaustive: never = key as never;
  void exhaustive;
  return false;
}

function numericOrLexCompare(value: unknown, target: unknown, op: "gt" | "gte" | "lt" | "lte"): boolean {
  if (value === undefined || value === null) return false;
  let cmp = 0;
  if (typeof value === "number" && typeof target === "number") {
    cmp = value - target;
  } else {
    cmp = String(value).localeCompare(String(target));
  }
  switch (op) {
    case "gt": return cmp > 0;
    case "gte": return cmp >= 0;
    case "lt": return cmp < 0;
    case "lte": return cmp <= 0;
  }
}

/**
 * Naive case-insensitive substring match. The in-memory adapter doesn't
 * carry trigram or Levenshtein machinery — that's the SQLite/Postgres
 * companion adapters' job. This is "good enough for tests".
 */
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

// FILTER_OP_KEYS is exported so callers can introspect; reference it here so
// adapters can rely on it without a transitive import surprise.
void FILTER_OP_KEYS;
