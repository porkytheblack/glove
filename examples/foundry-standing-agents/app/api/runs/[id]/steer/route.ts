import { HttpError, foundry, handle, notFound, ownedRun, requirePerson } from "glove-foundry-web-kit/server";
import { teamOf } from "../../../../server/dot";
import { body, text } from "../../../../server/http";

/**
 * Redirect a run of the person's dot or builder: Foundry stops it and starts
 * again in the same conversation from the person's message.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const run = await ownedRun(person.id, (await params).id);
  const team = await teamOf(person.id);
  if (!team || (run.agentId !== team.dot.id && run.agentId !== team.builder?.id)) throw notFound();
  if (run.status !== "pending" && run.status !== "running") throw new HttpError(409, "That run has already finished.");
  const message = text((await body(request)).text, "What to do instead", 4_000);
  const steered = await foundry().steerRun(run.id, message);
  return Response.json({ runId: steered.run.id });
});
