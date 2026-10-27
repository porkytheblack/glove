import { HttpError, foundry, handle, ownedApproval, requirePerson } from "glove-foundry-web-kit/server";
import { body } from "../../../server/http";

/** Approve or deny one of the person's pending approvals. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const approval = await ownedApproval(person.id, (await params).id);
  if (approval.status !== "pending") throw new HttpError(409, "This was already decided.");
  const decision = (await body(request)).decision;
  if (decision !== "approve" && decision !== "deny") throw new HttpError(400, "Decide approve or deny.");
  await foundry().resolveApproval(approval.id, decision);
  return Response.json({ ok: true });
});
