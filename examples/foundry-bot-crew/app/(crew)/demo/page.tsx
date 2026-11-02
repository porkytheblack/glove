import { notFound } from "next/navigation";
import { demoConnectors } from "glove-foundry-web-kit/server";
import { pagePerson } from "../../server/signed-in";
import { Demo } from "../../ui/Demo";

/** Try it: a mock mail, with every hop it takes. Only with DEMO_CONNECTORS=1. */
export default async function DemoPage() {
  if (!demoConnectors()) notFound();
  await pagePerson();
  return (
    <main className="main">
      <div className="intro">
        <h1>Try it</h1>
        <p>A mock Gmail. What you send reaches your crew as a signed webhook, the way new mail would, and every bot with a routine on new mail picks it up.</p>
      </div>
      <Demo />
    </main>
  );
}
