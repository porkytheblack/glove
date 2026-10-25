import { Schema } from "effect";
import {
  AgentBinding,
  InboundRoute,
  OutboundRoute,
  type AgentInstallation,
  type AgentInstance,
  type FoundryClient,
  type FoundryRouteMap,
  type FoundryRuntime,
  type Route,
} from "glove-foundry";
import muse from "../agents/muse/agent.js";
import calendarApp from "../agents/muse/apps/calendar.app.js";
import gmailApp from "../agents/muse/apps/gmail.app.js";
import { museNumber } from "../agents/muse/topology.js";
import gmail, { sendAsOwner } from "../agents/muse/transmissions/gmail.transmission.js";
import whatsapp, { answerPerson } from "../agents/muse/transmissions/whatsapp.transmission.js";
import { accountsOf, readAccount, saveAccount, type ConnectedAccount, type Tokens } from "./accounts.js";
import type { Provider } from "./oauth.js";

// Connecting an app, as data. The person chooses which apps Muse may use and
// what it may do in each: read only, or also act (send mail, change events).
// Your OAuth callback saves the account, then writes what Foundry needs: for
// Gmail a route in (new mail) and a route out (sending), the installation
// with the account and the chosen access, and, only when the access allows
// sending, a binding that lets Muse send. Changing access later is the same
// writes again; disconnecting removes them. None of it is a deploy.

export const APPS = { gmail: gmailApp, calendar: calendarApp } as const;
export type AppName = keyof typeof APPS;
export const APP_NAMES = Object.keys(APPS) as AppName[];
export const PROVIDERS: Record<AppName, Provider> = { gmail: "google", calendar: "google" };

/** What Muse may do in an app. "read" leaves out every tool that changes something. */
export type Access = "read" | "act";
export const ACCESS_LABEL: Record<AppName, Record<Access, string>> = {
  gmail: { read: "read your mail", act: "read and send your mail" },
  calendar: { read: "see your calendar", act: "see and change your calendar" },
};

/**
 * What each app asks the provider for. Reading needs only read scopes; acting
 * adds gmail.compose (drafts and sending) or calendar.events.
 */
export function scopesFor(app: AppName, access: Access): string {
  const scopes = {
    gmail: { read: ["https://www.googleapis.com/auth/gmail.readonly"], act: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"] },
    calendar: { read: ["https://www.googleapis.com/auth/calendar.readonly"], act: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"] },
  }[app][access];
  return ["openid", "email", ...scopes].join(" ");
}

/** The writes connecting needs, from the runtime in a script or the typed client in your app. */
export interface FoundryWrites {
  readonly agents: () => Promise<ReadonlyArray<AgentInstance>>;
  readonly install: (agentId: string, installation: AgentInstallation) => Promise<unknown>;
  readonly uninstall: (agentId: string, installation: AgentInstallation) => Promise<unknown>;
  readonly putRoute: (route: Route) => Promise<unknown>;
  readonly putBinding: (binding: AgentBinding) => Promise<unknown>;
}

export const writesVia = {
  runtime: (runtime: FoundryRuntime): FoundryWrites => ({
    agents: () => runtime.listAgentInstances(muse.id),
    install: (agentId, installation) => runtime.installCapability(agentId, installation),
    uninstall: (agentId, installation) => runtime.uninstallCapability(agentId, installation),
    putRoute: (route) => runtime.putRoute(route),
    putBinding: (binding) => runtime.putBinding(binding),
  }),
  client: (client: FoundryClient<FoundryRouteMap>): FoundryWrites => ({
    agents: () => client.agentInstances(muse.id),
    install: (agentId, installation) => client.install(agentId, installation),
    uninstall: (agentId, installation) => client.uninstall(agentId, installation),
    putRoute: (route) => client.putRoute(route),
    putBinding: (binding) => client.putBinding(binding),
  }),
};

/**
 * Code ids (an app's or a transmission's, from its file name) are bound when
 * Foundry discovers the agents, which can be after this module loads. Like
 * Foundry's own install() and defineInboundRoute(), read them lazily.
 */
function withLazy<T extends object>(value: T, key: string, read: () => string): T {
  const copy = { ...value };
  Object.defineProperty(copy, key, { enumerable: true, get: read });
  return Object.freeze(copy);
}

/** A person's Gmail routes. New mail joins their app conversation with Muse. */
export function gmailRoutes(accountId: string) {
  const shared = { transmissionId: "pending", accountId, visibility: "private", enabled: true };
  return {
    in: withLazy(Schema.decodeUnknownSync(InboundRoute)({ ...shared, id: `${accountId}-in`, direction: "inbound", config: { label: "INBOX", conversation: "app" } }), "transmissionId", () => gmail.id),
    out: withLazy(Schema.decodeUnknownSync(OutboundRoute)({ ...shared, id: `${accountId}-out`, direction: "outbound", config: {} }), "transmissionId", () => gmail.id),
  };
}

/** Lets Muse send from the account. Disabled, Foundry refuses every delivery. */
export function sendBinding(agentId: string, accountId: string, enabled = true): AgentBinding {
  return withLazy(Schema.decodeUnknownSync(AgentBinding)({
    id: `${agentId}--${accountId}`,
    agentId,
    transmissionId: "pending",
    accountId,
    routeId: `${accountId}-out`,
    capabilities: [sendAsOwner.id],
    enabled,
  }), "transmissionId", () => gmail.id);
}

/**
 * WhatsApp for one person: the route that answers only their number, and the
 * binding that lets their Muse use it. Messages in all arrive on the shared
 * route (topology.ts).
 */
export function whatsappFor(agentId: string, person: { readonly id: string; readonly phone: string }) {
  const out = withLazy(Schema.decodeUnknownSync(OutboundRoute)({
    id: `${person.id}-whatsapp-out`,
    transmissionId: "pending",
    accountId: museNumber.id,
    direction: "outbound",
    visibility: "private",
    enabled: true,
    config: { to: person.phone },
  }), "transmissionId", () => whatsapp.id);
  const binding = withLazy(Schema.decodeUnknownSync(AgentBinding)({
    id: `${agentId}--whatsapp`,
    agentId,
    transmissionId: "pending",
    accountId: museNumber.id,
    routeId: out.id,
    capabilities: [answerPerson.id],
    enabled: true,
  }), "transmissionId", () => whatsapp.id);
  return { out, binding };
}

/** The installation of an account's app, with the access the person chose. */
export function installationFor(account: Pick<ConnectedAccount, "id" | "app">, access: Access, alwaysAllow: ReadonlyArray<string> = []): AgentInstallation {
  return withLazy(
    { kind: "application" as const, id: "pending", accountId: account.id, config: { access, alwaysAllow: [...alwaysAllow] } },
    "id",
    () => APPS[account.app as AppName].id,
  );
}

/**
 * Give Muse one of the person's accounts with an access level, or change the
 * level. Sending needs both: the installation's access (so the tool is
 * there) and an enabled binding (so Foundry will deliver).
 */
export async function setAccess(foundry: FoundryWrites, agentId: string, account: ConnectedAccount, access: Access, alwaysAllow?: ReadonlyArray<string>): Promise<void> {
  await foundry.install(agentId, installationFor(account, access, alwaysAllow));
  if (account.app === "gmail") await foundry.putBinding(sendBinding(agentId, account.id, access === "act"));
}

/** Take an app away: the installation goes, and so does any right to send from it. */
export async function disconnect(foundry: FoundryWrites, agentId: string, accountId: string): Promise<void> {
  const account = await readAccount(accountId);
  if (!account) return;
  await foundry.uninstall(agentId, installationFor(account, "read"));
  if (account.app === "gmail") await foundry.putBinding(sendBinding(agentId, account.id, false));
}

type Identity = { readonly externalAccountId: string; readonly label: string; readonly metadata: Record<string, string> };

/** The account record for a person's app. */
export function accountFor(person: { readonly id: string }, app: AppName, identity: Identity, offline = false): ConnectedAccount {
  return {
    id: `${person.id}-${app}`,
    person: person.id,
    app,
    provider: PROVIDERS[app],
    ...identity,
    ...(offline ? { offline: true } : {}),
  };
}

/**
 * What the OAuth callback does with the tokens: save the account, then give
 * it to the person's Muse with the access they chose. `identity` is who the
 * tokens belong to (see oauth.identify).
 */
export async function connectApp(
  foundry: FoundryWrites,
  person: { readonly id: string },
  app: AppName,
  connection: { readonly tokens: Tokens; readonly identity: Identity; readonly access: Access; readonly offline?: boolean },
): Promise<ConnectedAccount> {
  const account = accountFor(person, app, connection.identity, connection.offline);
  await saveAccount(account, connection.tokens);
  if (app === "gmail") {
    const routes = gmailRoutes(account.id);
    await foundry.putRoute(routes.in);
    await foundry.putRoute(routes.out);
  }
  for (const agent of await foundry.agents()) {
    if (agent.workspaceId === person.id) await setAccess(foundry, agent.id, account, connection.access);
  }
  return account;
}

/** A new Muse gets every account its person connected, read only until they say otherwise. */
export async function giveAccounts(foundry: FoundryWrites, agentId: string, person: { readonly id: string }): Promise<void> {
  for (const account of await accountsOf(person.id)) await setAccess(foundry, agentId, account, "read");
}

/** A sample account for a demo person: no provider, local servers, sends go to the ledger. */
export function sampleConnection(person: { readonly id: string; readonly name: string }) {
  const email = `${person.id}@example.com`;
  return {
    tokens: { accessToken: "sample" },
    identity: { externalAccountId: email, label: email, metadata: { email } },
    offline: true,
  } as const;
}
