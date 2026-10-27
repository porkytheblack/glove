import { HttpError, handle, ownedAgents, requirePerson } from "glove-foundry-web-kit/server";
import { groupsOf } from "../../server/crew";
import { groupIdFor, membersFrom } from "../../server/group";
import { chats, host } from "../../server/host";
import { body, text } from "../../server/http";

/** A new group chat of 2–6 of the person's bots (openGroup). */
export const POST = handle(async (request: Request) => {
  const person = await requirePerson();
  const input = await body(request);
  const name = text(input.name, "The name", 60);
  const team = await ownedAgents(person.id, "bot");
  const members = membersFrom(team, input.members);
  if (members.length < 2 || members.length > 6) throw new HttpError(400, "Pick 2 to 6 bots.");
  const id = groupIdFor(name, await groupsOf(team));
  await (await host()).groups.openGroup(await chats(), { id, name, members });
  return Response.json({ id });
});
