import { z } from "zod";
import { LinkSchema, ProvenanceSchema } from "../core/provenance";
import { ContextEntryInputSchema } from "../context/types";
import type { EntityMemoryState } from "../in-memory/entity";
import type { EpisodicMemoryState } from "../in-memory/episodic";
import type { ResourceMemoryState } from "../in-memory/resources";
import type { ContextMemoryState } from "../in-memory/context";
import { normalisePath } from "../resources/paths";

const record = z.record(z.string(), z.unknown());
const timestamps = { createdAt: z.string(), updatedAt: z.string(), provenance: z.array(ProvenanceSchema) };
const id = z.string().min(1);
const nextId = z.number().int().positive();
const embeddingStatus = z.enum(["missing", "fresh", "stale"]);
const embeddings = z.array(z.tuple([id, z.array(z.number().finite())]));
const unique = (values: string[]) => new Set(values).size === values.length;
const path = z.string().refine(value => {
  try { return normalisePath(value) === value; } catch { return false; }
});

// Validate the storage format, not today's ontology: schema changes must not
// silently strip or rewrite previously valid data. Native methods validate writes.
export const entityState: z.ZodType<EntityMemoryState> = z.object({
  nextId,
  nodes: z.array(z.object({ id, className: id, props: record, ...timestamps })),
  edges: z.array(z.object({ id, fromId: id, toId: id, type: id, props: record.optional(), ...timestamps })),
}).strict().refine(state => {
  const ids = new Set(state.nodes.map(node => node.id));
  return unique(state.nodes.map(node => node.id)) && unique(state.edges.map(edge => edge.id)) &&
    state.edges.every(edge => ids.has(edge.fromId) && ids.has(edge.toId));
});

export const episodicState: z.ZodType<EpisodicMemoryState> = z.object({
  nextId,
  episodes: z.array(z.object({
    id, occurredAt: z.union([z.string(), z.object({ start: z.string(), end: z.string() })]),
    content: z.string(), kind: id, participants: z.array(z.object({ entityId: id, role: z.string().optional() })),
    properties: record.optional(), embeddingStatus, ...timestamps,
  })),
  embeddings,
}).strict().refine(state => unique(state.episodes.map(episode => episode.id)) &&
  unique(state.embeddings.map(([id]) => id)) &&
  state.embeddings.every(([id]) => state.episodes.some(episode => episode.id === id)));

export const resourceState: z.ZodType<ResourceMemoryState> = z.object({
  files: z.array(z.object({
    path,
    body: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("markdown"), text: z.string() }),
      z.object({ type: z.literal("url"), url: z.string(), cachedText: z.string().optional() }),
    ]),
    metadata: z.object({ summary: z.string().optional(), tags: z.array(z.string()), links: z.array(LinkSchema) }).catchall(z.unknown()),
    embeddingStatus, ...timestamps,
  })),
  emptyDirs: z.array(path),
  embeddings,
}).strict().refine(state => unique(state.files.map(file => file.path)) && unique(state.emptyDirs) &&
  unique(state.embeddings.map(([path]) => path)) &&
  state.embeddings.every(([path]) => state.files.some(file => file.path === path)));

export const contextState: z.ZodType<ContextMemoryState> = z.object({
  entries: z.array(ContextEntryInputSchema.extend({ id, ...timestamps })),
  nextId,
}).strict().refine(state => unique(state.entries.map(entry => entry.id)));
