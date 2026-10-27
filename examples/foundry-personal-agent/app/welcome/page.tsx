import { redirect } from "next/navigation";
import { currentPerson } from "glove-foundry-web-kit/server";
import { demoPeople } from "../server/people";

export const dynamic = "force-dynamic";

export default async function Welcome({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  if (await currentPerson()) redirect("/chat");
  const { link } = await searchParams;
  const demo = await demoPeople();
  return (
    <div className="phone">
      <main className="welcome">
        <span aria-hidden="true" className="avatar big" style={{ background: "var(--kit-accent)" }}>M</span>
        <h1>Your personal agent</h1>
        <p>Sign in with the link you were sent. If it has expired, ask for a new one.</p>
        {link === "expired" ? <p role="alert" className="notice">That link has expired or isn&apos;t valid. Ask for a new one.</p> : null}
        {demo.length > 0 ? (
          <form method="post" action="/signin" className="card">
            <span className="label">DEVELOPMENT · SIGN IN AS</span>
            {demo.map((person) => (
              <button key={person.id} type="submit" name="person" value={person.id} className="button wide">{person.name}</button>
            ))}
          </form>
        ) : null}
      </main>
    </div>
  );
}
