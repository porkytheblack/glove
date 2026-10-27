import Link from "next/link";
import { connectionsState, museOf, personaOf } from "../../../server/muse";
import { orNotFound, pagePerson } from "../../../server/signed-in";
import { AccessControl } from "../../../ui/Connections";

const SITE_ACCESS = { send: "Read · Send", read: "Read", blocked: "Blocked" } as const;

export default async function ConnectionsPage() {
  const person = await pagePerson();
  const muse = await orNotFound(museOf(person.id));
  const name = personaOf(muse).name;
  const { apps, whatsapp, sites } = await connectionsState(person.id, muse);
  return (
    <>
      <header className="head back">
        <Link href="/you" className="back-link">You</Link>
        <h1>Connections</h1>
        <span className="sub">What {name} may do in each app. Change it any time.</span>
      </header>
      <main className="main tight">
        {apps.map((app) => (
          <section key={app.app} aria-labelledby={`c-${app.app}`} className="card">
            <AccessControl app={app.app} name={app.name} account={app.account} access={app.access} />
          </section>
        ))}

        <section aria-labelledby="c-sites" className="card" style={{ gap: 8 }}>
          <h2 id="c-sites">Sites the Sentinel knows</h2>
          {sites.length === 0 ? (
            <span className="note">None yet. When {name}&apos;s browser needs a new site, the Sentinel asks you in Chat.</span>
          ) : (
            <ul className="list sites" style={{ gap: 6 }}>
              {sites.map((site) => (
                <li key={`${site.access}-${site.site}`}>
                  <span className="mono">{site.site}</span>
                  <span className={site.access}>{SITE_ACCESS[site.access]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>WhatsApp</span>
            <span className="status">{whatsapp ? `${whatsapp} · where ${name} writes to you` : `No number yet, so ${name} can't write to you there.`}</span>
          </div>
        </div>
      </main>
    </>
  );
}
