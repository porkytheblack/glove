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
import dot from "../agents/dot/agent.js";
import gmailApp from "../agents/dot/apps/gmail.app.js";
import gmail, { sendAsOwner } from "../agents/dot/transmissions/gmail.transmission.js";
import { accountsOf, saveAccount, type ConnectedAccount, type Tokens } from "./accounts.js";
import type { Provider } from "./oauth.js";

// Connecting an app, as data. Your OAuth callback saves the account, then
// writes what Foundry needs to use it: for Gmail, a route in (new mail) and a
// route out (sending), plus, on the person's dot, the installation with that
// account and a binding that lets it send. A specialist dot connects its own
// mailbox the same way, in its organisation's workspace.

export const APPS = { gmail: gmailApp } as const;
export type AppName = keyof typeof APPS;
export const APP_NAMES = Object.keys(APPS) as AppName[];
export const PROVIDERS: Record<AppName, Provider> = { gmail: "google" };
/**
 * What each app asks the provider for. Gmail's are what Google's Gmail MCP
 * server needs (gmail.compose also covers sending), plus `openid email` to
 * name the account.
 */
export const SCOPES: Record<AppName, string> = {
  gmail: "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
};

/** The writes connecting needs, from the runtime in a script or the typed client in your app. `agents` lists who gets apps: the dots. */
export interface FoundryWrites {
  readonly agents: () => Promise<ReadonlyArray<AgentInstance>>;
  readonly install: (agentId: string, installation: AgentInstallation) => Promise<unknown>;
  readonly putRoute: (route: Route) => Promise<unknown>;
  readonly putBinding: (binding: AgentBinding) => Promise<unknown>;
}

export const writesVia = {
  runtime: (runtime: FoundryRuntime): FoundryWrites => ({
    agents: () => runtime.listAgentInstances(dot.id),
    install: (agentId, installation) => runtime.installCapability(agentId, installation),
    putRoute: (route) => runtime.putRoute(route),
    putBinding: (binding) => runtime.putBinding(binding),
  }),
  client: (client: FoundryClient<FoundryRouteMap>): FoundryWrites => ({
    agents: () => client.agentInstances(dot.id),
    install: (agentId, installation) => client.install(agentId, installation),
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

/** A mailbox's Gmail routes. New mail joins the dot's app conversation, where progress goes. */
export function gmailRoutes(accountId: string) {
  const shared = { transmissionId: "pending", accountId, visibility: "private", enabled: true };
  return {
    in: withLazy(Schema.decodeUnknownSync(InboundRoute)({ ...shared, id: `${accountId}-in`, direction: "inbound", config: { label: "INBOX", conversation: "app" } }), "transmissionId", () => gmail.id),
    out: withLazy(Schema.decodeUnknownSync(OutboundRoute)({ ...shared, id: `${accountId}-out`, direction: "outbound", config: {} }), "transmissionId", () => gmail.id),
  };
}

/** Lets one bot send from the account. Without it, Foundry refuses the delivery. */
export function sendBinding(agentId: string, accountId: string): AgentBinding {
  return withLazy(Schema.decodeUnknownSync(AgentBinding)({
    id: `${agentId}--${accountId}`,
    agentId,
    transmissionId: "pending",
    accountId,
    routeId: `${accountId}-out`,
    capabilities: [sendAsOwner.id],
    enabled: true,
  }), "transmissionId", () => gmail.id);
}

/** The installation of an account's app, with the tools the person always allows. */
export function installationFor(account: Pick<ConnectedAccount, "id" | "app">, alwaysAllow: ReadonlyArray<string> = []): AgentInstallation {
  return withLazy(
    { kind: "application" as const, id: "pending", accountId: account.id, config: { alwaysAllow: [...alwaysAllow] } },
    "id",
    () => APPS[account.app as AppName].id,
  );
}

/** Give one bot one of the person's accounts. */
export async function giveAccount(foundry: FoundryWrites, agentId: string, account: ConnectedAccount, alwaysAllow?: ReadonlyArray<string>): Promise<void> {
  await foundry.install(agentId, installationFor(account, alwaysAllow));
  if (account.app === "gmail") await foundry.putBinding(sendBinding(agentId, account.id));
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
 * What the OAuth callback does with the tokens: save the account, then make
 * it the dot's. `identity` is who the tokens belong to (see oauth.identify).
 */
export async function connectApp(
  foundry: FoundryWrites,
  person: { readonly id: string },
  app: AppName,
  connection: { readonly tokens: Tokens; readonly identity: Identity; readonly alwaysAllow?: ReadonlyArray<string>; readonly offline?: boolean },
): Promise<ConnectedAccount> {
  const account = accountFor(person, app, connection.identity, connection.offline);
  await saveAccount(account, connection.tokens);
  if (app === "gmail") {
    const routes = gmailRoutes(account.id);
    await foundry.putRoute(routes.in);
    await foundry.putRoute(routes.out);
  }
  for (const bot of await foundry.agents()) {
    if (bot.workspaceId === person.id) await giveAccount(foundry, bot.id, account, connection.alwaysAllow);
  }
  return account;
}

/** A new dot gets every account its person connected. */
export async function giveAccounts(foundry: FoundryWrites, agentId: string, person: { readonly id: string }): Promise<void> {
  for (const account of await accountsOf(person.id)) await giveAccount(foundry, agentId, account);
}

/** A sample mailbox: no provider, a local server, sends go to the ledger. Sam's dot works the support inbox. */
export function sampleConnection(_person: { readonly id: string }, _app: AppName, email = "support@example.com") {
  return {
    tokens: { accessToken: "sample" },
    identity: { externalAccountId: email, label: email, metadata: { email } },
    offline: true,
  } as const;
}
