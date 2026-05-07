import { z } from "zod";
import type { ToolResultData } from "glove-core";
import { LinkSchema, ProvenanceSchema, type Provenance } from "../../core/provenance";
import {
  MemoryError,
  MemoryNotFoundError,
  MemoryWriteError,
  ResourceFsError,
} from "../../core/errors";
import type {
  ResourceBody,
  ResourceFile,
  ResourceMetadata,
} from "../../resources/types";
import type { MemorySchema, ResourceRootDef } from "../../core/schema";

export const ProvenanceArgSchema = ProvenanceSchema;

export const ResourceBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("markdown"), text: z.string() }),
  z.object({ type: z.literal("url"), url: z.string(), cachedText: z.string().optional() }),
]);

export const ResourceMetadataSchema = z
  .object({
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    links: z.array(LinkSchema).default([]),
  })
  .catchall(z.unknown());

export const ResourceMetadataPatchSchema = z
  .object({
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    links: z.array(LinkSchema).optional(),
  })
  .catchall(z.unknown());

export function fillProvenance(p: Provenance | undefined, fallbackActor: string): Provenance {
  const now = new Date().toISOString();
  return {
    source: p?.source ?? "tool",
    actor: p?.actor ?? fallbackActor,
    timestamp: p?.timestamp ?? now,
    note: p?.note,
  };
}

export function errorResult(e: unknown): ToolResultData {
  if (e instanceof MemoryError) {
    return { status: "error", message: e.message, data: { code: e.code } };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: "error", message, data: null };
}

export function publicFile(file: ResourceFile): Omit<ResourceFile, "provenance"> {
  const { provenance: _provenance, ...rest } = file;
  return rest;
}

export function renderResourceRootsSection(schema: MemorySchema): string {
  const roots = schema.listResourceRoots();
  if (roots.length === 0) return "No registered resource roots.";
  const lines = ["Registered resource roots:"];
  for (const r of roots) {
    lines.push(formatRoot(r));
  }
  return lines.join("\n");
}

function formatRoot(r: ResourceRootDef): string {
  const tag = r.semanticSearch === false ? " (no semantic search)" : "";
  return `- ${r.path}${r.description ? ` — ${r.description}` : ""}${tag}`;
}

export {
  MemoryNotFoundError,
  MemoryWriteError,
  ResourceFsError,
  type ResourceBody,
  type ResourceMetadata,
};
