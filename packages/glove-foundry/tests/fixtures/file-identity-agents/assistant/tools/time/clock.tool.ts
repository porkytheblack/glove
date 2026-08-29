import { z } from "zod";
import { defineSharedTool } from "../../../../../../src/index.js";

export default defineSharedTool({
  description: "A file-identified fixture tool",
  config: z.object({ timezone: z.string() }),
  tool: {
    name: "fixture_clock",
    description: "Return fixture time",
    inputSchema: z.object({}),
    async do() {
      return { status: "success" as const, data: "now" };
    },
  },
});
