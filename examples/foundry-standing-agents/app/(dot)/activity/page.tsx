import { activityState, teamOf } from "../../server/dot";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { Activity } from "../../ui/Activity";
import { NoDot } from "../../ui/NoDot";

export default async function ActivityPage() {
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const [state, { PAUSE_AFTER }] = await Promise.all([activityState(person.id, team), host()]);
  return (
    <main className="main">
      <Activity dot={{ id: team.dot.id, name: team.dot.name ?? team.data.name }} pauseAfter={PAUSE_AFTER} initial={state} />
    </main>
  );
}
