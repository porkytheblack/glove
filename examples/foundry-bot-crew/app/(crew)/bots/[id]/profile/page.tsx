import Link from "next/link";
import { foundry, ownedAgent } from "glove-foundry-web-kit/server";
import { initials, personOf, routinesOf } from "../../../../server/crew";
import { host } from "../../../../server/host";
import { orNotFound, pagePerson } from "../../../../server/signed-in";
import { BotActions, ProfileForm } from "../../../../ui/Profile";

const RULES: Record<string, { readonly name: string; readonly base: string }> = {
  gmail: { name: "Gmail", base: "Reads run without asking. Sending email always asks." },
  linear: { name: "Linear", base: "Reads run without asking. Filing or changing an issue asks." },
};
const words = (tools: ReadonlyArray<string>) => tools.map((tool) => tool.replaceAll("_", " ")).join(", ");

export default async function Profile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await pagePerson();
  const bot = await orNotFound(ownedAgent(person.id, id));
  const { accounts, memoryOf, people } = await host();
  const [routines, entries, connected, notes] = await Promise.all([
    routinesOf(bot),
    foundry().workspaceEntries(person.id),
    accounts.accountsOf(person.id),
    memoryOf(person.id, bot.id).list().catch(() => []),
  ]);
  const owner = await personOf(person.id);
  const name = bot.name ?? "New bot";
  const starred = bot.context.starred === true;
  const skills = entries.filter((entry) => entry.key.startsWith("skill:")).map((entry) => (entry.value as { name: string }).name);
  const apps = bot.installations.filter((item) => item.kind === "application").map((item) => {
    const account = connected.find((candidate) => candidate.id === item.accountId);
    const config = (item.config ?? {}) as { alwaysAllow?: string[]; alwaysAsk?: string[] };
    const rules = RULES[item.id];
    return {
      id: item.id,
      title: `${rules?.name ?? item.id}${account ? ` · ${account.label ?? account.externalAccountId}` : ""}`,
      rules: [
        rules?.base ?? "Reads run without asking. Anything else asks.",
        config.alwaysAllow?.length ? `Always allow: ${words(config.alwaysAllow)}.` : "",
        config.alwaysAsk?.length ? `Always ask: ${words(config.alwaysAsk)}.` : "",
      ].filter(Boolean).join(" "),
    };
  });

  return (
    <main className="main tight">
      <Link href={`/bots/${bot.id}`} style={{ fontSize: 14, alignSelf: "flex-start", padding: "8px 0" }}>Back to the chat</Link>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span aria-hidden="true" className={bot.description ? "avatar" : "avatar empty"} style={{ width: 56, height: 56, borderRadius: 14, fontSize: 18 }}>{bot.description ? initials(name) : "?"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 600 }}>
              {name}{starred ? <span className="pill">Primary Bot</span> : null}
            </h1>
            <span className="muted" style={{ fontSize: 14 }}>
              {starred ? "Asks that name no bot come to it. Move the star to another bot any time." : `Star it to send it the asks that name no bot. ${owner.name} has one Primary Bot.`}
            </span>
          </div>
        </div>
        <BotActions botId={bot.id} starred={starred} />
      </div>

      <div className="cards wide">
        <section aria-labelledby="job" className="card" style={{ gap: 16 }}>
          <h2 id="job">Job and style</h2>
          <ProfileForm botId={bot.id} name={bot.name ?? ""} job={bot.description ?? ""} style={typeof bot.context.style === "string" ? bot.context.style : ""} />
        </section>

        <section aria-labelledby="routines" className="card" style={{ gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 id="routines">Routines</h2>
            <span className="muted" style={{ fontSize: 13 }}>{routines.length} of {people.MAX_ROUTINES}</span>
          </div>
          {routines.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {routines.map((routine, index) => (
                <li key={index} className="item">
                  <span className={routine.kind === "schedule" ? "when schedule" : "when"}>{routine.when}</span>
                  <span style={{ fontSize: 15, lineHeight: 1.45 }}>{routine.what}</span>
                </li>
              ))}
            </ul>
          ) : <p>No routines yet.</p>}
          <Link href={`/bots/${bot.id}?draft=${encodeURIComponent("New routine: every ")}`} title={`Tell ${name} when and what, in its chat`} className="button" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Add a routine</Link>
        </section>

        <section aria-labelledby="skills" className="card" style={{ gap: 14 }}>
          <h2 id="skills">Skills</h2>
          <p style={{ fontSize: 14 }}>Every bot shares the library. Type the name after a slash in any chat.</p>
          {skills.length > 0 ? (
            <div className="chips">{skills.map((skill) => <span key={skill}>/{skill}</span>)}</div>
          ) : <p style={{ fontSize: 14 }}>No skills yet. Show a bot a workflow and it saves one once you review it.</p>}
        </section>

        <section aria-labelledby="bot-apps" className="card" style={{ gap: 14 }}>
          <h2 id="bot-apps">Apps on this bot</h2>
          {apps.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {apps.map((app) => (
                <div key={app.id} className="item" style={{ gap: 6 }}>
                  <span style={{ fontSize: 15 }}>{app.title}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{app.rules}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 14 }}>No apps yet. Apps you connect go on every one of your bots.</p>}
          <Link href="/apps" style={{ fontSize: 14, alignSelf: "flex-start", padding: "8px 0" }}>Manage apps</Link>
        </section>

        <section aria-labelledby="memory" className="card" style={{ gap: 14 }}>
          <h2 id="memory">What it remembers</h2>
          {notes.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, fontSize: 15, lineHeight: 1.5 }}>
              {notes.map((note) => <li key={note.id}>{note.content}</li>)}
            </ul>
          ) : <p style={{ fontSize: 14 }}>Nothing yet. It keeps notes as it learns how you like things done.</p>}
          <span className="muted" style={{ fontSize: 13 }}>A copy of this bot starts with none of this.</span>
        </section>
      </div>
    </main>
  );
}
