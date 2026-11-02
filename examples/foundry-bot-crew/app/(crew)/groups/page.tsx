import { redirect } from "next/navigation";
import { crewOf } from "../../server/crew";
import { pagePerson } from "../../server/signed-in";
import { GroupList } from "../../ui/GroupList";
import { NewGroup } from "../../ui/NewGroup";

export default async function Groups({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const person = await pagePerson();
  const { bots, groups } = await crewOf(person.id);
  if (groups.length > 0 && !(await searchParams).new) redirect(`/groups/${groups[0]!.id}`);
  return (
    <div className="split">
      <GroupList groups={groups} />
      <section aria-label="New group chat" className="chat group">
        <div className="chat-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1>New group chat</h1>
            <span className="sub">Pick 2 to 6 bots. Bots answer when you mention them, or all of them when you mention nobody.</span>
          </div>
        </div>
        <div className="chat-scroll">
          <div className="chat-body">
            <NewGroup bots={bots.filter((bot) => bot.job).map((bot) => ({ id: bot.id, name: bot.name, initials: bot.initials }))} />
          </div>
        </div>
      </section>
    </div>
  );
}
