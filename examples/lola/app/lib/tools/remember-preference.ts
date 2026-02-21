import { defineTool } from "glove-react";
import { z } from "zod";

// ─── remember_preference — pure data tool, no visual display ────────────────

export function createRememberPreferenceTool() {
  return defineTool({
    name: "remember_preference",
    description:
      "Remember a user preference about movies — their favorite genres, directors, actors, moods, or anything else. This is a data-only tool with no visual display. Use it whenever the user expresses a preference worth remembering for future recommendations.",
    inputSchema: z.object({
      preference: z.string().describe("User preference to remember"),
      category: z
        .string()
        .optional()
        .describe("Category: genre, director, actor, mood, other"),
    }),
    displayPropsSchema: z.object({}),
    async do(input) {
      const category = input.category ?? "other";
      return {
        status: "success" as const,
        data: `Noted preference (${category}): ${input.preference}`,
      };
    },
  });
}
