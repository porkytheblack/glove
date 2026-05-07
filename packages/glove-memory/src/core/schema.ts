import { z } from "zod";
import { MemorySchemaError } from "./errors";

/**
 * One node class in the entity graph. Identity keys are multi-set:
 * `[["email"], ["name", "organizationId"]]` means either matching set
 * folds the write into an existing node. Single-key identity is a toy;
 * real entity mapping needs alternatives.
 */
export interface NodeClassDef<P> {
  name: string;
  schema: z.ZodType<P>;
  /** Alternative identity key sets — any matching set folds the write into an existing node. */
  identityKeys?: Array<Array<keyof P & string>>;
  /** Properties indexed for fuzzy search. */
  searchableProperties?: Array<keyof P & string>;
  /** Free-form description shown to the model in tool descriptions. */
  description?: string;
}

/**
 * One edge type in the entity graph. Edge identity is `(fromId, toId, type)`
 * by default; `multi: true` is an escape hatch for relationships that
 * legitimately repeat (rare).
 */
export interface RelationshipDef<P> {
  type: string;
  /** Source node class name. */
  from: string;
  /** Target node class name. */
  to: string;
  /** Optional schema for edge properties. */
  propertiesSchema?: z.ZodType<P>;
  /** When true, multiple edges of this type can exist between the same node pair. Default false. */
  multi?: boolean;
  description?: string;
}

/**
 * One kind of episode in the episodic timeline. Defined alongside node
 * classes and relationships on the same `MemorySchema` instance.
 */
export interface EpisodeKindDef<P> {
  name: string;
  description?: string;
  /** Optional schema for episode-specific structured data when this kind is used. */
  propertiesSchema?: z.ZodType<P>;
}

/** Internal type-erased shape used when iterating registered definitions. */
export type AnyNodeClassDef = NodeClassDef<unknown>;
export type AnyRelationshipDef = RelationshipDef<unknown>;
export type AnyEpisodeKindDef = EpisodeKindDef<unknown>;

/**
 * Shared ontology object — node classes, relationships, episode kinds.
 * Both `EntityMemoryAdapter` and `EpisodicMemoryAdapter` bind to the same
 * instance. Lives in `glove-memory/core` since both subsystems use it.
 *
 * Adding a new class, relationship, or kind is always safe at runtime.
 * Removing or renaming requires a consumer-managed rewrite of stored data —
 * the adapter won't notice. See README for full evolution rules.
 */
export class MemorySchema {
  private _nodeClasses = new Map<string, AnyNodeClassDef>();
  private _relationships = new Map<string, AnyRelationshipDef>();
  private _episodeKinds = new Map<string, AnyEpisodeKindDef>();

  defineNodeClass<P>(def: NodeClassDef<P>): MemorySchema {
    if (this._nodeClasses.has(def.name)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Node class "${def.name}" is already defined`,
      );
    }
    if (def.identityKeys) {
      for (const set of def.identityKeys) {
        if (set.length === 0) {
          throw new MemorySchemaError(
            "schema_mismatch",
            `Node class "${def.name}" has an empty identity key set`,
          );
        }
      }
    }
    this._nodeClasses.set(def.name, def as AnyNodeClassDef);
    return this;
  }

  defineRelationship<P>(def: RelationshipDef<P>): MemorySchema {
    if (this._relationships.has(def.type)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Relationship "${def.type}" is already defined`,
      );
    }
    this._relationships.set(def.type, def as AnyRelationshipDef);
    return this;
  }

  defineEpisodeKind<P>(def: EpisodeKindDef<P>): MemorySchema {
    if (this._episodeKinds.has(def.name)) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Episode kind "${def.name}" is already defined`,
      );
    }
    this._episodeKinds.set(def.name, def as AnyEpisodeKindDef);
    return this;
  }

  getNodeClass(name: string): AnyNodeClassDef | undefined {
    return this._nodeClasses.get(name);
  }

  requireNodeClass(name: string): AnyNodeClassDef {
    const def = this._nodeClasses.get(name);
    if (!def) {
      throw new MemorySchemaError(
        "unknown_class",
        `Node class "${name}" is not registered on the schema`,
      );
    }
    return def;
  }

  getRelationship(type: string): AnyRelationshipDef | undefined {
    return this._relationships.get(type);
  }

  requireRelationship(type: string): AnyRelationshipDef {
    const def = this._relationships.get(type);
    if (!def) {
      throw new MemorySchemaError(
        "unknown_relationship",
        `Relationship "${type}" is not registered on the schema`,
      );
    }
    return def;
  }

  getEpisodeKind(name: string): AnyEpisodeKindDef | undefined {
    return this._episodeKinds.get(name);
  }

  requireEpisodeKind(name: string): AnyEpisodeKindDef {
    const def = this._episodeKinds.get(name);
    if (!def) {
      throw new MemorySchemaError(
        "unknown_episode_kind",
        `Episode kind "${name}" is not registered on the schema`,
      );
    }
    return def;
  }

  /** All node classes as an iterable. Defensive copy not required — callers should treat as readonly. */
  get nodeClasses(): ReadonlyMap<string, AnyNodeClassDef> {
    return this._nodeClasses;
  }

  get relationships(): ReadonlyMap<string, AnyRelationshipDef> {
    return this._relationships;
  }

  get episodeKinds(): ReadonlyMap<string, AnyEpisodeKindDef> {
    return this._episodeKinds;
  }

  /** Validate properties against a registered node class schema. Throws `MemoryWriteError` with code `validation_failed` on failure (caller wraps). */
  validateNodeProps(className: string, props: unknown): unknown {
    const def = this.requireNodeClass(className);
    const parsed = def.schema.safeParse(props);
    if (!parsed.success) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Properties for node class "${className}" failed validation: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      );
    }
    return parsed.data;
  }

  validateRelationshipProps(type: string, props: unknown): unknown {
    const def = this.requireRelationship(type);
    if (!def.propertiesSchema) {
      // Allow undefined or empty object on relationships without a schema.
      if (props === undefined) return undefined;
      if (typeof props === "object" && props !== null && Object.keys(props).length === 0) {
        return props;
      }
      throw new MemorySchemaError(
        "schema_mismatch",
        `Relationship "${type}" has no propertiesSchema; properties must be omitted or {}`,
      );
    }
    const parsed = def.propertiesSchema.safeParse(props);
    if (!parsed.success) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Properties for relationship "${type}" failed validation: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      );
    }
    return parsed.data;
  }

  validateEpisodeProps(kind: string, props: unknown): unknown {
    const def = this.requireEpisodeKind(kind);
    if (!def.propertiesSchema) {
      if (props === undefined) return undefined;
      if (typeof props === "object" && props !== null && Object.keys(props).length === 0) {
        return props;
      }
      throw new MemorySchemaError(
        "schema_mismatch",
        `Episode kind "${kind}" has no propertiesSchema; properties must be omitted or {}`,
      );
    }
    const parsed = def.propertiesSchema.safeParse(props);
    if (!parsed.success) {
      throw new MemorySchemaError(
        "schema_mismatch",
        `Properties for episode kind "${kind}" failed validation: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      );
    }
    return parsed.data;
  }
}
