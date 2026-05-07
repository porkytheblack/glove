import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { MemoryError } from "../../core/errors";
import { renderEpisodeKindsBlock } from "../descriptions";
import { stripEpisodeProvenance } from "../shared";

const TimelineInput = z
  .object({
    entityId: z
      .string()
      .optional()
      .describe(
        "Entity ID to scope the timeline to. Episodes are returned in the order they occurred. Mutually exclusive with timeRange.",
      ),
    timeRange: z
      .object({
        start: z.string().describe("ISO 8601 timestamp."),
        end: z.string().describe("ISO 8601 timestamp."),
      })
      .optional()
      .describe("Time window for the timeline. Mutually exclusive with entityId."),
    kind: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("Optional kind filter — single kind name or array of kinds."),
    orderBy: z
      .enum(["occurredAt:asc", "occurredAt:desc"])
      .optional()
      .describe("Default `occurredAt:asc` for time windows, `occurredAt:desc` for entities."),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) => Boolean(v.entityId) !== Boolean(v.timeRange),
    "Provide exactly one of `entityId` or `timeRange`",
  );

type TimelineInput = z.infer<typeof TimelineInput>;

export function createEpisodicTimelineTool(
  adapter: EpisodicMemoryAdapter,
): GloveFoldArgs<TimelineInput> {
  return {
    name: "glove_episodic_timeline",
    description:
      `Chronological listing for an entity or a time window. Pass exactly one of \`entityId\` or \`timeRange\`. ` +
      `Optional kind filter narrows the listing. Use this for narrative context — "what has happened with X recently" ` +
      `or "what happened between dates Y and Z".\n\n` +
      `${renderEpisodeKindsBlock(adapter.schema)}`,
    inputSchema: TimelineInput,
    async do(input) {
      try {
        const orderBy = input.orderBy ?? (input.timeRange ? "occurredAt:asc" : "occurredAt:desc");
        const opts = {
          orderBy,
          limit: input.limit,
          offset: input.offset,
          kind: input.kind,
        };
        const episodes = input.entityId
          ? await adapter.episodesForEntity(input.entityId, opts)
          : await adapter.episodesBetween(input.timeRange!.start, input.timeRange!.end, opts);
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
