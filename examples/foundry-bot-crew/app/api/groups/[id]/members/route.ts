import { HttpError, foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { membersFrom, ownedGroup } from "../../../../server/group";
import { chats, host } from "../../../../server/host";
import { body } from "../../../../server/http";

/**
 * Add one of the person's bots to the group. Opening the group again with the
 * new member list (openGroup) gives the bot its conversation for the group;
 * the members already in it get the new list in theirs.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const { group, team } = await ownedGroup(person.id, (await params).id);
  const [botId] = membersFrom(team, [(await body(request)).botId]);
  if (!botId) throw new HttpError(404, "Not found.");
  if (group.members.includes(botId)) return Response.json({ ok: true });
  if (group.members.length >= 6) throw new HttpError(409, "A group chat has at most 6 bots.");
  const client = foundry();
  const base = await chats();
  await (await host()).groups.openGroup({
    ...base,
    createConversation: async (agentId, options) => {
      const existing = (await client.conversations(agentId)).find((item) => item.id === options.id);
      return existing ? client.updateConversation(agentId, existing.id, { context: options.context ?? {} }) : base.createConversation(agentId, options);
    },
  }, { ...group, members: [...group.members, botId] });
  return Response.json({ ok: true });
});
