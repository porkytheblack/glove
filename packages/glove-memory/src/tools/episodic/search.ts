import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { EpisodicMemoryError, MemoryError } from "../../core/errors";
import { renderEpisodeKindsBlock } from "../descriptions";
import { stripEpisodeProvenance } from "../shared";

const SearchInput = z.object({
  query: z.string().min(1).describe("Natural-language description of what to find."),
  filter: z
    .object({
      participantIds: z.array(z.string()).optional(),
      kind: z.union([z.string(), z.array(z.string())]).optional(),
      timeRange: z
        .object({
          start: z.string().optional(),
          end: z.string().optional(),
        })
        .optional(),
    })
    .optional()
    .describe("Optional filter: narrow by participant entity IDs, kind, or time range."),
  limit: z.number().int().positive().optional(),
  recencyWeight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Recency bias 0..1. 0 = pure semantic, 1 = pure recency. Default 0.2."),
});

type SearchInput = z.infer<typeof SearchInput>;

export function createEpisodicSearchTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<SearchInput> {
  return {
    name: "glove_episodic_search",
    description:
      `Semantic search over episode content. Returns episodes ranked by a blend of semantic similarity ` +
      `and recency (recencyWeight 0..1, default 0.2 — slight bias toward recent). Filter by participant ` +
      `entity IDs, kind, or time range to narrow the search.\n\n` +
      `Note: only episodes with fresh embeddings are searchable here. Episodes still pending embedding ` +
      `(missing or stale) are invisible to this tool but are visible via glove_episodic_find / ` +
      `glove_episodic_timeline.\n\n` +
      `${renderEpisodeKindsBlock(adapter.schema)}`,
    inputSchema: SearchInput,
    async do(input) {
      if (!adapter.supportsSemanticSearch || !adapter.searchEpisodes) {
        return {
          status: "error" as const,
          message: "semantic_search_unsupported: this episodic adapter has no embedding backend wired up.",
          data: null,
        };
      }
      try {
        const results = await adapter.searchEpisodes(input.query, {
          filter: input.filter,
          limit: input.limit,
          recencyWeight: input.recencyWeight,
        });
        return {
          status: "success" as const,
          data: {
            results: results.map((r) => ({
              episode: stripEpisodeProvenance(r.episode),
              score: r.score,
              distance: r.distance,
            })),
          },
        };
      } catch (e) {
        if (e instanceof EpisodicMemoryError || e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}
