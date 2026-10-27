import { HttpError, foundry, handle, notFound, ownedApproval, requirePerson } from "glove-foundry-web-kit/server";
import { body } from "../../../server/http";
import { museOf } from "../../../server/muse";

/** Yes or not now, on something the person's Muse asked. Nothing here is "always": sends, payments and sites ask each time. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const approval = await ownedApproval(person.id, (await params).id);
  if (approval.agentId !== (await museOf(person.id)).id) throw notFound();
  if (approval.status !== "pending") throw new HttpError(409, "This was already decided.");
  const decision = (await body(request)).decision;
  if (decision !== "approve" && decision !== "deny") throw new HttpError(400, "Decide approve or deny.");
  await foundry().resolveApproval(approval.id, decision);
  return Response.json({ ok: true });
});
