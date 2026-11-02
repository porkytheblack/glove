import { chatState, teamOf } from "../server/dot";
import { host } from "../server/host";
import { pagePerson } from "../server/signed-in";
import { Home } from "../ui/Home";
import { NoDot } from "../ui/NoDot";

export default async function DotHome() {
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const [state, { dots, ids }] = await Promise.all([chatState(person.id, team), host()]);
  const { data, dot } = team;
  const name = dot.name ?? data.name;
  const slack = Boolean(data.slackUserId && dot.installations.some((item) => item.kind === "application" && item.id === ids.slackApp));
  const place = (channel: "app" | "slack") => (channel === "app" ? "here" : "to Slack");
  return (
    <Home
      about={{
        id: dot.id,
        name,
        handle: dots.handleOf(name),
        owner: data.owner,
        responsibilities: data.responsibilities.map(({ job, sources, attention, mustNot }) => ({ job, sources, attention, mustNot })),
        where: slack
          ? `Here, in Slack DMs and mentions, and on a call. Same ${name}, same notes.`
          : `Here and on a call. Same ${name}, same notes. Slack isn't connected yet.`,
        routing: `Progress comes ${place(data.routing.progress)}. Decisions go ${place(data.routing.decisions)}.`,
      }}
      initial={state}
    />
  );
}
