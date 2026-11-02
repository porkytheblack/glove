import { appsSummary, ownedAgents } from "glove-foundry-web-kit/server";
import type { EventRoutine } from "../../../lib/people";
import { host } from "../../server/host";
import { pagePerson } from "../../server/signed-in";
import { AppsView } from "../../ui/AppsView";

export default async function Apps({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const person = await pagePerson();
  const { accounts, connect, oauth, people } = await host();
  const [bots, connected] = await Promise.all([ownedAgents(person.id, "bot"), accounts.accountsOf(person.id)]);
  const gmail = connect.APPS.gmail.id;
  const apps = await appsSummary(person.id, bots.map((bot) => bot.id), {
    accounts: connected.map((account) => ({ id: account.id, label: account.label ?? account.externalAccountId })),
    names: { apps: { gmail: "Gmail", linear: "Linear" }, inbound: { [gmail]: "New mail" }, outbound: { [gmail]: "Send email" } },
    // A bot's routines on new mail are its playbook; read them from its data so they show before its next run.
    playbooks: (bot) => ((bot.context.routines ?? []) as ReadonlyArray<EventRoutine>)
      .filter((routine) => routine.on === "new-mail")
      .map((routine) => ({ name: "On new mail", transmissionId: gmail, applications: ["gmail"], does: routine.instruction })),
  });
  const { error, connected: justConnected } = await searchParams;
  const primary = people.primaryOf(bots, person.id);
  return (
    <main className="main">
      <AppsView
        apps={apps}
        connectable={connect.APP_NAMES.map((app) => ({ app, ready: oauth.configured(connect.PROVIDERS[app]) }))}
        {...(primary ? { profileHref: `/bots/${primary.id}/profile` } : {})}
        {...(error ? { error } : {})}
        {...(justConnected ? { connected: justConnected } : {})}
      />
    </main>
  );
}
