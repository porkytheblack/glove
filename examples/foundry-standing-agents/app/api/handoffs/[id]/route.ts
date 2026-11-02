import { handle, notFound, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { host } from "../../../server/host";

/** Mark something the dot handed to the person as done. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const { handoffs } = await host();
  const handOff = await handoffs.handOffById((await params).id);
  if (!handOff || handOff.workspaceId !== person.id) throw notFound();
  await ownedAgent(person.id, handOff.agentId);
  await handoffs.markDone(handOff.id);
  return Response.json({ ok: true });
});
