import z from "zod";
import type { GloveFoldArgs, ToolResultData, InboxItem } from "glove-core";
import type { MeshMessage } from "../core/types";
import {
  generateMessageId,
  generateInboxItemId,
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
      "If true, wait for at least one acknowledgement before continuing. The first ack received resolves the wait; later acks arrive as ordinary inbox items.",
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
      "Acknowledgements and replies are surfaced in your inbox.",
    inputSchema: BroadcastSchema,
    async do(input: BroadcastInput): Promise<ToolResultData> {
      const msg: Omit<MeshMessage, "to"> = {
        id: generateMessageId(ctx.identity.id),
        from: ctx.identity.id,
        content: input.content,
        blocking: input.blocking,
        created_at: nowIso(),
      };

      let pendingInboxId: string | null = null;
      if (input.blocking) {
        const item: InboxItem = {
          id: generateInboxItemId(),
          tag: `mesh:waiting:${msg.id}`,
          request: `Broadcast ${msg.id}: waiting for at least one acknowledgement`,
          response: null,
          status: "pending",
          blocking: true,
          created_at: msg.created_at,
          resolved_at: null,
        };
        await ctx.store.addInboxItem(item);
        pendingInboxId = item.id;
        ctx.pending.set(msg.id, item.id);
      }

      try {
        await ctx.adapter.broadcast(msg);
      } catch (err) {
        if (pendingInboxId) {
          await ctx.store.updateInboxItem(pendingInboxId, {
            status: "consumed",
            response: `Broadcast failed: ${(err as Error)?.message ?? String(err)}`,
            resolved_at: nowIso(),
          });
          ctx.pending.delete(msg.id);
        }
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
