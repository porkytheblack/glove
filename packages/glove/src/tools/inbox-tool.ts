import z from "zod";
import type { Tool, Context, InboxItem, ToolResultData } from "../core";

const PostToInboxSchema = z.object({
  tag: z.string().min(1).describe("Category label for this inbox item, e.g. 'restock_monitor'"),
  request: z.string().min(1).describe("Natural language description of what needs to happen or be monitored"),
  blocking: z.boolean().default(false).describe("If true, you cannot continue until this item is resolved"),
});

type PostToInboxInput = z.infer<typeof PostToInboxSchema>;

export function createInboxTool(context: Context): Tool<PostToInboxInput> {
  return {
    name: "glove_post_to_inbox",
    description:
      `Post an async request to the inbox. Use this when something cannot be resolved now ` +
      `but will be resolved later by an external service (e.g., inventory restock, payment confirmation, ` +
      `background job completion). Set blocking=true if you cannot proceed without the result. ` +
      `Set blocking=false if the result can arrive later and you can continue working.\n\n` +
      `The inbox item will be automatically checked each time the conversation continues. ` +
      `When it is resolved, the result will be provided to you as a tool result.`,
    input_schema: PostToInboxSchema,
    async run(input: PostToInboxInput): Promise<ToolResultData> {
      const item: InboxItem = {
        id: `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tag: input.tag,
        request: input.request,
        response: null,
        status: "pending",
        blocking: input.blocking,
        created_at: new Date().toISOString(),
        resolved_at: null,
      };

      await context.addInboxItem(item);

      return {
        status: "success",
        data: {
          inbox_item_id: item.id,
          message: `Inbox item created. ${input.blocking ? "This is blocking — you must wait for resolution." : "This is non-blocking — you may continue."}`,
        },
      };
    },
  };
}
