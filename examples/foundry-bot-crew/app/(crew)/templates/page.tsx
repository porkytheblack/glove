import { foundry } from "glove-foundry-web-kit/server";
import type { BotTemplate } from "../../../lib/templates";
import { whenOf } from "../../server/crew";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { NewBot } from "../../ui/NewBot";

const APP_NAMES: Record<string, string> = { gmail: "Gmail", linear: "Linear" };
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What a template brings, as tags: its apps, routines and skills. */
function tags(template: BotTemplate): string[] {
  return [
    ...template.apps.map((app) => APP_NAMES[app.app] ?? app.app),
    ...(template.routines.length > 0 ? [count(template.routines.length, "routine")] : []),
    ...template.schedules.map((schedule) => whenOf(schedule.timing)),
    ...(template.skills.length > 0 ? [count(template.skills.length, "skill")] : []),
  ];
}

/** "Job, style, 1 routine, Gmail". */
function contents(template: BotTemplate): string {
  const routines = template.routines.length + template.schedules.length;
  return [
    template.job ? "Job" : "",
    template.style ? "style" : "",
    routines > 0 ? count(routines, "routine") : "",
    template.skills.length > 0 ? count(template.skills.length, "skill") : "",
    template.memories.length > 0 ? `${template.memories.length} picked ${template.memories.length === 1 ? "memory" : "memories"}` : "",
    ...template.apps.map((app) => APP_NAMES[app.app] ?? app.app),
  ].filter(Boolean).join(", ").replace(/^./, (first) => first.toUpperCase());
}

export default async function Templates() {
  const person = await pagePerson();
  const [{ templates }, entries] = await Promise.all([host(), foundry().workspaceEntries(person.id)]);
  const saved = entries.filter((entry) => entry.key.startsWith("template:")).map((entry) => ({
    key: entry.key,
    template: entry.value as BotTemplate & { savedAt?: string },
  }));
  return (
    <main className="main">
      <div className="intro">
        <h1>New bot</h1>
        <p>Start blank and the bot asks what it&apos;s for, or start from a template. A template brings a job, skills, routines and which apps it uses. It never brings chats, accounts or keys: you connect your own.</p>
      </div>

      <div className="cards">
        <article className="card dashed">
          <h2>Blank bot</h2>
          <p style={{ flex: 1 }}>It asks what you want it around for, then names itself for the job.</p>
          <NewBot request={{ from: "blank" }} label="Make a blank bot" />
        </article>
        {templates.MARKETPLACE.map((template, index) => (
          <article key={template.name} className="card">
            <h2>{template.name}</h2>
            <p>{template.job}</p>
            <ul className="tags">{tags(template).map((tag) => <li key={tag}>{tag}</li>)}</ul>
            <NewBot request={{ marketplace: index }} label="Use this template" primary />
          </article>
        ))}
      </div>

      <section aria-labelledby="yours" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="yours" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Your templates</h2>
        {saved.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 15 }}>None yet. Save one from a bot&apos;s profile.</p> : null}
        {saved.map(({ key, template }) => (
          <div key={key} className="row-card">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 15 }}>
                {template.name}{template.savedAt ? `, saved ${new Date(template.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>{contents(template)}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <NewBot request={{ saved: key }} label="Use" />
              <a className="button" href={`/api/templates/${encodeURIComponent(key)}`} download style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Download</a>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
