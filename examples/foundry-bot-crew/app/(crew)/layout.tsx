import Link from "next/link";
import { redirect } from "next/navigation";
import { currentPerson, demoConnectors } from "glove-foundry-web-kit/server";
import { personOf } from "../server/crew";
import { Nav } from "../ui/Nav";

export const dynamic = "force-dynamic";

export default async function CrewLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await currentPerson();
  if (!signedIn) redirect("/welcome");
  const person = await personOf(signedIn.id);
  return (
    <div className="page">
      <header className="top">
        <div className="top-left">
          <Link href="/bots" className="brand">Crew</Link>
          <Nav demo={demoConnectors()} />
        </div>
        <details className="me">
          <summary aria-label={`Signed in as ${person.name}`}>{person.name.charAt(0).toUpperCase()}</summary>
          <div className="me-menu">
            <span>Signed in as {person.name}</span>
            <form method="post" action="/signout">
              <button type="submit" className="button wide">Sign out</button>
            </form>
          </div>
        </details>
      </header>
      {children}
    </div>
  );
}
