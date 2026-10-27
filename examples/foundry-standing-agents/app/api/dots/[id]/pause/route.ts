import { HttpError, foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { ownedDot } from "../../../../server/dot";
import { body } from "../../../../server/http";

/** Pause or resume the dot. Paused, every run only reads. Pausing doesn't undo anything. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const { dot } = await ownedDot(person.id, (await params).id);
  const paused = (await body(request)).paused;
  if (typeof paused !== "boolean") throw new HttpError(400, "Say paused: true or false.");
  await foundry().configureAgent(dot.id, { context: { ...dot.context, paused } });
  return Response.json({ ok: true, paused });
});
