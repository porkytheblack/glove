import { z } from "zod";
import { MemorySchemaError } from "./errors";

/**
 * Definition of a node class — a vertex type in the entity graph.
 *
 * Identity keys are *multi-set*: `[["email"], ["name", "organizationId"]]`
 * means either matching set folds the write into the same node. Single-key
 * identity is a toy; real entity mapping needs alternatives.
 */
export interface NodeClassDef<P = unknown> {
  name: string;
  schema: z.ZodType<P>;
  /** Alternative identity key sets — any matching set folds the write into an existing node. */
  identityKeys?: Array<Array<keyof P & string>>;
  /** Properties indexed for fuzzy / contains search. */
  searchableProperties?: Array<keyof P & string>;
}

/**
 * Definition of a relationship — an edge type between two node classes.
 *
 * Edge identity is `(fromId, toId, type)` by default. Re-`connect` updates
 * the edge's properties rather than creating a duplicate. `multi: true` is
 * the escape hatch for relationships that legitimately repeat (rare).
 */
export interface RelationshipDef<P = unknown> {
  type: string;
  /** Source node class name. */
  from: string;
  /** Target node class name. */
  to: string;
  /** Optional schema for edge properties. */
  propertiesSchema?: z.ZodType<P>;
  /** When true, multiple edges of this type can exist between the same node pair. Default false. */
  multi?: boolean;
}

/**
 * Definition of an episode kind — the registered vocabulary for `Episode.kind`.
 *
 * Episode kinds live on the same schema as node classes and relationships
 * because the curator's reasoning crosses both adapters. Defined here so
 * future episodic-memory work picks it up without a schema rewrite.
 */
export interface EpisodeKindDef<P = unknown> {
  name: string;
  description?: string;
  /** Optional schema for episode-specific structured data when this kind is used. */
  propertiesSchema?: z.ZodType<P>;
}

/**
 * Descriptive registration of a top-level resource directory. Used as
 * guidance surfaced to the model in tool descriptions. The curator can
 * still write outside registered roots — this is governance through
 * description, not enforcement.
 */
export interface ResourceRootDef {
  /** Absolute POSIX path. */
  path: string;
  description?: string;
  /** When false, files under this root skip the embedding lifecycle and are excluded from semantic search. Default true. */
  semanticSearch?: boolean;
}

/**
 * Shared ontology object used by every memory subsystem. The schema lives in
 * code only — the package does not persist it, validate it across deployments,
 * or expose migration primitives. Consumers manage schema consistency
 * themselves.
 *
 * What's safe at runtime:
 * - Adding a new node class, relationship, or episode kind is always safe.
 * - Adding an optional property is always safe.
 * - Adding a *required* property won't break existing reads, but writes that
 *   don't supply it will fail validation.
 * - Removing or renaming properties requires a consumer-managed rewrite —
 *   the adapter won't notice.
 * - Changing identity keys may silently collapse or split nodes on
 *   subsequent writes. Avoid in production unless you've planned the
 *   migration.
 */
export class MemorySchema {
  private readonly nodeClasses = new Map<string, NodeClassDef<any>>();
  private readonly relationships = new Map<string, RelationshipDef<any>>();
  private readonly episodeKinds = new Map<string, EpisodeKindDef<any>>();
  private readonly resourceRoots = new Map<string, ResourceRootDef>();

  defineNodeClass<P>(def: NodeClassDef<P>): this {
    if (this.nodeClasses.has(def.name)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Node class "${def.name}" is already defined.`,
      );
    }
    this.nodeClasses.set(def.name, def as NodeClassDef<any>);
    return this;
  }

  defineRelationship<P>(def: RelationshipDef<P>): this {
    if (this.relationships.has(def.type)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Relationship "${def.type}" is already defined.`,
      );
    }
    if (!this.nodeClasses.has(def.from)) {
      throw new MemorySchemaError(
        "unknown_class",
        `Relationship "${def.type}" references unknown source class "${def.from}".`,
      );
    }
    if (!this.nodeClasses.has(def.to)) {
      throw new MemorySchemaError(
        "unknown_class",
        `Relationship "${def.type}" references unknown target class "${def.to}".`,
      );
    }
    this.relationships.set(def.type, def as RelationshipDef<any>);
    return this;
  }

  defineEpisodeKind<P>(def: EpisodeKindDef<P>): this {
    if (this.episodeKinds.has(def.name)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Episode kind "${def.name}" is already defined.`,
      );
    }
    this.episodeKinds.set(def.name, def as EpisodeKindDef<any>);
    return this;
  }

  defineResourceRoot(def: ResourceRootDef): this {
    if (this.resourceRoots.has(def.path)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Resource root "${def.path}" is already defined.`,
      );
    }
    this.resourceRoots.set(def.path, def);
    return this;
  }

  // ─── Lookups ────────────────────────────────────────────────────────────

  getNodeClass(name: string): NodeClassDef<any> | undefined {
    return this.nodeClasses.get(name);
  }

  requireNodeClass(name: string): NodeClassDef<any> {
    const def = this.nodeClasses.get(name);
    if (!def) {
      throw new MemorySchemaError("unknown_class", `Unknown node class: "${name}".`);
    }
    return def;
  }

  getRelationship(type: string): RelationshipDef<any> | undefined {
    return this.relationships.get(type);
  }

  requireRelationship(type: string): RelationshipDef<any> {
    const def = this.relationships.get(type);
    if (!def) {
      throw new MemorySchemaError(
        "unknown_relationship",
        `Unknown relationship: "${type}".`,
      );
    }
    return def;
  }

  getEpisodeKind(name: string): EpisodeKindDef<any> | undefined {
    return this.episodeKinds.get(name);
  }

  getResourceRoot(path: string): ResourceRootDef | undefined {
    return this.resourceRoots.get(path);
  }

  // ─── Listings (for tool descriptions and introspection) ─────────────────

  listNodeClasses(): NodeClassDef<any>[] {
    return [...this.nodeClasses.values()];
  }

  listRelationships(): RelationshipDef<any>[] {
    return [...this.relationships.values()];
  }

  listEpisodeKinds(): EpisodeKindDef<any>[] {
    return [...this.episodeKinds.values()];
  }

  listResourceRoots(): ResourceRootDef[] {
    return [...this.resourceRoots.values()];
  }
}
