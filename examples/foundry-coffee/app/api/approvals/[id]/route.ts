import { sameBag, type Bag } from "../../../../lib/bag";
import { SHOP } from "../../../../lib/shop";
import { foundry, unavailable } from "../../../lib/server/foundry";
import { visitOf } from "../../../lib/server/visit";

/**
 * The customer's answer to a checkout: confirm or decline. A confirmation
 * carries the bag they were shown (`seen`); if the stored bag is not exactly
 * that, line for line, nothing is approved and they are asked to look again.
 * So a card drawn from a stale or failed refresh cannot place an order.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { decision, seen } = (await request.json()) as { decision?: string; seen?: Bag };
  if (decision !== "approve" && decision !== "deny") {
    return Response.json({ error: 'decision must be "approve" or "deny".' }, { status: 400 });
  }
  try {
    const approval = await foundry().approval(id);
    if (approval.workspaceId !== SHOP.workspaceId) return Response.json({ error: "Not found." }, { status: 404 });
    if (decision === "approve") {
      // The run is paused on this approval, so the bag read here is the bag
      // checkout will order.
      const bag = (await visitOf(approval.conversationId)).bag;
      if (!Array.isArray(seen?.lines) || !sameBag(seen, bag)) {
        return Response.json({ error: "Your bag changed. Check the order and confirm again." }, { status: 409 });
      }
    }
    await foundry().resolveApproval(id, decision);
    return Response.json({ ok: true });
  } catch (error) {
    return unavailable(error);
  }
}
