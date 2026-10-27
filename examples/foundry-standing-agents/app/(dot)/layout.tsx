import { redirect } from "next/navigation";
import { currentPerson } from "glove-foundry-web-kit/server";
import { personOf, teamOf } from "../server/dot";
import { Nav } from "../ui/Nav";

export const dynamic = "force-dynamic";

export default async function DotLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await currentPerson();
  if (!signedIn) redirect("/welcome");
  const team = await teamOf(signedIn.id);
  const person = personOf(signedIn.id, team);
  return (
    <div className="page">
      <header className="top">
        <div className="top-left">
          <span className="brand"><span aria-hidden="true" className="brand-dot" />Dot</span>
          <Nav dotName={team?.dot.name ?? "Your dot"} />
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
