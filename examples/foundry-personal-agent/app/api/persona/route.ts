import { HttpError, foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { isAvatar } from "../../ui/look";
import { body, text } from "../../server/http";
import { museOf } from "../../server/muse";

/**
 * Its name, look and way of talking: a write to the person's Muse, keeping
 * the rest of its data. The instance is read just before, so the write
 * carries what runs changed since (its browser, the Sentinel's lists).
 */
export const PATCH = handle(async (request: Request) => {
  const person = await requirePerson();
  const input = await body(request);
  const name = text(input.name, "The name", 40);
  const style = text(input.style, "How it talks", 200, { optional: true });
  if (!isAvatar(input.avatar)) throw new HttpError(400, "Pick one of the colours.");
  const muse = await museOf(person.id);
  const { style: _style, ...persona } = (muse.context.persona ?? {}) as Record<string, unknown>;
  await foundry().configureAgent(muse.id, {
    name,
    context: { ...muse.context, persona: { ...persona, avatar: input.avatar, ...(style ? { style } : {}) } },
  });
  return Response.json({ ok: true });
});
