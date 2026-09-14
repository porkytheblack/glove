import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

/** One file, one default export. The filename is the id: `current-time`. */
const currentTime = defineSharedTool({
  description: "Return the current ISO timestamp",
  tool: {
    name: "current_time",
    description: "Return the current ISO timestamp",
    inputSchema: z.object({}),
    async do() {
      return { status: "success" as const, data: new Date().toISOString() };
    },
  },
});

export default currentTime;
