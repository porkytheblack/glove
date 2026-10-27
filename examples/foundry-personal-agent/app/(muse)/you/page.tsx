import Link from "next/link";
import { connectionsState, memoriesOf, museOf, personaOf } from "../../server/muse";
import { orNotFound, pagePerson } from "../../server/signed-in";
import { MemoryList, PersonaForm } from "../../ui/You";

export default async function YouPage() {
  const person = await pagePerson();
  const muse = await orNotFound(museOf(person.id));
  const persona = personaOf(muse);
  const [memories, connections] = await Promise.all([memoriesOf(person.id, muse), connectionsState(person.id, muse)]);
  const apps = connections.apps.filter((app) => app.access).length + (connections.whatsapp ? 1 : 0);
  const sites = connections.sites.length;
  return (
    <>
      <header className="head">
        <h1>You</h1>
        <span className="sub">How your agent looks, talks, and what it remembers.</span>
      </header>
      <main className="main tight">
        <PersonaForm name={persona.name} avatar={persona.avatar} style={persona.style} />
        <MemoryList name={persona.name} memories={memories} />
        <Link href="/you/connections" className="row-link">
          Connections<span>{apps} {apps === 1 ? "app" : "apps"}, {sites} {sites === 1 ? "site" : "sites"}</span>
        </Link>
        <form method="post" action="/signout" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 4px" }}>
          <span className="status">Signed in as {persona.person}</span>
          <button type="submit" className="linkish">Sign out</button>
        </form>
      </main>
    </>
  );
}
