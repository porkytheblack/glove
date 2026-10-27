import { foundry, handle, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { chatOf, chatState } from "../../../../server/chat";
import { body, text } from "../../../../server/http";

type Context = { params: Promise<{ id: string }> };

/** The bot's chat: latest messages, pending approvals, the run in progress. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const person = await requirePerson();
  return Response.json(await chatState(person.id, (await params).id));
});

/** A message from the person to the bot, in its own chat. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const person = await requirePerson();
  const bot = await ownedAgent(person.id, (await params).id);
  const message = text((await body(request)).text, "The message", 20_000);
  const run = await foundry().send(bot.id, await chatOf(bot), message);
  return Response.json({ runId: run.id });
});
