import { SHOP } from "../../../../lib/shop";
import { foundry, unavailable } from "../../../lib/server/foundry";

/** The customer's answer to a checkout: confirm or decline. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { decision } = (await request.json()) as { decision?: string };
  if (decision !== "approve" && decision !== "deny") {
    return Response.json({ error: 'decision must be "approve" or "deny".' }, { status: 400 });
  }
  try {
    const approval = await foundry().approval(id);
    if (approval.workspaceId !== SHOP.workspaceId) return Response.json({ error: "Not found." }, { status: 404 });
    await foundry().resolveApproval(id, decision);
    return Response.json({ ok: true });
  } catch (error) {
    return unavailable(error);
  }
}
