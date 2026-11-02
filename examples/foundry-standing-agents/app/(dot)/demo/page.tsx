import { notFound } from "next/navigation";
import { demoConnectors } from "glove-foundry-web-kit/server";
import { teamOf } from "../../server/dot";
import { pagePerson } from "../../server/signed-in";
import { Demo } from "../../ui/Demo";
import { NoDot } from "../../ui/NoDot";

/** Try it: a mock Slack and mock mail, with every hop they take. Only with DEMO_CONNECTORS=1. */
export default async function DemoPage() {
  if (!demoConnectors()) notFound();
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const name = team.dot.name ?? team.data.name;
  return (
    <main className="main">
      <div className="page-head">
        <div className="intro">
          <h1>Try it</h1>
          <p>A mock Slack and Gmail. What you send reaches {name} as a signed webhook, the way Slack and Google would send it, and {name}&apos;s posts come back here. The log shows each hop.</p>
        </div>
      </div>
      <Demo />
    </main>
  );
}
