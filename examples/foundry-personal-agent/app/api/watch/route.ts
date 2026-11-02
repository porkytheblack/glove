import { handle, requirePerson } from "glove-foundry-web-kit/server";
import { watchState } from "../../server/muse";

export const dynamic = "force-dynamic";

/** Its browser, for the Watch screen: the view-only live view, the page, and whether a hand-off waits. */
export const GET = handle(async () => {
  const person = await requirePerson();
  return Response.json(await watchState(person.id));
});
