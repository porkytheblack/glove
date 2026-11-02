import { ownedAgent } from "glove-foundry-web-kit/server";
import { chatState } from "../../../server/chat";
import { crewOf } from "../../../server/crew";
import { host } from "../../../server/host";
import { orNotFound, pagePerson } from "../../../server/signed-in";
import { Chat } from "../../../ui/Chat";
import { Sidebar } from "../../../ui/Sidebar";

export default async function BotChat({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const { id } = await params;
  const { draft } = await searchParams;
  const person = await pagePerson();
  const bot = await orNotFound(ownedAgent(person.id, id));
  const [{ bots, groups }, state, { people }] = await Promise.all([crewOf(person.id), chatState(person.id, bot.id), host()]);
  const summary = bots.find((item) => item.id === bot.id)!;
  return (
    <div className="split">
      <Sidebar bots={bots} groups={groups} current={bot.id} max={people.MAX_BOTS} />
      <Chat
        bot={{ id: bot.id, name: summary.name, starred: summary.starred, ...(summary.job ? { job: summary.job } : {}) }}
        initial={state}
        {...(typeof draft === "string" ? { draft: draft.slice(0, 500) } : {})}
      />
    </div>
  );
}
