import z from "zod";
import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { MeshMessage } from "../core/types";
import {
  generateMessageId,
  nowIso,
  type ToolContext,
} from "./common";

const BroadcastSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Message body sent to every other agent currently registered on the mesh.",
    ),
  blocking: z
    .boolean()
    .default(false)
    .describe(
      "If true, wait for at least one acknowledgement before continuing. The first ack received resolves the wait.",
    ),
});

type BroadcastInput = z.infer<typeof BroadcastSchema>;

export function buildMeshBroadcastTool(
  ctx: ToolContext,
): GloveFoldArgs<BroadcastInput> {
  return {
    name: "glove_mesh_broadcast",
    description:
      "Broadcast a message to every other agent on the mesh network. " +
      "Set blocking=true to wait for at least one acknowledgement before continuing. " +
      "Acknowledgements and replies are delivered to you automatically.",
    inputSchema: BroadcastSchema,
    async do(input: BroadcastInput): Promise<ToolResultData> {
      const msg: Omit<MeshMessage, "to"> = {
        id: generateMessageId(ctx.identity.id),
        from: ctx.identity.id,
        content: input.content,
        blocking: input.blocking,
        created_at: nowIso(),
      };

      let waiting = false;
      if (input.blocking) {
        try {
          await ctx.waits.begin(msg.id, `Broadcast ${msg.id}: waiting for at least one acknowledgement`, msg.created_at);
          waiting = true;
        } catch (err) {
          return {
            status: "error",
            data: null,
            message: `glove_mesh_broadcast failed to record pending blocking item for ${msg.id}: ${(err as Error)?.message ?? String(err)}`,
          };
        }
      }

      try {
        await ctx.adapter.broadcast(msg);
      } catch (err) {
        if (waiting) await ctx.waits.cancel(msg.id, `Broadcast failed: ${(err as Error)?.message ?? String(err)}`);
        return {
          status: "error",
          data: null,
          message: `glove_mesh_broadcast failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }

      return {
        status: "success",
        data: {
          message_id: msg.id,
          blocking: input.blocking,
        },
      };
    },
  };
}
