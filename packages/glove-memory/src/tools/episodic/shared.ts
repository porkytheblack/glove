import type { ToolResultData } from "glove-core";
import { ProvenanceSchema, type Provenance } from "../../core/provenance";
import {
  EpisodicMemoryError,
  MemoryError,
  MemoryNotFoundError,
  MemoryQueryError,
  MemorySchemaError,
  MemoryWriteError,
} from "../../core/errors";
import type { Episode } from "../../episodic/types";
import type { MemorySchema, EpisodeKindDef } from "../../core/schema";

export const ProvenanceArgSchema = ProvenanceSchema;

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
    const data: Record<string, unknown> = { code: e.code };
    if (e instanceof MemoryWriteError && e.matchedIds) data.matchedIds = e.matchedIds;
    if (e instanceof MemoryQueryError && e.operator) data.operator = e.operator;
    return { status: "error", message: e.message, data };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: "error", message, data: null };
}

export function publicEpisode(ep: Episode): Omit<Episode, "provenance"> {
  const { provenance: _provenance, ...rest } = ep;
  return rest;
}

export function publicEpisodes(eps: Episode[]): Array<Omit<Episode, "provenance">> {
  return eps.map(publicEpisode);
}

/** Render the registered episode kinds for inclusion in tool descriptions. */
export function renderEpisodeKindsSection(schema: MemorySchema): string {
  const kinds = schema.listEpisodeKinds();
  if (kinds.length === 0) return "No episode kinds registered.";
  const lines = ["Episode kinds:"];
  for (const k of kinds) {
    lines.push(formatKind(k));
  }
  return lines.join("\n");
}

function formatKind(k: EpisodeKindDef<any>): string {
  const out = [`- ${k.name}${k.description ? ` — ${k.description}` : ""}`];
  if (k.propertiesSchema) {
    out.push(`  properties: ${describeZodObject(k.propertiesSchema as unknown as { _def?: { shape?: () => Record<string, any> } })}`);
  }
  return out.join("\n");
}

function describeZodObject(schema: { _def?: { shape?: () => Record<string, any> } }): string {
  const def = schema._def;
  if (!def || typeof def.shape !== "function") return "object";
  const shape = def.shape();
  const parts: string[] = [];
  for (const [k, sub] of Object.entries(shape)) {
    const optional = isOptional(sub);
    parts.push(`${k}${optional ? "?" : ""}: ${describeZodScalar(sub)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function isOptional(s: any): boolean {
  const t = s?._def?.typeName;
  return t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable";
}

function describeZodScalar(s: any): string {
  const def = s?._def;
  if (!def) return "any";
  switch (def.typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBoolean": return "boolean";
    case "ZodArray": return "array";
    case "ZodObject": return "object";
    case "ZodOptional":
    case "ZodDefault":
    case "ZodNullable":
      return def.innerType ? describeZodScalar(def.innerType) : "any";
    default:
      return def.typeName?.replace(/^Zod/, "").toLowerCase() ?? "any";
  }
}

export {
  EpisodicMemoryError,
  MemoryNotFoundError,
  MemorySchemaError,
  MemoryWriteError,
};
