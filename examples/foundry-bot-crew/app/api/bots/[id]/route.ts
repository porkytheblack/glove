import { foundry, handle, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { body, text } from "../../../server/http";

/** Name, job and working style: a write to the bot's instance, keeping the rest of its data. */
export const PATCH = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const bot = await ownedAgent(person.id, (await params).id);
  const input = await body(request);
  const name = text(input.name, "The name", 40);
  const job = text(input.job, "The job", 300, { optional: true });
  const style = text(input.style, "The working style", 200, { optional: true });
  const { style: _style, ...context } = bot.context;
  await foundry().configureAgent(bot.id, {
    name,
    ...(job ? { description: job } : {}),
    context: style ? { ...context, style } : context,
  });
  return Response.json({ ok: true });
});
