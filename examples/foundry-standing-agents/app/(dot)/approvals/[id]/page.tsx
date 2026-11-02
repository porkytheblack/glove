import { ApprovalScreen } from "glove-foundry-web-kit/client";
import { approvalPage } from "glove-foundry-web-kit/server";
import { describeApprovals, teamOf } from "../../../server/dot";
import { orNotFound, pagePerson } from "../../../server/signed-in";
import { NoDot } from "../../../ui/NoDot";

/** One approval of the dot's or its builder's, opened from its link (Foundry's `approval.url`). */
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const view = await orNotFound(approvalPage(person.id, id, { describe: await describeApprovals(person.id, team) }));
  const dotName = team.dot.name ?? team.data.name;
  const name = view.approval.agentId === team.builder?.id ? team.builder?.name ?? "The builder" : dotName;
  return (
    <main className="main">
      <ApprovalScreen view={view} decideUrl={`/api/approvals/${encodeURIComponent(view.approval.id)}`} agentName={name} back={{ href: "/", label: `Back to ${dotName}` }} labels={{ approve: "Approve" }} />
    </main>
  );
}
