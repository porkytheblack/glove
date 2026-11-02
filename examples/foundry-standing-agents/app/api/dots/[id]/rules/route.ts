import { HttpError, foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { ownedDot } from "../../../../server/dot";
import { host } from "../../../../server/host";
import { body } from "../../../../server/http";

/**
 * One Custom Rule: a write to the dot's data, keeping the rest of it. Built-in
 * safety (always yours, always asks) isn't a rule the person can set.
 */
export const PUT = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const { dot, data } = await ownedDot(person.id, (await params).id);
  const { ACTION_NAMES, dots, review } = await host();
  const input = await body(request);
  const action = String(input.action ?? "");
  const level = String(input.level ?? "");
  if (!(ACTION_NAMES as ReadonlyArray<string>).includes(action) || review.ALWAYS_YOURS.has(action) || review.ALWAYS_ASKS.has(action)) {
    throw new HttpError(400, "That action has no rule you can set.");
  }
  if (!(dots.LEVELS as ReadonlyArray<string>).includes(level)) throw new HttpError(400, "Pick one of the four settings.");
  await foundry().configureAgent(dot.id, { context: { ...dot.context, rules: { ...data.rules, [action]: level } } });
  return Response.json({ ok: true });
});
