import { Effect } from "effect";
import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

const knowledgeInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});

const knowledge = defineSharedTool({
  description: "Search the knowledge sources selected on this agent instance",
  config: z.object({
    sources: z.array(z.object({
      title: z.string(),
      body: z.string(),
      url: z.string().url().optional(),
    })).default([]),
  }),
  create: ({ config }) => Effect.succeed({
    name: "hermes_knowledge_search",
    description: "Search the instance's mounted knowledge sources by keyword",
    inputSchema: knowledgeInput,
    async do(input: z.output<typeof knowledgeInput>) {
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = config.sources
        .map((source) => ({
          ...source,
          score: terms.filter((term) => `${source.title} ${source.body}`.toLowerCase().includes(term)).length,
        }))
        .filter((source) => source.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.limit);
      return { status: "success" as const, data: { query: input.query, matches } };
    },
  }),
});

export default knowledge;
