import { handle, notFound, requirePerson } from "glove-foundry-web-kit/server";
import { host } from "../../../server/host";
import { museOf } from "../../../server/muse";

/** Forget one thing it remembers: the same removal as glove_context_unset, in the person's own memory only. */
export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const muse = await museOf(person.id);
  const { forget } = await host();
  if (!(await forget(person.id, muse.id, (await params).id))) throw notFound();
  return Response.json({ ok: true });
});
