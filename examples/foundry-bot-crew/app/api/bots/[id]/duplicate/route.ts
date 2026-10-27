import { HttpError, foundry, handle, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { chatOf } from "../../../../server/chat";
import { nextBotId, personOf } from "../../../../server/crew";
import { host, writes } from "../../../../server/host";

/** A copy with the job, style, routines and apps, and none of the memory or chats (duplicateBot). */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await personOf((await requirePerson()).id);
  const bot = await ownedAgent(person.id, (await params).id);
  const id = nextBotId(person.id, await foundry().agentInstances());
  try {
    const copy = await (await host()).templates.duplicateBot(await writes(), person, bot.id, id);
    await chatOf(copy);
    return Response.json({ id: copy.id });
  } catch (error) {
    if (error instanceof Error && /bots, the most/.test(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
});
