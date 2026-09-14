import { z } from "zod";
export const tool = {
  description: "Clock",
  inputSchema: z.object({}),
  async do() {
    return { status: "success" as const, data: "now" };
  },
};
