import z from "zod";
import type { GloveFoldArgs, ToolResultData } from "glove-core";
import type { MeshMessage } from "../core/types";
import {
  generateMessageId,
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
      "If true, you cannot proceed until the recipient acknowledges or replies. The ack or reply is delivered to you automatically.",
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
      "the ack or reply is delivered to you automatically. " +
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

      let waiting = false;
      if (input.blocking) {
        const peerName = await peerNameOrId(ctx.adapter, input.to);
        try {
          await ctx.waits.begin(
            msg.id,
            `Waiting for response from "${peerName}" (${input.to}) to message ${msg.id}`,
            msg.created_at,
          );
          waiting = true;
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
        if (waiting) await ctx.waits.cancel(msg.id, `Send failed: ${(err as Error)?.message ?? String(err)}`);
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
