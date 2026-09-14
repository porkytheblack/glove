import { z } from "zod";

export const briefingInputSchema = z.object({
  port: z.number().int().min(1024).max(65_535),
  token: z.string().min(24),
  stormId: z.string().min(1).max(128),
  idleMs: z.number().int().min(5_000).max(30 * 60_000).default(120_000),
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
});

export type BriefingInput = z.infer<typeof briefingInputSchema>;
