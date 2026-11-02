import { handle, requirePerson } from "glove-foundry-web-kit/server";
import { groupState, ownedGroup } from "../../../server/group";
import { chats, host } from "../../../server/host";
import { body, text } from "../../../server/http";

type Context = { params: Promise<{ id: string }> };

/** The group as one thread, its members, approvals and the answers still coming. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const person = await requirePerson();
  return Response.json(await groupState(person.id, (await params).id));
});

/** The person's message: each bot it @-mentions answers, or every member (postToGroup). */
export const POST = handle(async (request: Request, { params }: Context) => {
  const person = await requirePerson();
  const { group } = await ownedGroup(person.id, (await params).id);
  const message = text((await body(request)).text, "The message", 20_000);
  const runs = await (await host()).groups.postToGroup(await chats(), group, message);
  return Response.json({ runs });
});
