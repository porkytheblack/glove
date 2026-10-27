import { redirect } from "next/navigation";
import { currentPerson, devSignIn } from "glove-foundry-web-kit/server";
import { host } from "../server/host";

export const dynamic = "force-dynamic";

export default async function Welcome({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  if (await currentPerson()) redirect("/");
  const { link } = await searchParams;
  const sam = (await host()).dots.SAM;
  const demo = devSignIn() ? [{ id: sam.id, name: sam.dot.owner }] : [];
  return (
    <main className="welcome">
      <span className="brand"><span aria-hidden="true" className="brand-dot" />Dot</span>
      <h1>Sign in</h1>
      <p>Open the invite link you were sent. Ask whoever runs Dot for a new one if yours has expired.</p>
      {link === "expired" ? <p className="notice" role="alert">That link has expired or isn&apos;t valid. Ask for a new one.</p> : null}
      {demo.length > 0 ? (
        <form method="post" action="/signin" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="label">DEVELOPMENT · SIGN IN AS</span>
          {demo.map((person) => (
            <button key={person.id} type="submit" name="person" value={person.id} className="button wide">
              {person.name}
            </button>
          ))}
        </form>
      ) : null}
    </main>
  );
}
