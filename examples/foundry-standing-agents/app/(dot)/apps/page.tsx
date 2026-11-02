import Link from "next/link";
import { appsSummary, type AppSummary, type PlaybookLine } from "glove-foundry-web-kit/server";
import { AppsScreen } from "glove-foundry-web-kit/client";
import { teamOf } from "../../server/dot";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { NoDot } from "../../ui/NoDot";

const sentence = (text: string) => {
  const plain = text.replace(/^[\w ]+: /, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};

export default async function Apps() {
  const person = await pagePerson();
  const team = await teamOf(person.id);
  if (!team) return <NoDot />;
  const { accounts, ids, review } = await host();
  const { dot, data, builder } = team;
  const name = dot.name ?? data.name;
  const installed = (app: string) => dot.installations.find((item) => item.kind === "application" && item.id === app);
  const mailbox = installed(ids.gmailApp);
  const slack = Boolean(data.slackUserId && installed(ids.slackApp));

  // What the dot's playbooks take, read from its data, so they show before its first run syncs them.
  const playbooks: PlaybookLine[] = [
    ...(slack ? [{ name: "Your messages", transmissionId: ids.slackMessages, applications: [ids.slackApp], does: "answers you in Slack, where you wrote" }] : []),
    ...(mailbox?.accountId ? [{ name: "New mail", transmissionId: ids.gmail, applications: [ids.gmailApp], does: "reads it and keeps a note; it sends nothing" }] : []),
  ];
  const sendLevel = review.levelFor("send_email", data.rules);
  const summary = await appsSummary(person.id, [dot.id, ...(builder ? [builder.id] : [])], {
    accounts: (await accounts.accountsOf(person.id)).map((account) => ({ id: account.id, label: account.label ?? account.externalAccountId })),
    names: {
      apps: { [ids.gmailApp]: "Gmail", [ids.slackApp]: "Slack" },
      inbound: { [ids.gmail]: "New mail", [ids.slackMessages]: "Your DMs and mentions" },
      outbound: { [ids.gmail]: "Send email" },
    },
    asks: (transmission) => transmission !== ids.gmail || sendLevel !== "allow",
    playbooks: (agent) => (agent.id === dot.id ? playbooks : []),
  });
  // Slack posts go out through a tool on the bot's account rather than a transmission.
  const apps: AppSummary[] = summary.map((app) => ({
    ...app,
    description: sentence(app.description),
    // Slack's Events API brings DMs and mentions of the bot user in; there is no connection to show.
    ...(app.app === ids.slackApp && slack ? {
      inbound: app.inbound.map((inbound) => ({ ...inbound, watching: inbound.watching ?? "the bot user" })),
      outbound: [...app.outbound, { name: "Posts as the bot", asks: false }],
    } : {}),
  }));

  const emailNote = sendLevel === "block"
    ? "Your rule hands each email to you"
    : `Your rule: ${review.LEVEL_LABELS[sendLevel].toLowerCase()} · someone who never wrote in always asks`;
  return (
    <main className="main">
      <AppsScreen
        apps={apps}
        intro={`An app holds the accounts you connect. What comes in is handled by a playbook. What goes out follows your rules.`}
        installedLabel={(app) => (app.installedOn > 0 ? `On ${name}` : "Not installed")}
        noAccounts={(app) => `No ${app.name} account yet. Connect one with pnpm connect.`}
        outboundNote={(app, outbound) => app.app === ids.gmailApp ? emailNote
          : outbound.asks ? "Asks you before each one" : "Where you wrote to it · not on research runs"}
        noPlaybooks={(app) => app.inbound.length === 0 ? "None, since nothing comes in." : "None yet."}
        footer={(app) => app.app === ids.gmailApp
          ? "Reads run without asking: search, open threads and messages, list drafts and labels. Research reads the mailbox in one program."
          : app.app === ids.slackApp ? `Only your DMs and mentions reach ${name}. Adding the bot to a channel doesn't make it watch.` : undefined}
        footerAction={(app) => app.app === ids.gmailApp ? <Link href="/rules" style={{ fontSize: 14 }}>Custom Rules</Link> : null}
      />
    </main>
  );
}
