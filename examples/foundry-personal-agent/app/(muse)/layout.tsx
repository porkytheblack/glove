import { redirect } from "next/navigation";
import { HttpError, currentPerson, demoConnectors } from "glove-foundry-web-kit/server";
import { museOf } from "../server/muse";
import { Tabs } from "../ui/Tabs";

export const dynamic = "force-dynamic";

/** The signed-in app: one phone-width column, the screen, and the tabs. */
export default async function MuseLayout({ children }: { children: React.ReactNode }) {
  const person = await currentPerson();
  if (!person) redirect("/welcome");
  const muse = await museOf(person.id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!muse) {
    return (
      <div className="phone">
        <main className="welcome">
          <h1>No agent yet</h1>
          <p>You&apos;re signed in, but nobody has set up an agent for you on this server yet. Ask whoever runs it.</p>
          <form method="post" action="/signout"><button type="submit" className="button">Sign out</button></form>
        </main>
      </div>
    );
  }
  return (
    <div className="phone">
      {children}
      <Tabs demo={demoConnectors()} />
    </div>
  );
}
