import type { ToolResultData } from "glove-core";
import { ProvenanceSchema, type Provenance } from "../../core/provenance";
import {
  MemoryError,
  MemoryNotFoundError,
  MemoryWriteError,
} from "../../core/errors";
import type { ContextEntry } from "../../context/types";

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
    return {
      status: "error",
      message: e.message,
      data: { code: e.code },
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: "error", message, data: null };
}

/** Strip provenance from entries returned to the agent. */
export function publicEntry(entry: ContextEntry): Omit<ContextEntry, "provenance"> {
  const { provenance: _provenance, ...rest } = entry;
  return rest;
}

export function publicEntries(entries: ContextEntry[]): Array<Omit<ContextEntry, "provenance">> {
  return entries.map(publicEntry);
}

export { MemoryError, MemoryNotFoundError, MemoryWriteError };
