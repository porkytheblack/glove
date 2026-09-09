import type { MemorySchema } from "../core/schema";
import type { EmbeddingAdapter } from "../core/embedding";
import type { EntityMemoryAdapter } from "../entity/adapter";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import type { ResourceFsAdapter } from "../resources/adapter";
import type { ContextAdapter } from "../context/adapter";
import { InMemoryEntityAdapter } from "../in-memory/entity";
import { InMemoryEpisodicAdapter } from "../in-memory/episodic";
import { InMemoryResourcesAdapter } from "../in-memory/resources";
import { InMemoryContextAdapter } from "../in-memory/context";
import { entityState, episodicState, resourceState, contextState } from "./state";
import { SqliteMemoryStorage, type SqliteMemoryStorageOptions } from "./storage";

export { MemoryStorageError } from "./storage";
export type { SqliteMemoryStorageOptions } from "./storage";

export interface SqliteMemoryOptions extends SqliteMemoryStorageOptions {
  schema: MemorySchema;
  /** Embedding-free episodic content search. Defaults to false. */
  fuzzySearch?: boolean;
  /** Optional vector search; indexing remains an explicit adapter operation. */
  embedder?: EmbeddingAdapter;
}

export interface SqliteMemoryAdapters {
  entity: EntityMemoryAdapter;
  episodic: EpisodicMemoryAdapter;
  resources: ResourceFsAdapter;
  context: ContextAdapter;
}

/**
 * Durable native Glove memory for a single host (Node >=22.13).
 * SQLite is authoritative; each operation reconstructs native query/mutation
 * semantics from the latest committed snapshot. No process-local state is reused.
 * Writes are transactional per method, including merge and bulk replacement.
 * Queries scan a bounded snapshot: this is not a distributed/indexed graph DB.
 */
export function createSqliteMemoryAdapters(options: SqliteMemoryOptions): SqliteMemoryAdapters {
  const storage = new SqliteMemoryStorage(options);
  const { schema, namespace, embedder, fuzzySearch } = options;
  const entityId = `sqlite:${namespace}:entity`;
  const episodicId = `sqlite:${namespace}:episodic`;
  const resourcesId = `sqlite:${namespace}:resources`;
  const contextId = `sqlite:${namespace}:context`;
  const entity = <R>(write: boolean, use: (adapter: InMemoryEntityAdapter) => Promise<R>) =>
    storage.run("entity", entityState, state => new InMemoryEntityAdapter({ schema, identifier: entityId, state }), write, use);
  const episodic = <R>(write: boolean, use: (adapter: InMemoryEpisodicAdapter) => Promise<R>) =>
    storage.run("episodic", episodicState, state => new InMemoryEpisodicAdapter({ schema, identifier: episodicId, state, embedder, fuzzySearch }), write, use);
  const resources = <R>(write: boolean, use: (adapter: InMemoryResourcesAdapter) => Promise<R>) =>
    storage.run("resources", resourceState, state => new InMemoryResourcesAdapter({ schema, identifier: resourcesId, state, embedder }), write, use);
  const context = <R>(write: boolean, use: (adapter: InMemoryContextAdapter) => Promise<R>) =>
    storage.run("context", contextState, state => new InMemoryContextAdapter({ schema, identifier: contextId, state }), write, use);
  return {
    entity: {
      identifier: entityId, schema,
      addNode: (...args) => entity(true, a => a.addNode(...args)),
      getNode: (...args) => entity(false, a => a.getNode(...args)),
      updateNode: (...args) => entity(true, a => a.updateNode(...args)),
      mergeNodes: (...args) => entity(true, a => a.mergeNodes(...args)),
      connect: (...args) => entity(true, a => a.connect(...args)),
      disconnect: (...args) => entity(true, a => a.disconnect(...args)),
      findNodes: (...args) => entity(false, a => a.findNodes(...args)),
      getNodeWithNeighbours: (...args) => entity(false, a => a.getNodeWithNeighbours(...args)),
      query: (...args) => entity(false, a => a.query(...args)),
    },
    episodic: {
      identifier: episodicId, schema, supportsSemanticSearch: Boolean(embedder || fuzzySearch),
      recordEpisode: (...args) => episodic(true, a => a.recordEpisode(...args)),
      getEpisode: (...args) => episodic(false, a => a.getEpisode(...args)),
      updateEpisode: (...args) => episodic(true, a => a.updateEpisode(...args)),
      deleteEpisode: (...args) => episodic(true, a => a.deleteEpisode(...args)),
      findEpisodes: (...args) => episodic(false, a => a.findEpisodes(...args)),
      episodesForEntity: (...args) => episodic(false, a => a.episodesForEntity(...args)),
      episodesBetween: (...args) => episodic(false, a => a.episodesBetween(...args)),
      replaceParticipantId: (...args) => episodic(true, a => a.replaceParticipantId(...args)),
      findEpisodesNeedingEmbedding: (...args) => episodic(false, a => a.findEpisodesNeedingEmbedding(...args)),
      setEmbedding: (...args) => episodic(true, a => a.setEmbedding(...args)),
      searchEpisodes: (...args) => episodic(false, a => a.searchEpisodes(...args)),
    },
    resources: {
      identifier: resourcesId, schema, supportsSemanticSearch: Boolean(embedder),
      list: (...args) => resources(false, a => a.list(...args)),
      read: (...args) => resources(false, a => a.read(...args)),
      stat: (...args) => resources(false, a => a.stat(...args)),
      exists: (...args) => resources(false, a => a.exists(...args)),
      grep: (...args) => resources(false, a => a.grep(...args)),
      glob: (...args) => resources(false, a => a.glob(...args)),
      searchSemantic: (...args) => resources(false, a => a.searchSemantic(...args)),
      write: (...args) => resources(true, a => a.write(...args)),
      edit: (...args) => resources(true, a => a.edit(...args)),
      mkdir: (...args) => resources(true, a => a.mkdir(...args)),
      move: (...args) => resources(true, a => a.move(...args)),
      remove: (...args) => resources(true, a => a.remove(...args)),
      setMetadata: (...args) => resources(true, a => a.setMetadata(...args)),
      linksFor: (...args) => resources(false, a => a.linksFor(...args)),
      replaceLinkTarget: (...args) => resources(true, a => a.replaceLinkTarget(...args)),
      findFilesNeedingEmbedding: (...args) => resources(false, a => a.findFilesNeedingEmbedding(...args)),
      setEmbedding: (...args) => resources(true, a => a.setEmbedding(...args)),
    },
    context: {
      identifier: contextId, schema,
      list: (...args) => context(false, a => a.list(...args)),
      get: (...args) => context(false, a => a.get(...args)),
      render: (...args) => context(false, a => a.render(...args)),
      set: (...args) => context(true, a => a.set(...args)),
      update: (...args) => context(true, a => a.update(...args)),
      unset: (...args) => context(true, a => a.unset(...args)),
      setSection: (...args) => context(true, a => a.setSection(...args)),
      unsetSection: (...args) => context(true, a => a.unsetSection(...args)),
    },
  };
}
