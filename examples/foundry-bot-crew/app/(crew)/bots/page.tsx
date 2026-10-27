import { crewOf } from "../../server/crew";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { Ask } from "../../ui/Ask";
import { Sidebar } from "../../ui/Sidebar";

export default async function Bots() {
  const person = await pagePerson();
  const [{ bots, groups }, { people }] = await Promise.all([crewOf(person.id), host()]);
  const primary = bots.find((bot) => bot.starred);
  return (
    <div className="split">
      <Sidebar bots={bots} groups={groups} max={people.MAX_BOTS} />
      <section aria-label="Ask" className="chat">
        <div className="chat-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1>Ask</h1>
            <span className="sub">
              {primary ? `An ask that names no bot goes to ${primary.name}, your Primary Bot. It does its part and hands each sibling theirs.` : "Star a bot to send it the asks that name no bot."}
            </span>
          </div>
        </div>
        <div className="chat-scroll"><div className="chat-body" /></div>
        <div className="chat-foot">
          <Ask disabled={!primary} />
        </div>
      </section>
    </div>
  );
}
