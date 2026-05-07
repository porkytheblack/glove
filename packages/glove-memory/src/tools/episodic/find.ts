import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { EpisodeQuerySpecSchema, type EpisodeQuerySpec } from "../../episodic/types";
import { MemoryError } from "../../core/errors";
import { renderEpisodeKindsBlock } from "../descriptions";
import { stripEpisodeProvenance } from "../shared";

export function createEpisodicFindTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<EpisodeQuerySpec> {
  return {
    name: "glove_episodic_find",
    description:
      `Structured filter over episodes. Filter by kind, participant entity IDs, time range, ` +
      `and episode-specific properties. Results are sorted by occurredAt descending by default.\n\n` +
      `${renderEpisodeKindsBlock(adapter.schema)}`,
    inputSchema: EpisodeQuerySpecSchema,
    async do(input) {
      try {
        const episodes = await adapter.findEpisodes(input);
        return {
          status: "success" as const,
          data: { episodes: episodes.map(stripEpisodeProvenance) },
        };
      } catch (e) {
        if (e instanceof MemoryError) {
          return { status: "error" as const, message: `${e.code}: ${e.message}`, data: null };
        }
        throw e;
      }
    },
  };
}
