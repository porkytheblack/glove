import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { NodeFilterSchema } from "../../entity/query";
import { errorResult, publicEpisodes, renderEpisodeKindsSection } from "./shared";

const FindInputSchema = z.object({
  kind: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Restrict to a single registered kind, or any of an array of kinds."),
  participantIds: z
    .array(z.string())
    .optional()
    .describe("Restrict to episodes that include any of these entity IDs in their participants list."),
  properties: NodeFilterSchema.optional().describe(
    "Filter on episode-specific properties using the same operator set as entity queries.",
  ),
  timeRange: z
    .object({ start: z.string().optional(), end: z.string().optional() })
    .optional()
    .describe("ISO 8601 bounds. Episodes that overlap the range are included."),
  orderBy: z
    .enum(["occurredAt:asc", "occurredAt:desc", "createdAt:asc", "createdAt:desc"])
    .optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type FindEpisodesInput = z.infer<typeof FindInputSchema>;

export function buildEpisodicFindTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<FindEpisodesInput> {
  return {
    name: "glove_episodic_find",
    description:
      `Structured filter over recorded episodes. Combine kind, participant entity IDs, time range, and arbitrary property filters. Defaults to occurredAt:desc.\n\n` +
      `${renderEpisodeKindsSection(adapter.schema)}`,
    inputSchema: FindInputSchema,
    async do(input) {
      try {
        const eps = await adapter.findEpisodes({
          where: {
            kind: input.kind,
            participantIds: input.participantIds,
            properties: input.properties as Record<string, never> | undefined,
          },
          timeRange: input.timeRange,
          orderBy: input.orderBy,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          status: "success",
          data: { episodes: publicEpisodes(eps), count: eps.length },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
