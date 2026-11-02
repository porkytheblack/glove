import { HttpError, handle, ownedAgents, requirePerson } from "glove-foundry-web-kit/server";
import { chatOf } from "../../server/chat";
import { chats, host } from "../../server/host";
import { body, text } from "../../server/http";

/** An ask that names no bot: askPrimary sends it to the starred bot's chat. */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const message = text((await body(request)).text, "The message", 20_000);
  const { groups, people } = await host();
  const primary = people.primaryOf(await ownedAgents(person.id, "bot"), person.id);
  if (!primary) throw new HttpError(409, "Star one of your bots first: it takes the asks that name no bot.");
  await chatOf(primary);
  return Response.json(await groups.askPrimary(await chats(), person.id, message));
});
