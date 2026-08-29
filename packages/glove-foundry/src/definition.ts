import type {
  DefineSkillArgs,
  DefineSubAgentArgs,
  DisplayManagerAdapter,
  GloveFoldArgs,
  HookHandler,
  IGloveRunnable,
  InboxItem,
  Message,
  ModelAdapter,
  StoreAdapter,
  SubscriberAdapter,
  SubAgentFactoryContext,
} from "glove-core";
import { Displaymanager, Glove } from "glove-core";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentIdentity, MeshAdapter } from "glove-mesh";
import type {
  AgentInstallation,
  FoundryAccountSessionAdapter,
  FoundryMemorySelection,
  McpAdapterFactory,
} from "./capabilities.js";
import type { FoundryAgentComposition } from "./composition.js";
import type {
  FoundryLayer,
  FoundryLayerSelection,
  FoundrySubscriber,
  FoundrySubscriberSelection,
  FoundrySurfaceContext,
} from "./surfaces.js";
import type { FoundryCoreCommand } from "./core-tools.js";
import type { FoundryScheduleDefinition } from "./schedule.js";
import type { ComposedAgentPlaybook } from "./playbook.js";
import type {
  FoundryMountedRepl,
  FoundryReplDefinition,
  FoundryVfsHandle,
  FoundryWorkingEnvironmentDefinition,
} from "./workbench.js";
import type { WorkingEnvironment } from "glove-working-environment";
import type {
  AgentInstance,
  Conversation,
  FoundryActivationRecord,
  FoundryDataAdapter,
  FoundryRequest,
  FoundryMessageInput,
} from "./primitives.js";
import {
  bindFileIdentity,
  fileIdentified,
} from "./identity.js";

export const FOUNDRY_AGENT_DEFINITION_BRAND = Symbol.for(
  "glove-foundry-agent-definition",
);
/** @deprecated Agent modules are definitions; execution contracts are internal. */
export const FOUNDRY_AGENT_BRAND = FOUNDRY_AGENT_DEFINITION_BRAND;
export const FOUNDRY_EVENT_PREFIX = "__GLOVE_FOUNDRY_EVENT__";
export const FOUNDRY_APPLICATION_ENV = "GLOVE_FOUNDRY_APPLICATION_FILE";
export const FOUNDRY_AGENT_ROUTE_ENV = "GLOVE_FOUNDRY_AGENT_ROUTE";
export const FOUNDRY_AGENT_FILE_ENV = "GLOVE_FOUNDRY_AGENT_FILE";
export const FOUNDRY_EXECUTION_MARKER = "__glove_foundry_execution_v1";
export type FoundryAgentMode = "agent";

export type Resolvable<T> = T | Promise<T> | Effect.Effect<T, unknown, never>;

export interface AgentRuntimeControls {
  readonly signal: AbortSignal;
  readonly emit: (event: { type: string; data?: unknown }) => void;
  /** Commands are emitted to the parent runtime and retained for result semantics. */
  readonly commands: FoundryCoreCommand[];
}

export interface AgentAssemblyContext<TInput = unknown> {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly runId: string;
  readonly mode: "agent";
  readonly request: FoundryRequest;
  readonly agentInstance: AgentInstance;
  readonly conversation: Conversation;
  /** Parent-runtime snapshot used by agent schedule management tools. */
  readonly activations: ReadonlyArray<FoundryActivationRecord>;
  readonly data: FoundryDataAdapter;
  readonly input: TInput;
  /** Native Glove representation of the current inbound user turn. */
  readonly message: Message;
  /** Exact input that will be passed to `Glove.processRequest`. */
  readonly messageInput: FoundryMessageInput;
  /** Convenience text projection matching Glove's multimodal normalization. */
  readonly messageText: string;
  /** Persisted native Glove messages before the current inbound turn. */
  readonly history: ReadonlyArray<Message>;
  /** Prior history followed by the current inbound turn. */
  readonly messages: ReadonlyArray<Message>;
  readonly installations: ReadonlyArray<AgentInstallation>;
  readonly store: StoreAdapter | null;
  readonly subscriber: SubscriberAdapter;
  readonly controls: AgentRuntimeControls;
}

/** @deprecated Use AgentAssemblyContext. */
export type AgentFactoryContext<TInput = unknown> = AgentAssemblyContext<TInput>;

export interface FoundryHookDefinition {
  readonly name: string;
  readonly handler: HookHandler;
}

export interface FoundryCallContext<TInput = unknown>
  extends FoundrySurfaceContext<TInput> {
  readonly installations: ReadonlyArray<AgentInstallation>;
}

export interface FoundryCallOptions<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  readonly name: string;
  readonly description: string;
  readonly input: TInputSchema;
  readonly output: TOutputSchema;
  readonly exposeToAgent?: boolean;
  readonly handler: (
    input: z.output<TInputSchema>,
    context: FoundryCallContext,
  ) => Resolvable<z.input<TOutputSchema>>;
}

export type FoundryCall<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> = Readonly<FoundryCallOptions<TInputSchema, TOutputSchema>>;

export function defineCall<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  options: FoundryCallOptions<TInputSchema, TOutputSchema>,
): FoundryCall<TInputSchema, TOutputSchema> {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name)) {
    throw new Error(`Invalid Foundry call name "${options.name}".`);
  }
  return Object.freeze({ ...options });
}

export interface FoundryExecutionContext<TInput = unknown>
  extends FoundrySurfaceContext<TInput> {
  readonly installations: ReadonlyArray<AgentInstallation>;
  /** Native persistent environment mounted for this run, when configured. */
  readonly workingEnvironment?: WorkingEnvironment;
  /** Guarded VFS handle for host-side handlers and layers. */
  readonly vfs?: FoundryVfsHandle;
  /** Native Glove REPL session mounted for this run, when configured. */
  readonly repl?: FoundryMountedRepl;
  readonly invoke: (name: string, input: unknown) => Promise<unknown>;
}
export interface AgentHandlerContext<TInput = unknown>
  extends FoundryExecutionContext<TInput> {
  readonly defaultRun: () => Promise<unknown>;
  /** @deprecated Use defaultRun. */
  readonly defaultHandler: () => Promise<unknown>;
  readonly spawn: (message?: FoundryMessageInput) => Promise<unknown>;
}

export type FoundryResolver<T, TInput> =
  | T
  | ((
      agent: FoundryAgentDefinition,
      context: AgentAssemblyContext<TInput>,
    ) => Resolvable<T>);

export type FoundryListResolver<T, TInput> = FoundryResolver<ReadonlyArray<T>, TInput>;

export interface AgentAssemblyOptions<TInput = unknown> {
  readonly model?: FoundryResolver<ModelAdapter, TInput>;
  readonly systemPrompt?: FoundryResolver<string, TInput>;
  readonly displayManager?: FoundryResolver<DisplayManagerAdapter, TInput>;
  readonly serverMode?: boolean;
  readonly maxRetries?: number;
  readonly maxConsecutiveErrors?: number;
  readonly compactionLimit?: FoundryResolver<number, TInput>;
  readonly compactionInstructions?: FoundryResolver<string, TInput>;
  readonly maxTurns?: FoundryResolver<number, TInput>;
  readonly enableToolResultSummary?: boolean;
  readonly tools?: FoundryListResolver<GloveFoldArgs<any>, TInput>;
  readonly hooks?: FoundryListResolver<FoundryHookDefinition, TInput>;
  readonly skills?: FoundryListResolver<DefineSkillArgs, TInput>;
  readonly subagents?: FoundryListResolver<DefineSubAgentArgs, TInput>;
  /** Definition-owned Glove memory surfaces; may resolve lazily from run context. */
  readonly memory?: FoundryListResolver<FoundryMemorySelection, TInput>;
  /** Lazily load native Glove inbox items into this run's conversation store. */
  readonly inboxes?: (
    agent: FoundryAgentDefinition,
    context: AgentAssemblyContext<TInput>,
  ) => Resolvable<ReadonlyArray<InboxItem>>;
  readonly subscribers?: FoundryListResolver<
    FoundrySubscriberSelection | SubscriberAdapter,
    TInput
  >;
  readonly layers?: FoundryListResolver<FoundryLayerSelection, TInput>;
  readonly calls?: FoundryListResolver<FoundryCall<any, any>, TInput>;
  /** Agent-local desired schedules, resolved lazily for the current instance and message. */
  readonly schedules?: FoundryListResolver<FoundryScheduleDefinition, TInput>;
  /** Runtime policy composed from transmission primitives and persisted on the instance. */
  readonly playbooks?: FoundryListResolver<ComposedAgentPlaybook, TInput>;
  readonly mesh?: FoundryResolver<FoundryMeshConfig | undefined, TInput>;
  /** Sandboxed persistent files + named script execution, assembled per context. */
  readonly workingEnvironment?: FoundryResolver<
    FoundryWorkingEnvironmentDefinition | undefined,
    TInput
  >;
  /** One native Glove JavaScript, Python, or Lisp REPL mounted for this run. */
  readonly repl?: FoundryResolver<FoundryReplDefinition | undefined, TInput>;
  /** Mount any adapter-backed native surface after lazy assembly. */
  readonly configure?: (
    agent: IGloveRunnable,
    context: FoundryExecutionContext<TInput>,
  ) => Resolvable<void>;
  /** Final transformation of the assembled runnable. Returning undefined keeps it. */
  readonly build?: (
    agent: IGloveRunnable,
    context: AgentAssemblyContext<TInput>,
  ) => Resolvable<IGloveRunnable | undefined>;
  /** Construct a layered S2S/S2V/custom execution for one message. */
  readonly spawn?: (
    agent: IGloveRunnable,
    context: FoundryExecutionContext<TInput>,
    message: FoundryMessageInput,
  ) => Resolvable<unknown>;
  /** Own request execution. Omit it to use spawn, then Glove's normal loop. */
  readonly run?: (
    agent: IGloveRunnable,
    context: AgentHandlerContext<TInput>,
  ) => Resolvable<unknown>;
  /** @deprecated Use run. */
  readonly handler?: (
    context: AgentHandlerContext<TInput>,
  ) => Resolvable<unknown>;
}

export interface FoundryMeshConfig {
  readonly adapter: MeshAdapter;
  readonly identity?: Omit<AgentIdentity, "id"> & { readonly id?: string };
}

export interface DefineAgentOptions extends AgentAssemblyOptions<FoundryRequest> {
  /** @deprecated File-routed agents derive identity from agents/<route>/agent.ts. */
  readonly id?: string;
  readonly description: string;
  readonly tags?: readonly string[];
  /** Colocated catalogue of parts this definition allows its instances to use. */
  readonly components?: FoundryAgentComposition;
  /** Agent-local MCP state/auth seam. Foundry never acquires or refreshes credentials. */
  readonly mcpAdapter?: McpAdapterFactory;
  /** Agent-local account-session seam for application contribution factories. */
  readonly accountSessions?: FoundryAccountSessionAdapter;
  readonly store?: (context: {
    readonly definitionId: string;
    readonly agentId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
  }) => Promise<StoreAdapter> | StoreAdapter;
}

export type FoundryAgentDefinition = Readonly<DefineAgentOptions> & {
  readonly id: string;
  readonly [FOUNDRY_AGENT_DEFINITION_BRAND]: true;
};

export type FoundryAgent = FoundryAgentDefinition;
export type AnyFoundryAgent = FoundryAgentDefinition;

export interface FoundryAgentConventionModule {
  readonly default?: unknown;
  /** @deprecated Named convention modules also derive identity from their file route. */
  readonly id?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly components?: FoundryAgentComposition;
  readonly mcpAdapter?: McpAdapterFactory;
  readonly accountSessions?: FoundryAccountSessionAdapter;
  readonly store?: DefineAgentOptions["store"];
  readonly model?: AgentAssemblyOptions["model"];
  readonly systemPrompt?: AgentAssemblyOptions["systemPrompt"];
  readonly displayManager?: AgentAssemblyOptions["displayManager"];
  readonly serverMode?: boolean;
  readonly maxRetries?: number;
  readonly maxConsecutiveErrors?: number;
  readonly compactionLimit?: AgentAssemblyOptions["compactionLimit"];
  readonly compactionInstructions?: AgentAssemblyOptions["compactionInstructions"];
  readonly maxTurns?: AgentAssemblyOptions["maxTurns"];
  readonly enableToolResultSummary?: boolean;
  readonly tools?: AgentAssemblyOptions["tools"];
  readonly hooks?: AgentAssemblyOptions["hooks"];
  readonly skills?: AgentAssemblyOptions["skills"];
  readonly subagents?: AgentAssemblyOptions["subagents"];
  readonly memory?: AgentAssemblyOptions["memory"];
  readonly inboxes?: AgentAssemblyOptions["inboxes"];
  readonly subscribers?: AgentAssemblyOptions["subscribers"];
  readonly layers?: AgentAssemblyOptions["layers"];
  readonly calls?: AgentAssemblyOptions["calls"];
  readonly schedules?: AgentAssemblyOptions["schedules"];
  readonly playbooks?: AgentAssemblyOptions["playbooks"];
  readonly mesh?: AgentAssemblyOptions["mesh"];
  readonly workingEnvironment?: AgentAssemblyOptions["workingEnvironment"];
  readonly repl?: AgentAssemblyOptions["repl"];
  readonly configure?: AgentAssemblyOptions["configure"];
  readonly build?: AgentAssemblyOptions["build"];
  readonly spawn?: AgentAssemblyOptions["spawn"];
  readonly run?: AgentAssemblyOptions["run"];
  readonly handler?: AgentAssemblyOptions["handler"];
}

/** Agent definitions do not own transport schemas. Calls can still be typed with defineCall. */
export type InferAgentInput<_TAgent> = unknown;
export type InferAgentOutput<_TAgent> = unknown;

const ROUTE_PATTERN = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

export function assertAgentRoute(route: string): void {
  if (!ROUTE_PATTERN.test(route)) {
    throw new Error(
      `Invalid Foundry agent id "${route}". Use lowercase path segments containing letters, digits, and hyphens.`,
    );
  }
  if (route.includes("__")) {
    throw new Error(`Invalid Foundry agent id "${route}": "__" is reserved.`);
  }
}

export function internalAgentName(route: string): string {
  assertAgentRoute(route);
  return `foundry_${route.replaceAll("/", "__").replaceAll("-", "_")}`;
}

export function routeFromInternalAgentName(name: string): string {
  if (!name.startsWith("foundry_")) return name;
  return name.slice("foundry_".length).replaceAll("__", "/").replaceAll("_", "-");
}

export function isFoundryAgentDefinition(value: unknown): value is FoundryAgentDefinition {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[FOUNDRY_AGENT_DEFINITION_BRAND] === true,
  );
}

export const isFoundryAgent = isFoundryAgentDefinition;

function validateDefinition(options: DefineAgentOptions, route?: string): void {
  const id = route ?? options.id;
  if (id) assertAgentRoute(id);
  if (!options.model && !options.run && !options.handler && !options.spawn) {
    throw new Error(`Foundry agent "${id ?? "<file route>"}" must define model, run, handler, or spawn.`);
  }
  if (options.model && options.systemPrompt === undefined) {
    throw new Error(`Foundry agent "${id ?? "<file route>"}" must define systemPrompt when it defines a model.`);
  }
  if (options.inboxes !== undefined && typeof options.inboxes !== "function") {
    throw new Error(
      `Foundry agent "${id ?? "<file route>"}" inboxes must be a lazy resolver function.`,
    );
  }
  const forbidden = ["input", "output"] as const;
  for (const key of forbidden) {
    if (key in options) {
      throw new Error(`Foundry agent "${id ?? "<file route>"}" cannot define ${key}; invocation contracts are framework-owned.`);
    }
  }
}

/** Pure data helper. It never creates or registers an execution job. */
export function defineAgent(options: DefineAgentOptions): FoundryAgentDefinition {
  validateDefinition(options);
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    tags: Object.freeze([...(options.tags ?? [])]),
    [FOUNDRY_AGENT_DEFINITION_BRAND]: true as const,
  }, "agent", id));
}

const CONVENTION_EXPORTS = [
  "id", "description", "tags", "components", "mcpAdapter",
  "accountSessions", "store", "model", "systemPrompt",
  "displayManager", "serverMode", "maxRetries", "maxConsecutiveErrors",
  "compactionLimit", "compactionInstructions", "maxTurns",
  "enableToolResultSummary", "tools", "hooks", "skills", "subagents",
  "memory", "inboxes", "subscribers", "layers", "calls", "schedules", "playbooks", "mesh",
  "workingEnvironment", "repl", "configure", "build",
  "spawn", "run", "handler",
] as const;

/** Normalize either `export default defineAgent(...)` or named convention exports. */
export function defineAgentFromModule(
  route: string,
  module: FoundryAgentConventionModule,
): FoundryAgentDefinition {
  assertAgentRoute(route);
  if (isFoundryAgentDefinition(module.default)) {
    const definition = module.default;
    bindFileIdentity(definition, route, "agent");
    validateDefinition(definition, route);
    return definition;
  }
  if (!module.description) {
    throw new Error(`Foundry route "${route}" must default-export defineAgent(...) or export description.`);
  }
  const options: Record<string, unknown> = {};
  for (const key of CONVENTION_EXPORTS) {
    if (module[key] !== undefined) options[key] = module[key];
  }
  const definition = defineAgent(options as unknown as DefineAgentOptions);
  bindFileIdentity(definition, route, "agent");
  return definition;
}

export interface DefineFoundrySubagentOptions {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: ModelAdapter;
  readonly durable?: boolean;
  readonly serverMode?: boolean;
  readonly maxRetries?: number;
  readonly maxConsecutiveErrors?: number;
  readonly compactionLimit?: number;
  readonly compactionInstructions?: string;
  readonly maxTurns?: number;
  readonly enableToolResultSummary?: boolean;
  readonly tools?: ReadonlyArray<GloveFoldArgs<any>>;
  readonly hooks?: ReadonlyArray<FoundryHookDefinition>;
  readonly skills?: ReadonlyArray<DefineSkillArgs>;
  readonly subagents?: ReadonlyArray<DefineSubAgentArgs>;
  readonly layers?: ReadonlyArray<FoundryLayer<any>>;
  readonly subscribers?: ReadonlyArray<FoundrySubscriber | SubscriberAdapter>;
  readonly configure?: (context: FoundrySurfaceContext<string>) => Resolvable<void>;
}

export function defineSubagent(options: DefineFoundrySubagentOptions): DefineSubAgentArgs {
  if (!/^[A-Za-z][\w-]*$/.test(options.name)) throw new Error(`Invalid Foundry subagent name "${options.name}".`);
  return Object.freeze({
    name: options.name,
    description: options.description,
    factory: async ({ parentStore, parentControls, prompt }: SubAgentFactoryContext) => {
      const store = (await parentStore.createSubAgentStore?.(options.name, options.durable ?? false)) ?? undefined;
      const glove = new Glove({
        ...(store ? { store } : {}),
        model: options.model ?? parentControls.glove.model,
        displayManager: parentControls.displayManager ?? new Displaymanager(),
        systemPrompt: options.systemPrompt,
        serverMode: options.serverMode ?? parentControls.glove.serverMode,
        ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
        ...(options.maxConsecutiveErrors !== undefined ? { maxConsecutiveErrors: options.maxConsecutiveErrors } : {}),
        compaction_config: {
          compaction_instructions: options.compactionInstructions ?? `Preserve the ${options.name} subagent's findings and unresolved work.`,
          ...(options.maxTurns !== undefined ? { max_turns: options.maxTurns } : {}),
          ...(options.compactionLimit !== undefined ? { compaction_context_limit: options.compactionLimit } : {}),
        },
        ...(options.enableToolResultSummary !== undefined ? { enableToolResultSummary: options.enableToolResultSummary } : {}),
      }).build();
      for (const tool of options.tools ?? []) glove.fold(tool);
      for (const hook of options.hooks ?? []) glove.defineHook(hook.name, hook.handler);
      for (const skill of options.skills ?? []) glove.defineSkill(skill);
      for (const subagent of options.subagents ?? []) glove.defineSubAgent(subagent);
      if (options.configure) {
        const message: Message = { sender: "user", text: prompt };
        const request: FoundryRequest = {
          agentId: options.name,
          conversationId: `subagent:${options.name}`,
          workspaceId: "subagent",
          message: prompt,
          source: { kind: "spawn" },
        };
        await resolveResolvable(options.configure({
          definitionId: options.name,
          agentId: options.name,
          conversationId: request.conversationId,
          workspaceId: request.workspaceId,
          runId: `subagent:${options.name}`,
          input: prompt,
          request,
          message,
          messageInput: prompt,
          messageText: prompt,
          history: [],
          messages: [message],
          glove,
          signal: new AbortController().signal,
          emit: () => undefined,
        }));
      }
      return glove;
    },
  });
}

export async function resolveResolvable<T>(value: Resolvable<T>): Promise<T> {
  if (Effect.isEffect(value)) return Effect.runPromise(value as Effect.Effect<T, unknown, never>);
  return Promise.resolve(value as T | Promise<T>);
}

export type FoundryRouteMap = Record<string, object>;
export function defineRoutes<const TRoutes extends FoundryRouteMap>(routes: TRoutes): TRoutes {
  return Object.freeze({ ...routes });
}
