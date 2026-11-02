import { handle, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { host, writes } from "../../../../server/host";

/** Move the star to this bot: it becomes the Primary Bot (starBot). */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const bot = await ownedAgent(person.id, (await params).id);
  await (await host()).people.starBot(await writes(), person, bot.id);
  return Response.json({ ok: true });
});
