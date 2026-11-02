import { ApprovalScreen } from "glove-foundry-web-kit/client";
import { approvalPage } from "glove-foundry-web-kit/server";
import { describeApprovals, museOf, personaOf } from "../../../server/muse";
import { orNotFound, pagePerson } from "../../../server/signed-in";

/** One of Muse's approvals, opened from its link (Foundry's `approval.url`). */
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await pagePerson();
  const muse = await orNotFound(museOf(person.id));
  const name = personaOf(muse).name;
  const describe = await describeApprovals(person.id, muse);
  const view = await orNotFound(approvalPage(person.id, id, {
    describe: (approval, base) => {
      const described = describe(approval, base);
      const sentinel = described.sentinel;
      // The chat draws the Sentinel's ask as its own card; here it reads as fields.
      return sentinel
        ? { title: `The Sentinel asks: may ${name} ${sentinel.access === "read" ? "read" : "send to"} ${sentinel.site}?`, fields: sentinel.why ? [{ label: "Why", value: sentinel.why }] : [] }
        : described;
    },
  }));
  return (
    <main className="main">
      <ApprovalScreen view={view} decideUrl={`/api/approvals/${encodeURIComponent(view.approval.id)}`} agentName={name}
        back={{ href: "/chat", label: `Back to ${name}` }}
        labels={view.approval.toolName === "buy" ? { approve: "Pay", deny: "Don't buy" } : { approve: "Yes, go ahead", deny: "Not now" }}
      />
    </main>
  );
}
