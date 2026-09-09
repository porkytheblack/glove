import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";

export const HermesInstanceContextSchema = z.object({
  displayName: z.string().default("Hermes"),
  personality: z.string().default("direct, resourceful, and careful"),
  ownerName: z.string().default("operator"),
  enabledSkills: z.array(z.enum(["planning", "research"])).default(["planning", "research"]),
  enableDailyReview: z.boolean().default(true),
  maxTurns: z.number().int().min(4).max(64).default(20),
});

export type HermesInstanceContext = z.output<typeof HermesInstanceContextSchema>;

export function hermesContext(context: AgentAssemblyContext): HermesInstanceContext {
  return HermesInstanceContextSchema.parse(context.agentInstance.context);
}

export const VerificationPayloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("verify-workspace") }),
  z.object({ mode: z.literal("cancel-schedule"), activationId: z.string().min(1) }),
  z.object({ mode: z.literal("sleep") }),
]);
