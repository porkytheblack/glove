import { foundry, handle, ownedAgent, requirePerson } from "glove-foundry-web-kit/server";
import { host, writes } from "../../../../server/host";

/**
 * Save the bot as one of the person's templates (templateOf), with the skills
 * its routines run. It carries no chats, accounts or keys, and no memories:
 * there is no picker for them here.
 */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const person = await requirePerson();
  const bot = await ownedAgent(person.id, (await params).id);
  const { skillKey, templates } = await host();
  const named = ((bot.context.routines ?? []) as Array<{ skill?: string }>).flatMap((routine) => routine.skill ? [skillKey(routine.skill)] : []);
  const skills = (await foundry().workspaceEntries(person.id)).filter((entry) => named.includes(entry.key)).map((entry) => entry.value as never);
  const template = await templates.templateOf(await writes(), bot, { skills });
  const key = `template:${bot.id}`;
  await foundry().putWorkspaceEntry(person.id, key, { ...template, savedAt: new Date().toISOString() });
  return Response.json({ name: template.name, key });
});
