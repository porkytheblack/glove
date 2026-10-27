import { HttpError, foundry, handle, requirePerson } from "glove-foundry-web-kit/server";
import { ownedDot } from "../../../../server/dot";
import { host } from "../../../../server/host";
import { body, text } from "../../../../server/http";

const MAX = 8;

/** Hand the dot a responsibility: a write to its data, keeping the rest. Its next research run covers it. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const { dot, data } = await ownedDot(person.id, (await params).id);
  if (data.responsibilities.length >= MAX) throw new HttpError(400, `A dot holds up to ${MAX} responsibilities.`);
  const input = await body(request);
  const sources = text(input.sources, "Where it looks", 300).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
  const parsed = (await host()).dots.Responsibility.safeParse({
    job: text(input.job, "The responsibility", 300),
    sources,
    attention: text(input.attention, "What deserves your attention", 300, { optional: true }),
    mustNot: text(input.mustNot, "What it must not do", 300, { optional: true }),
  });
  if (!parsed.success) throw new HttpError(400, "Say what it should look after and where it looks.");
  await foundry().configureAgent(dot.id, { context: { ...dot.context, responsibilities: [...data.responsibilities, parsed.data] } });
  return Response.json({ ok: true });
});
