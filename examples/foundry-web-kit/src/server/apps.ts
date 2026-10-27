import type { AgentInstance, AgentPlaybook } from "glove-foundry";
import type { AppSummary } from "../shared";
import { foundry, type Foundry } from "./foundry";

// The Apps screen, from what Foundry knows. Apps compose accounts;
// transmissions carry messages in and out through those accounts; playbooks
// deal with what comes in. A connection (a mailbox watch) is plumbing, so it
// only shows as "Watching <account>" on the inbound transmission.

type Reads = Pick<Foundry, "agentInstances" | "capabilities" | "manifest" | "accounts" | "routes" | "applicationConnections" | "playbookSubscriptions">;

/** A playbook as the Apps screen lists it. */
export interface PlaybookLine {
  readonly name: string;
  readonly transmissionId: string;
  readonly applications?: ReadonlyArray<string>;
  /** What this agent does with what comes in, in a few words. */
  readonly does?: string;
}

export interface AppsOptions {
  readonly client?: Reads;
  /** The definitions whose apps to list. Defaults to the definitions of the person's agents. */
  readonly definitions?: ReadonlyArray<string>;
  /**
   * Accounts the product keeps itself (labels only, never tokens). Foundry's
   * directory only lists accounts that carry a transmission, so an app that is
   * only an MCP server needs its account named here.
   */
  readonly accounts?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** Display names: an app's, and a transmission's in and out sides. */
  readonly names?: {
    readonly apps?: Readonly<Record<string, string>>;
    readonly inbound?: Readonly<Record<string, string>>;
    readonly outbound?: Readonly<Record<string, string>>;
  };
  /** Whether a transmission's outbound side asks the person first. Defaults to yes. */
  readonly asks?: (transmissionId: string) => boolean;
  /**
   * An agent's playbooks. Defaults to the ones Foundry synced to the instance
   * on its last run; pass the product's own reading to show them before then.
   */
  readonly playbooks?: (agent: AgentInstance) => ReadonlyArray<PlaybookLine>;
}

const fromInstance = (agent: AgentInstance): ReadonlyArray<PlaybookLine> =>
  agent.playbooks.filter((playbook) => playbook.enabled !== false).map((playbook: AgentPlaybook) => ({
    name: playbook.playbookName ?? playbook.id,
    transmissionId: playbook.transmissionId,
    ...(playbook.applications ? { applications: playbook.applications } : {}),
    ...(playbook.directives[0] ? { does: playbook.directives[0].instruction } : {}),
  }));

const titled = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * One entry per app the person's agents may have: its accounts (only those
 * installed on `agentIds`), inbound and outbound transmissions, and the
 * playbooks that handle what comes in, with the agents that run them.
 */
export async function appsSummary(workspaceId: string, agentIds: ReadonlyArray<string>, options: AppsOptions = {}): Promise<AppSummary[]> {
  const client = options.client ?? foundry();
  const agents = (await client.agentInstances()).filter((agent) => agent.workspaceId === workspaceId && agentIds.includes(agent.id));
  const definitions = options.definitions ?? [...new Set(agents.map((agent) => agent.definitionId))];
  const [capabilities, manifest, directory, routes, connections, subscriptions] = await Promise.all([
    Promise.all(definitions.map((definition) => client.capabilities(definition))),
    client.manifest(),
    client.accounts(),
    client.routes(),
    client.applicationConnections(),
    client.playbookSubscriptions(workspaceId),
  ]);
  const transmissions = manifest.application.transmissions;
  const mine = connections.filter((connection) => connection.workspaceId === workspaceId);
  const labelOf = (accountId: string) =>
    options.accounts?.find((account) => account.id === accountId)?.label
    ?? directory.find((account) => account.id === accountId)?.label
    ?? directory.find((account) => account.id === accountId)?.externalAccountId
    ?? accountId;
  const known = (accountId: string) =>
    Boolean(options.accounts?.some((account) => account.id === accountId) || directory.some((account) => account.id === accountId));

  const apps = new Map<string, string>();
  for (const manifestApps of capabilities) for (const app of manifestApps.applications) if (!apps.has(app.id)) apps.set(app.id, app.description);

  return [...apps].map(([app, description]): AppSummary => {
    const installed = agents.filter((agent) => agent.installations.some((item) => item.kind === "application" && item.id === app));
    const accountIds = [...new Set(installed.flatMap((agent) => agent.installations
      .filter((item) => item.kind === "application" && item.id === app && item.accountId)
      .map((item) => item.accountId!)))];
    const watches = mine.filter((connection) => connection.applicationId === app);
    const playbookLines = installed.flatMap((agent) => (options.playbooks ?? fromInstance)(agent).map((line) => ({ agent, line })));

    // Its transmissions: those its accounts route, its connections watch, or its playbooks take.
    const transmissionIds = new Set<string>([
      ...routes.filter((route) => route.accountId && accountIds.includes(route.accountId)).map((route) => route.transmissionId),
      ...watches.flatMap((connection) => routes.filter((route) => connection.routeIds.includes(route.id)).map((route) => route.transmissionId)),
      ...playbookLines.filter(({ line }) => line.applications?.includes(app)).map(({ line }) => line.transmissionId),
    ]);
    const own = transmissions.filter((transmission) => transmissionIds.has(transmission.id));

    const accounts = accountIds.map((id) => {
      const states = watches.filter((connection) => connection.accountId === id).map((connection) => connection.status);
      const status: AppSummary["accounts"][number]["status"] = states.includes("connected") ? "connected"
        : states.some((state) => state === "failed" || state === "disconnected") ? "error"
        : known(id) ? "connected" : "unknown";
      return { id, label: labelOf(id), status };
    });

    const inbound = own.filter((transmission) => transmission.inbound).map((transmission) => {
      const inRoutes = routes.filter((route) => route.transmissionId === transmission.id && route.direction === "inbound").map((route): string => route.id);
      const watching = watches.find((connection) => connection.status === "connected" && connection.accountId && connection.routeIds.some((id) => inRoutes.includes(id)));
      return {
        name: options.names?.inbound?.[transmission.id] ?? transmission.name,
        ...(watching?.accountId ? { watching: labelOf(watching.accountId) } : {}),
      };
    });
    const outbound = own.filter((transmission) => transmission.outbound).map((transmission) => ({
      name: options.names?.outbound?.[transmission.id] ?? transmission.name,
      asks: options.asks?.(transmission.id) ?? true,
    }));

    const playbooks = new Map<string, Array<{ agentId: string; agent: string; does?: string }>>();
    for (const { agent, line } of playbookLines) {
      if (!transmissionIds.has(line.transmissionId)) continue;
      const handlers = playbooks.get(line.name) ?? [];
      if (!handlers.some((handler) => handler.agentId === agent.id)) {
        handlers.push({ agentId: agent.id, agent: agent.name ?? agent.id, ...(line.does ? { does: line.does } : {}) });
      }
      playbooks.set(line.name, handlers);
    }
    for (const subscription of subscriptions) {
      if (!subscription.enabled || !transmissionIds.has(subscription.playbook.transmissionId)) continue;
      const name = subscription.playbook.playbookName ?? subscription.id;
      playbooks.set(name, [
        ...(playbooks.get(name) ?? []),
        ...subscription.targets.map((target) => ({ agentId: target.definitionId, agent: target.definitionId })),
      ]);
    }

    return {
      app,
      name: options.names?.apps?.[app] ?? titled(app),
      description,
      installedOn: installed.length,
      accounts,
      inbound,
      outbound,
      playbooks: [...playbooks].map(([name, handledBy]) => ({ name, handledBy })),
    };
  });
}
