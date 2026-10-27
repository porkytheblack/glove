import { notFound } from "next/navigation";
import { demoConnectors } from "glove-foundry-web-kit/server";
import { museOf, personaOf } from "../../server/muse";
import { orNotFound, pagePerson } from "../../server/signed-in";
import { Demo } from "../../ui/Demo";

/** Try it: mock WhatsApp and mock mail, with every hop they take. Only with DEMO_CONNECTORS=1. */
export default async function DemoPage() {
  if (!demoConnectors()) notFound();
  const person = await pagePerson();
  const name = personaOf(await orNotFound(museOf(person.id))).name;
  return (
    <>
      <header className="head">
        <h1>Try it</h1>
        <span className="sub">A mock WhatsApp and Gmail. What you send reaches {name} as a signed webhook, the way Meta and Google would send it, and its answers come back here.</span>
      </header>
      <main className="main">
        <Demo name={name} />
      </main>
    </>
  );
}
