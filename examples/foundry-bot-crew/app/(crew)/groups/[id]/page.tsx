import { crewOf } from "../../../server/crew";
import { groupState } from "../../../server/group";
import { orNotFound, pagePerson } from "../../../server/signed-in";
import { GroupChat } from "../../../ui/GroupChat";
import { GroupList } from "../../../ui/GroupList";

export default async function Group({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await pagePerson();
  const state = await orNotFound(groupState(person.id, id));
  const { bots, groups } = await crewOf(person.id);
  const others = bots.filter((bot) => bot.job && !state.group.members.includes(bot.id)).map((bot) => ({ id: bot.id, name: bot.name }));
  return (
    <div className="split">
      <GroupList groups={groups} current={id} />
      <GroupChat initial={state} others={others} />
    </div>
  );
}
