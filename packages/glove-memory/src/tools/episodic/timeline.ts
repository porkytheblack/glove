import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { errorResult, publicEpisodes, renderEpisodeKindsSection } from "./shared";

const TimelineInputSchema = z.union([
  z.object({
    entityId: z
      .string()
      .min(1)
      .describe("Entity ID. Returns episodes that include this entity in their participants list."),
    kind: z.union([z.string(), z.array(z.string())]).optional(),
    orderBy: z.enum(["occurredAt:asc", "occurredAt:desc"]).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.object({
    timeRange: z.object({ start: z.string(), end: z.string() }),
    kind: z.union([z.string(), z.array(z.string())]).optional(),
    orderBy: z.enum(["occurredAt:asc", "occurredAt:desc"]).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
]);

export type TimelineInput = z.infer<typeof TimelineInputSchema>;

export function buildEpisodicTimelineTool(adapter: EpisodicMemoryAdapter): GloveFoldArgs<TimelineInput> {
  return {
    name: "glove_episodic_timeline",
    description:
      `Chronological listing of episodes. Provide either an entityId (history of a specific entity) or a timeRange (everything in a window). Defaults to occurredAt:desc when scoping by entity, occurredAt:asc when scoping by time range.\n\n` +
      `${renderEpisodeKindsSection(adapter.schema)}`,
    inputSchema: TimelineInputSchema,
    async do(input) {
      try {
        if ("entityId" in input) {
          const eps = await adapter.episodesForEntity(input.entityId, {
            kind: input.kind,
            orderBy: input.orderBy ?? "occurredAt:desc",
            limit: input.limit,
            offset: input.offset,
          });
          return { status: "success", data: { episodes: publicEpisodes(eps), count: eps.length } };
        }
        const eps = await adapter.episodesBetween(input.timeRange.start, input.timeRange.end, {
          kind: input.kind,
          orderBy: input.orderBy ?? "occurredAt:asc",
          limit: input.limit,
          offset: input.offset,
        });
        return { status: "success", data: { episodes: publicEpisodes(eps), count: eps.length } };
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
