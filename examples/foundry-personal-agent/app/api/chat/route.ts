import { foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { body, text } from "../../server/http";
import { chatState, conversationOf, museOf } from "../../server/muse";

export const dynamic = "force-dynamic";

/** The app conversation: latest messages, what waits for a yes, the run in progress. */
export const GET = handle(async () => {
  const person = await requirePerson();
  return Response.json(await chatState(person.id));
});

/** A message from the person to their Muse, in the app conversation. */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const muse = await museOf(person.id);
  const message = text((await body(request)).text, "The message", 20_000);
  const run = await foundry().send(muse.id, await conversationOf(muse, "app"), message);
  return Response.json({ runId: run.id });
});
