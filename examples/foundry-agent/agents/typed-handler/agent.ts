import { Effect } from "effect";
import type { AgentHandlerContext, FoundryRequest } from "glove-foundry";
import type { IGloveRunnable } from "glove-core";
import { z } from "zod";

export const description =
  "A model-free agent assembled entirely from named convention exports";

export const payloadSchema = z.object({
  value: z.string().describe("Value to normalize"),
});

export const run = (
  _agent: IGloveRunnable,
  { input, emit }: AgentHandlerContext<FoundryRequest>,
) =>
  Effect.sync(() => {
    const value = payloadSchema.parse(input.payload);
    emit({ type: "typed-handler.completed", data: { length: value.value.length } });
    return {
      normalized: value.value.trim().toLowerCase(),
      handledBy: "named-export-run" as const,
    };
  });
