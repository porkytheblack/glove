import { messageOptionsSchema, eventPolicySchema } from "./event-delivery.js";
import { FOUNDRY_CORE_COMMAND_DIRECTORY_ENV, createFoundryCoreCommandRequest, waitForFoundryCoreCommandResult } from "./core-command-result.js";
import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { defineAgent, isFoundryAgentDefinition, type FoundryAgentDefinition, type AgentAssemblyContext } from "./definition.js";
import { EMPTY_CAPABILITY_REGISTRY, restrictApp, type AppRestrictions, type FoundryApp, type FoundryMemoryProfile, type FoundryMemorySelection, type AgentInstallation, type AgentDefinitionSurfaceContext } from "./capabilities.js";
import type { AgentInstance, FoundryDataAdapter } from "./primitives.js";

export interface DurableSubagentOptions {
  readonly agent: FoundryAgentDefinition;
  readonly description?: string;
  readonly eventDelivery?: import("./event-delivery.js").FoundryEventPolicy;
  readonly inherit?: {
    /** A snapshot at provisioning. Transcripts are never inherited. */
    readonly context?: boolean;
    readonly tools?: ReadonlyArray<string>;
    /** Shared memory is read-only unless curator access is explicitly requested. */
    readonly memory?: "isolated" | "shared" | { readonly scope: "isolated" | "shared"; readonly access?: "reader" | "curator"; readonly profiles?: ReadonlyArray<string> };
    /** Only currently installed parent apps are inherited. Restrictions can only narrow access. */
    readonly apps?: ReadonlyArray<string | FoundryApp>;
  };
  /** Delete application-owned private memory/transcripts/files before purging Foundry records. Must be idempotent. */
  readonly cleanup?: (input: { readonly agent: AgentInstance; readonly conversationIds: ReadonlyArray<string> }) => void | Promise<void>;
}
export type DurableSubagents = Readonly<Record<string, DurableSubagentOptions>>;
export interface DurableSubagentOwnership {
  readonly parentAgentId: string;
  readonly name: string;
  readonly status: "active" | "archived" | "purged";
}
export interface AgentMessageReceipt { readonly messageId: string; readonly agentId: string; readonly conversationId: string; readonly runId?: string }
export interface DurableMessageCommand {
  readonly type: "agent.message";
  readonly id: string;
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly to: string;
  readonly message: string;
  readonly delivery?: import("./event-delivery.js").FoundryMessageOptions;
}
const memoryOrigins = new WeakMap<FoundryMemoryProfile, FoundryMemoryProfile>();
const compositions = new WeakMap<FoundryAgentDefinition, { parent: FoundryAgentDefinition; selection: DurableSubagentOptions }>();
export const DURABLE_SEGMENT = "/workers/";
export const durableRoute = (parent: string, name: string): string => `${parent}${DURABLE_SEGMENT}${name}`;
export const durableKey = (parent: string, name: string): string => `subagent:${JSON.stringify([parent, name])}`;
export const durableInstanceId = (parent: string, name: string): string => `worker_${createHash("sha256").update(durableKey(parent, name)).digest("hex")}`;
export const agentInboxId = (agentId: string): string => `inbox_${createHash("sha256").update(agentId).digest("hex")}`;

export function validateDurableSubagents(children: DurableSubagents = {}): void {
  for (const [name, child] of Object.entries(children)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name === "parent") throw new Error(`Invalid durable subagent name "${name}".`);
    if (child.eventDelivery) eventPolicySchema.parse(child.eventDelivery);
    if (!isFoundryAgentDefinition(child.agent)) throw new Error(`Durable subagent "${name}" requires an agent definition.`);
  }
}

async function resolveList<T>(definition: FoundryAgentDefinition, field: unknown, ctx: AgentAssemblyContext): Promise<ReadonlyArray<T>> {
  const value = typeof field === "function" ? field(definition, ctx) : field ?? [];
  return Effect.isEffect(value) ? Effect.runPromise(value as Effect.Effect<ReadonlyArray<T>, unknown>) : await value;
}

/** One effective definition per owned slot. The reused source definition remains unchanged. */
export function composeDurableAgent(parent: FoundryAgentDefinition, name: string, selection: DurableSubagentOptions): FoundryAgentDefinition {
  const child = selection.agent;
  const inherited = selection.inherit;
  const parentRegistry = parent.components?.capabilities ?? EMPTY_CAPABILITY_REGISTRY;
  const childRegistry = child.components?.capabilities ?? EMPTY_CAPABILITY_REGISTRY;
  const apps = (inherited?.apps ?? []).map((app) => {
    const id = typeof app === "string" ? app : app.id;
    const source = parentRegistry.applications.find((candidate) => candidate.id === id);
    if (!source) throw new Error(`Cannot inherit unknown parent application "${id}".`);
    // An unmodified reference deliberately grants no tools, sessions, or transmissions.
    const limits: AppRestrictions = typeof app === "string" ? {} : app.restrictions ?? {};
    return restrictApp(source, limits);
  });
  for (const app of apps) {
    if (childRegistry.applications.some((candidate) => candidate.id === app.id)) throw new Error(`Inherited application "${app.id}" conflicts with the child's own catalogue.`);
  }
  const memoryOption = inherited?.memory;
  const memoryPolicy = typeof memoryOption === "string" ? { scope: memoryOption, access: "reader" as const } : memoryOption;
  const selectedMemory = memoryPolicy ? parentRegistry.memory.filter((profile) => !memoryPolicy.profiles || memoryPolicy.profiles.includes(profile.id)) : [];
  const inheritedMemory = selectedMemory.map((profile): FoundryMemoryProfile => {
    if (profile.mount) throw new Error(`Memory "${profile.id}" has a custom mount and cannot be safely inherited. Define a restricted profile instead.`);
    const readonly = memoryPolicy?.access !== "curator";
    const origin = memoryOrigins.get(profile) ?? profile;
    const adapters = memoryPolicy?.scope === "isolated" ? origin : profile;
    const factory = <A>(adapter: (context: AgentDefinitionSurfaceContext) => Effect.Effect<A, unknown>) => (context: AgentDefinitionSurfaceContext): Effect.Effect<A, unknown> => Effect.gen(function* () {
      const owner = (context.request.context?.durableMemoryOwners as Record<string, AgentInstance> | undefined)?.[parent.id];
      if (memoryPolicy?.scope === "shared" && !owner) throw new Error("Shared memory requires a validated parent instance.");
      return yield* adapter(memoryPolicy?.scope === "shared" ? { ...context, agentId: owner!.id, definitionId: owner!.definitionId, conversationId: agentInboxId(owner!.id) } : context);
    });
    const restricted: FoundryMemoryProfile = {
      ...profile,
      ...(profile.entity ? { entity: { ...profile.entity, access: readonly ? "reader" : profile.entity.access, adapter: factory(adapters.entity!.adapter) } } : {}),
      ...(profile.episodic ? { episodic: { ...profile.episodic, access: readonly ? "reader" : profile.episodic.access, adapter: factory(adapters.episodic!.adapter) } } : {}),
      ...(profile.resources ? { resources: { ...profile.resources, access: readonly ? "reader" : profile.resources.access, adapter: factory(adapters.resources!.adapter) } } : {}),
      ...(profile.context ? { context: { ...profile.context, adapter: factory(adapters.context!.adapter), ...(readonly ? { tools: { ...profile.context.tools, deny: [...(profile.context.tools?.deny ?? []), "glove_context_set", "glove_context_update", "glove_context_unset"] } } : {}) } } : {}),
    };
    memoryOrigins.set(restricted, origin);
    return restricted;
  });
  for (const profile of inheritedMemory) {
    if (childRegistry.memory.some((candidate) => candidate.id === profile.id)) throw new Error(`Inherited memory "${profile.id}" conflicts with the child's own catalogue.`);
  }
  // Do not read the deferred id getter of an inline definition.
  const options = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(child)).filter(([key]) => key !== "id").map(([key, descriptor]) => [key, descriptor.value]));
  const definition = defineAgent({
    ...options,
    id: durableRoute(parent.id, name),
    description: selection.description ?? child.description,
    eventDelivery: selection.eventDelivery ?? child.eventDelivery,
    components: {
      capabilities: { ...childRegistry, applications: [...childRegistry.applications, ...apps], memory: [...childRegistry.memory, ...inheritedMemory] },
      native: child.components?.native ?? { layers: [], subscribers: [] },
    },
    tools: async (_definition, ctx) => {
      const own = await resolveList<GloveFoldArgs<any>>(child, child.tools, ctx);
      const inheritedTools = inherited?.tools?.length ? (await resolveList<GloveFoldArgs<any>>(parent, parent.tools, ctx)).filter((tool) => inherited.tools!.includes(tool.name)) : [];
      for (const tool of inheritedTools) if (own.some((candidate) => candidate.name === tool.name)) throw new Error(`Inherited tool "${tool.name}" conflicts with a child tool.`);
      return [...own, ...inheritedTools];
    },
    memory: async (_definition, ctx) => {
      const own = await resolveList<FoundryMemorySelection>(child, child.memory, ctx);
      const inheritedSelections = memoryPolicy ? (await resolveList<FoundryMemorySelection>(parent, parent.memory, ctx)).filter((item) => inheritedMemory.some((profile) => profile.id === ("profile" in item ? item.profile.id : item.id))) : [];
      return [...own, ...inheritedSelections];
    },
    accountSessions: child.accountSessions ?? (apps.length ? parent.accountSessions : undefined),
  });
  compositions.set(definition, { parent, selection });
  return definition;
}

export function inheritedInstallations(parent: AgentInstance, definition: FoundryAgentDefinition, selection: DurableSubagentOptions): ReadonlyArray<AgentInstallation> {
  const allowed = new Set((selection.inherit?.apps ?? []).map((app) => typeof app === "string" ? app : app.id));
  return parent.installations.filter((installation) => installation.kind === "application" && allowed.has(installation.id) && definition.components?.capabilities.applications.some((app) => app.id === installation.id));
}

export function createAgentMessagingTool(ctx: AgentAssemblyContext, names: ReadonlyArray<string>, hasParent: boolean): GloveFoldArgs<any> {
  return {
    name: "glove_foundry_message",
    description: "Send an asynchronous message to a persistent worker or your parent. The recipient receives a spontaneous event in its addressed runtime context; this does not wait for its answer. Use delegation for a task whose final result should return to this conversation.",
    inputSchema: z.object({ to: z.enum([...(hasParent ? ["parent"] : []), ...names] as [string, ...string[]]), message: z.string().min(1), delivery: messageOptionsSchema.optional() }),
    async do(input: { to: string; message: string; delivery?: import("./event-delivery.js").FoundryMessageOptions }) {
      const command: DurableMessageCommand = { type: "agent.message", id: `command_${randomUUID()}`, definitionId: ctx.definitionId, agentId: ctx.agentId, conversationId: ctx.conversationId, workspaceId: ctx.workspaceId, ...input };
      const directory = process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV];
      if (!directory) throw new Error("Durable messaging requires a running Foundry control process.");
      const request = await createFoundryCoreCommandRequest(directory, { id: command.id, runId: ctx.runId, type: "agent.message", timeoutMs: 30_000 });
      ctx.controls.commands.push(command);
      ctx.controls.emit({ type: "foundry.core.command", data: command });
      return { status: "success" as const, data: await waitForFoundryCoreCommandResult(directory, request, ctx.controls.signal, { cleanup: true }) };
    },
  };
}

/** Re-read authority in the execution process, including scheduled runs created before a revocation. */
export async function refreshDurableAuthority(definition: FoundryAgentDefinition, snapshot: AgentInstance, data: FoundryDataAdapter): Promise<{ agent: AgentInstance; owners: Record<string, Pick<AgentInstance, "id" | "definitionId" | "workspaceId">> }> {
  const owners: Record<string, Pick<AgentInstance, "id" | "definitionId" | "workspaceId">> = {};
  const visit = async (currentDefinition: FoundryAgentDefinition, instance: AgentInstance): Promise<AgentInstance> => {
    const current = await Effect.runPromise(data.getAgent(instance.id));
    if (!current) throw new Error(`Durable agent "${instance.id}" was removed.`);
    if (current.definitionId !== currentDefinition.id || current.workspaceId !== snapshot.workspaceId) throw new Error("Durable agent ownership changed.");
    if (!current.durableSubagent) return current;
    if (current.durableSubagent.status !== "active") throw new Error(`Durable worker is ${current.durableSubagent.status}.`);
    const composition = compositions.get(currentDefinition);
    if (!composition) throw new Error("Durable worker definition is detached.");
    const parentSnapshot = await Effect.runPromise(data.getAgent(current.durableSubagent.parentAgentId));
    if (!parentSnapshot) throw new Error("Durable worker parent is missing.");
    const parent = await visit(composition.parent, parentSnapshot);
    owners[parent.definitionId] = { id: parent.id, definitionId: parent.definitionId, workspaceId: parent.workspaceId };
    const ids = new Set((composition.selection.inherit?.apps ?? []).map((app) => typeof app === "string" ? app : app.id));
    return { ...current, installations: [...current.installations.filter((item) => item.kind !== "application" || !ids.has(item.id)), ...inheritedInstallations(parent, currentDefinition, composition.selection)] };
  };
  return { agent: await visit(definition, snapshot), owners };
}
