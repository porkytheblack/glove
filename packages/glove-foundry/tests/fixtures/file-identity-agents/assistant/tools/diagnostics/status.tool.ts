import { z } from "zod";

export const description = "Return a named-export fixture status";
export const inputSchema = z.object({});

async function run() {
  return { status: "success" as const, data: { ready: true } };
}

export { run as do };
