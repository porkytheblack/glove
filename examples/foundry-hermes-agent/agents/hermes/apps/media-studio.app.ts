import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";

export const mediaStudioConfigSchema = z.object({
  provider: z.enum(["auto", "gemini", "fixture"]).default("auto"),
  candidates: z.number().int().min(1).max(4).default(1),
});

const mediaStudio = defineApp({
  description: "Dynamically mount Glove image generation and review tools on an instance",
  config: mediaStudioConfigSchema,
  install: ({ config }) => Effect.succeed({
    tools: [{
      name: "hermes_media_status",
      description: "Show which media surface this instance selected",
      inputSchema: z.object({}),
      async do() {
        return { status: "success" as const, data: config };
      },
    }],
  }),
});

export default mediaStudio;
