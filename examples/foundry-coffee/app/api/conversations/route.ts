import { SHOP } from "../../../lib/shop";
import { foundry, unavailable } from "../../lib/server/foundry";

/** A new customer: a conversation on the shop's barista. */
export async function POST(): Promise<Response> {
  try {
    const conversation = await foundry().createConversation(SHOP.agentId, { title: "Counter" });
    return Response.json({ conversationId: conversation.id });
  } catch (error) {
    return unavailable(error);
  }
}
