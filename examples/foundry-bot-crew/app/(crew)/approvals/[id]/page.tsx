import { ApprovalScreen } from "glove-foundry-web-kit/client";
import { approvalPage, ownedAgents } from "glove-foundry-web-kit/server";
import { describeApprovals } from "../../../server/crew";
import { orNotFound, pagePerson } from "../../../server/signed-in";

/** One approval, opened from its link (Foundry's `approval.url`). */
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await pagePerson();
  const bots = await ownedAgents(person.id, "bot");
  const view = await orNotFound(approvalPage(person.id, id, { describe: await describeApprovals(person, bots) }));
  const bot = bots.find((item) => item.id === view.approval.agentId);
  const name = bot?.name ?? "The bot";
  return (
    <main className="main">
      <ApprovalScreen
        view={view}
        decideUrl={`/api/approvals/${encodeURIComponent(view.approval.id)}`}
        agentName={name}
        back={bot ? { href: `/bots/${encodeURIComponent(bot.id)}`, label: `Back to ${name}` } : { href: "/bots", label: "Back to your bots" }}
      />
    </main>
  );
}
