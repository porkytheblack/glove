import type { AgentInstance } from "glove-foundry";
import { HttpError, foundry, handle, ownedAgents, requirePerson } from "glove-foundry-web-kit/server";
import type { BotTemplate } from "../../../lib/templates";
import { chatOf } from "../../server/chat";
import { nextBotId, personOf } from "../../server/crew";
import { host, writes } from "../../server/host";
import { body } from "../../server/http";

/**
 * A new bot for the person: blank (makeBot; it asks what it's for), from the
 * marketplace, or from one of their saved templates (fromTemplate). Their
 * first bot is starred.
 */
export const POST = handle(async (request: Request) => {
  const person = await personOf((await requirePerson()).id);
  const input = await body(request);
  const { connect, templates } = await host();
  const team = await ownedAgents(person.id, "bot");
  const id = nextBotId(person.id, await foundry().agentInstances());
  const first = team.length === 0;

  let template: BotTemplate | undefined;
  if (typeof input.marketplace === "number") {
    template = templates.MARKETPLACE[input.marketplace];
    if (!template) throw new HttpError(404, "Not found.");
  } else if (typeof input.saved === "string") {
    const entry = (await foundry().workspaceEntries(person.id)).find((item) => item.key === input.saved && item.key.startsWith("template:"));
    if (!entry) throw new HttpError(404, "Not found.");
    template = entry.value as BotTemplate;
  } else if (input.from !== "blank") {
    throw new HttpError(400, "Start blank or from a template.");
  }

  let bot: AgentInstance;
  try {
    bot = template
      ? await templates.fromTemplate(await writes(), person, template, id)
      : await connect.makeBot(await writes(), person, { id, ...(first ? { starred: true } : {}) });
  } catch (error) {
    if (error instanceof Error && /bots, the most/.test(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
  if (template && first) await (await host()).people.starBot(await writes(), person, bot.id);
  await chatOf(bot);
  return Response.json({ id: bot.id });
});
