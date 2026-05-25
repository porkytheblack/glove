import z from "zod";
import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { ToolContext } from "./common";

const AckSchema = z.object({
  message_id: z
    .string()
    .min(1)
    .describe(
      "The id of the incoming mesh message being acknowledged. Look for 'message id: <id>' in the inbox notification.",
    ),
  note: z
    .string()
    .optional()
    .describe(
      "Optional short note explaining the acknowledgement. For longer replies with content, use mesh_send_message with in_reply_to instead.",
    ),
});

type AckInput = z.infer<typeof AckSchema>;

export function buildMeshAcknowledgeTool(
  ctx: ToolContext,
): GloveFoldArgs<AckInput> {
  return {
    name: "mesh_acknowledge",
    description:
      "Acknowledge receipt of an incoming message from another mesh agent. " +
      "If the sender was blocking on this message, they will be unblocked. " +
      "Use this for lightweight confirmations; for a substantive reply with content, " +
      "use mesh_send_message with in_reply_to instead.",
    inputSchema: AckSchema,
    async do(input: AckInput): Promise<ToolResultData> {
      try {
        await ctx.adapter.acknowledge(input.message_id, input.note);
      } catch (err) {
        return {
          status: "error",
          data: null,
          message: `mesh_acknowledge failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }
      return {
        status: "success",
        data: { acknowledged: input.message_id },
      };
    },
  };
}
