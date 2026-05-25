import z from "zod";
import type { GloveFoldArgs, ToolResultData, InboxItem } from "glove-core";
import type { MeshMessage } from "../core/types";
import {
  generateMessageId,
  generateInboxItemId,
  nowIso,
  peerNameOrId,
  type ToolContext,
} from "./common";

const SendSchema = z.object({
  to: z
    .string()
    .min(1)
    .describe(
      "Recipient agent id on the mesh network. Use glove_mesh_list_agents to find ids.",
    ),
  content: z.string().min(1).describe("Message body."),
  in_reply_to: z
    .string()
    .optional()
    .describe(
      "Optional: message id this is in reply to. The original sender will be unblocked if they were waiting on it.",
    ),
  blocking: z
    .boolean()
    .default(false)
    .describe(
      "If true, you cannot proceed until the recipient acknowledges or replies. The resolution will appear in your inbox.",
    ),
});

type SendInput = z.infer<typeof SendSchema>;

export function buildMeshSendTool(ctx: ToolContext): GloveFoldArgs<SendInput> {
  return {
    name: "glove_mesh_send_message",
    description:
      "Send a private message to another agent on the mesh network. " +
      "Use glove_mesh_list_agents first to find recipient ids. " +
      "Set blocking=true to wait for the recipient to acknowledge or reply before continuing — " +
      "the result will be delivered into your inbox automatically. " +
      "Set in_reply_to to thread a reply to a previous message (the original sender is unblocked automatically).",
    inputSchema: SendSchema,
    async do(input: SendInput): Promise<ToolResultData> {
      const msg: MeshMessage = {
        id: generateMessageId(ctx.identity.id),
        from: ctx.identity.id,
        to: input.to,
        content: input.content,
        in_reply_to: input.in_reply_to,
        blocking: input.blocking,
        created_at: nowIso(),
      };

      let pendingInboxId: string | null = null;
      if (input.blocking) {
        const peerName = await peerNameOrId(ctx.adapter, input.to);
        const item: InboxItem = {
          id: generateInboxItemId(),
          tag: `mesh:waiting:${msg.id}`,
          request: `Waiting for response from "${peerName}" (${input.to}) to message ${msg.id}`,
          response: null,
          status: "pending",
          blocking: true,
          created_at: msg.created_at,
          resolved_at: null,
        };
        try {
          await ctx.store.addInboxItem(item);
          pendingInboxId = item.id;
          ctx.pending.set(msg.id, item.id);
        } catch (err) {
          return {
            status: "error",
            data: null,
            message: `glove_mesh_send_message failed to record pending blocking item for ${msg.id} (to=${input.to}): ${(err as Error)?.message ?? String(err)}`,
          };
        }
      }

      try {
        await ctx.adapter.send(msg);
      } catch (err) {
        if (pendingInboxId) {
          // Roll back the pending entry no matter what — even if the inbox
          // update fails, the in-memory pending map must not leak.
          try {
            await ctx.store.updateInboxItem(pendingInboxId, {
              status: "consumed",
              response: `Send failed: ${(err as Error)?.message ?? String(err)}`,
              resolved_at: nowIso(),
            });
          } catch (rollbackErr) {
            // eslint-disable-next-line no-console
            console.warn(
              `[glove-mesh] failed to roll back pending inbox item ${pendingInboxId}:`,
              rollbackErr,
            );
          } finally {
            ctx.pending.delete(msg.id);
          }
        }
        return {
          status: "error",
          data: null,
          message: `glove_mesh_send_message failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }

      return {
        status: "success",
        data: {
          message_id: msg.id,
          to: input.to,
          blocking: input.blocking,
        },
      };
    },
  };
}
