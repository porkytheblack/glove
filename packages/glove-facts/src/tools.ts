import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { FactCaptureError, type FactStore } from "./store";
import type { FactInput } from "./types";

const captureSchema = z.object({ fact: z.string().trim().min(1).max(2000), urgent: z.boolean().optional() }).strict();
/** Scope, provenance and verification are host-owned; the model can only capture text. */
export function buildRecordFactTool(store: FactStore, source: () => {
  source: FactInput["source"];
  /** Stable message/tool-call identity. Same operation + same text is idempotent. */
  operationId: string;
}): GloveFoldArgs<z.infer<typeof captureSchema>> {
  return {
    name: "record_fact",
    description: "Retain information, decisions, corrections, intentions or observed results for later goals and forms. Capture now even if the relevant step is not active. This records unverified evidence; it does not complete work or grant approval. Mark urgent information immediately.",
    inputSchema: captureSchema,
    async do(raw) {
      try {
        const input = captureSchema.parse(raw);
        const origin = source();
        const fact = await store.record({ text: input.fact, urgent: input.urgent, source: origin.source }, { operationId: JSON.stringify([origin.operationId, input.fact]) });
        return { status: "success", data: { recorded: true, fact } };
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : String(error), data: error instanceof FactCaptureError ? { recorded: true, fact: error.fact } : { recorded: false } };
      }
    },
  };
}
export function useFacts<G extends { fold: <I>(tool: GloveFoldArgs<I>) => unknown }>(glove: G, store: FactStore, source: Parameters<typeof buildRecordFactTool>[1]): { glove: G; facts: FactStore } {
  glove.fold(buildRecordFactTool(store, source));
  return { glove, facts: store };
}
