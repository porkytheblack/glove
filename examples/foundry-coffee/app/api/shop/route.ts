import { EMPTY_BAG, bagKey, ordersKey, type Bag, type Order } from "../../../lib/bag";
import { SHOP } from "../../../lib/shop";
import { foundry, unavailable } from "../../lib/server/foundry";

export const dynamic = "force-dynamic";

/** A conversation's bag and orders, read from the shop's workspace. */
export async function GET(request: Request): Promise<Response> {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return Response.json({ error: "conversationId is required." }, { status: 400 });
  try {
    const entries = await foundry().workspaceEntries(SHOP.workspaceId);
    const value = <T,>(key: string) => entries.find((entry) => entry.key === key)?.value as T | undefined;
    return Response.json({
      bag: value<Bag>(bagKey(conversationId)) ?? EMPTY_BAG,
      orders: value<Order[]>(ordersKey(conversationId)) ?? [],
    });
  } catch (error) {
    return unavailable(error);
  }
}
