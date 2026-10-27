import { handle, requirePerson } from "glove-foundry-web-kit/server";
import { activityState, ownedDot } from "../../../../server/dot";

/** What the dot and its builder are doing, what waits on the person, follow-ups and files. */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const team = await ownedDot(person.id, (await params).id);
  return Response.json(await activityState(person.id, team));
});
