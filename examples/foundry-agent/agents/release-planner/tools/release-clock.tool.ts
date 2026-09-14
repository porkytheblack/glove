import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

const releaseClock = defineSharedTool({
  description: "Return the release coordinator's current timestamp",
  tool: {
    name: "release_clock",
    description: "Return the release coordinator's current timestamp",
    inputSchema: z.object({}),
    async do() {
      return { status: "success" as const, data: new Date().toISOString() };
    },
  },
});

export default releaseClock;
