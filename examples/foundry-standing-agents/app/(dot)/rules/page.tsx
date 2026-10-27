import { teamOf } from "../../server/dot";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { NoDot } from "../../ui/NoDot";
import { Rules } from "../../ui/Rules";

export default async function RulesPage() {
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const { ACTION_NAMES, dots, review } = await host();
  const builtIn = (name: string) => review.ALWAYS_YOURS.has(name) || review.ALWAYS_ASKS.has(name);
  return (
    <main className="main">
      <Rules
        dot={{ id: team.dot.id, name: team.dot.name ?? team.data.name }}
        levels={dots.LEVELS.map((level) => ({ level, label: review.LEVEL_LABELS[level] }))}
        rules={ACTION_NAMES.filter((name) => !builtIn(name)).map((name) => ({ action: name, level: team.data.rules[name] ?? "ask" }))}
        safety={[
          ...[...review.ALWAYS_YOURS].map((action) => ({ action, label: "Always yours to do" })),
          ...[...review.ALWAYS_ASKS].map((action) => ({ action, label: "Always asks first" })),
        ]}
      />
    </main>
  );
}
