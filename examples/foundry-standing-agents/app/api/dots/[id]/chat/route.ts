import { foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { appConversationOf, chatState, ownedDot } from "../../../../server/dot";
import { body, text } from "../../../../server/http";

type Context = { params: Promise<{ id: string }> };

/** The dot's app conversation: latest messages, pending approvals, the run in progress, its suggestion. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const person = await requirePerson();
  const team = await ownedDot(person.id, (await params).id);
  return Response.json(await chatState(person.id, team));
});

/** A message from the person to their dot, in the app. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const person = await requirePerson();
  const { dot } = await ownedDot(person.id, (await params).id);
  const message = text((await body(request)).text, "The message", 20_000);
  const run = await foundry().send(dot.id, await appConversationOf(dot), message);
  return Response.json({ runId: run.id });
});
