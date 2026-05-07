import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { errorResult, publicEpisode, renderEpisodeKindsSection } from "./shared";

const SearchInputSchema = z.object({
  query: z.string().min(1).describe("Natural-language query — searched semantically over episode content."),
  filter: z
    .object({
      kind: z.union([z.string(), z.array(z.string())]).optional(),
      participantIds: z.array(z.string()).optional(),
      timeRange: z.object({ start: z.string().optional(), end: z.string().optional() }).optional(),
    })
    .optional(),
  recencyWeight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Blend of semantic similarity and time decay. 0 = pure semantic, 1 = pure recency. Default 0.2.",
    ),
  limit: z.number().int().positive().optional(),
});

export type EpisodicSearchInput = z.infer<typeof SearchInputSchema>;

export function buildEpisodicSearchTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<EpisodicSearchInput> {
  return {
    name: "glove_episodic_search",
    description:
      `Semantic search over episode content, blended with a recency bias. Use for "remind me what we discussed about X" — when you have a phrasing of the topic but no exact participant or time window.\n\n` +
      `Available filters narrow the candidate set before ranking.\n\n` +
      `${renderEpisodeKindsSection(adapter.schema)}`,
    inputSchema: SearchInputSchema,
    async do(input) {
      try {
        if (!adapter.searchEpisodes) {
          return {
            status: "error",
            message: "This adapter does not support semantic search.",
            data: { code: "semantic_search_unsupported" },
          };
        }
        const results = await adapter.searchEpisodes(input.query, {
          filter: input.filter,
          recencyWeight: input.recencyWeight,
          limit: input.limit,
        });
        return {
          status: "success",
          data: {
            results: results.map((r) => ({
              episode: publicEpisode(r.episode),
              score: r.score,
              distance: r.distance,
            })),
            count: results.length,
          },
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
