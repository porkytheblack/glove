import { Effect } from "effect";
import type {
  GloveFoldArgs,
  IGloveRunnable,
  Message,
  StoreAdapter,
} from "glove-core";
import type {
  McpAdapter,
  McpCatalogueEntry,
  McpToolDef,
  MountedMcpToolSet,
} from "glove-mcp";
import { connectMcpEntry, mountMcp, mountMcpToolSet } from "glove-mcp";
import type {
  ContextAdapter,
  EntityMemoryAdapter,
  EpisodicMemoryAdapter,
  ResourceFsAdapter,
} from "glove-memory";
import {
  useContext,
  useEpisodicCurator,
  useEpisodicReader,
  useMemoryCurator,
  useMemoryReader,
  useResourcesCurator,
  useResourcesReader,
  type MemoryToolOptions,
} from "glove-memory/tools";
import { z } from "zod";
import type { AnyFoundryTransmission } from "./integration.js";
import type { AccountReference } from "./domain.js";
import type { FoundryApplicationConnection } from "./connection.js";
import type { FoundryMessageInput, FoundryRequest } from "./primitives.js";
import {
  fileDefinitionKey,
  fileIdentified,
} from "./identity.js";

export const FOUNDRY_SHARED_TOOL_BRAND = Symbol.for(
  "glove-foundry-shared-tool",
);
export const FOUNDRY_AGENT_APPLICATION_BRAND = Symbol.for(
  "glove-foundry-agent-application",
);
export const FOUNDRY_MCP_BRAND = Symbol.for("glove-foundry-mcp");
export const FOUNDRY_MEMORY_BRAND = Symbol.for("glove-foundry-memory");

export type AgentInstallationKind =
  | "tool"
  | "application"
  | "mcp";

export type FoundryCapabilityKind =
  | AgentInstallationKind
  | "memory";

export interface AgentInstallation {
  readonly kind: AgentInstallationKind;
  readonly id: string;
  /** Durable account selection; code authoring supplies this through an AccountReference. */
  readonly accountId?: string;
  readonly config?: unknown;
}

export type FoundryInstallable =
  | FoundrySharedTool<any>
  | FoundryAgentApplication
  | FoundryMcp;

/** Create persisted installation data from a code definition. */
export type DefinitionConfigInput<TDefinition> =
  TDefinition extends { readonly config?: infer TSchema }
    ? TSchema extends z.ZodType ? z.input<TSchema> : never
    : never;

export interface InstallationSelection {
  readonly account?: AccountReference;
}

export function install<TDefinition extends FoundryInstallable>(
  capability: TDefinition,
  ...configuration: [DefinitionConfigInput<TDefinition>] extends [never]
    ? [config?: never, selection?: InstallationSelection]
    : [config: DefinitionConfigInput<TDefinition>, selection?: InstallationSelection]
): AgentInstallation {
  const config = configuration[0];
  const selection = configuration[1];
  const kind: AgentInstallationKind =
    FOUNDRY_SHARED_TOOL_BRAND in capability
      ? "tool"
      : FOUNDRY_AGENT_APPLICATION_BRAND in capability
        ? "application"
        : "mcp";
  const installation = {
    kind,
    ...(config !== undefined ? { config } : {}),
  } as AgentInstallation & Record<string, unknown>;
  Object.defineProperty(installation, "id", {
    enumerable: true,
    get: () => capability.id,
  });
  if (selection?.account) {
    Object.defineProperty(installation, "accountId", {
      enumerable: true,
      get: () => selection.account!.id,
    });
  }
  return Object.freeze(installation);
}

export function installationKey(installation: AgentInstallation): string {
  return `${installation.kind}:${installation.id}`;
}

function assertCapabilityId(id: string, label: string): void {
  if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(id)) {
    throw new Error(
      `Invalid Foundry ${label} id "${id}". Use lowercase path segments containing letters, digits, and hyphens.`,
    );
  }
}

interface AgentMountBaseContext {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly input: unknown;
  readonly request: FoundryRequest;
  readonly message: Message;
  readonly messageInput: FoundryMessageInput;
  readonly messageText: string;
  readonly history: ReadonlyArray<Message>;
  readonly messages: ReadonlyArray<Message>;
  readonly glove: IGloveRunnable;
  readonly store: StoreAdapter;
  readonly emit: (event: { type: string; data?: unknown }) => void;
}

export interface AgentInstallContext<TConfig = unknown> extends AgentMountBaseContext {
  readonly installation: AgentInstallation;
  readonly config: TConfig;
  readonly accountId?: string;
  readonly withAccountSession?: <A>(
    operation: string,
    use: (session: unknown) => Effect.Effect<A, unknown, never>,
  ) => Effect.Effect<A, unknown, never>;
}

export interface AgentDefinitionSurfaceContext extends AgentMountBaseContext {
  readonly surface: {
    readonly kind: "memory";
    readonly id: string;
  };
  readonly config: unknown;
}

/** Pure application-definition context. It deliberately exposes no Glove. */
export type AgentApplicationInstallContext<TConfig = unknown> = Omit<
  AgentInstallContext<TConfig>,
  "glove" | "store"
>;

export interface AgentApplicationContribution {
  /** Tools Foundry will mount after the installer returns. */
  readonly tools?: ReadonlyArray<GloveFoldArgs<any>>;
}

interface ConfiguredCapability<
  TConfigSchema extends z.ZodType | undefined = z.ZodType | undefined,
> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description: string;
  readonly config?: TConfigSchema;
}

function decodeCapabilityConfig(
  definition: ConfiguredCapability,
  installation: { readonly kind: FoundryCapabilityKind; readonly id: string; readonly config?: unknown },
): unknown {
  if (!definition.config) return installation.config;
  const parsed = definition.config.safeParse(installation.config ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid config for ${installation.kind} "${definition.id}": ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export type SharedToolOptions<
  TInput = unknown,
  TConfigSchema extends z.ZodType | undefined = undefined,
> = ConfiguredCapability<TConfigSchema> &
  (
    | {
        readonly tool: GloveFoldArgs<TInput>;
        readonly create?: never;
      }
    | {
        readonly tool?: never;
        readonly create: (
          context: AgentInstallContext<
            TConfigSchema extends z.ZodType ? z.output<TConfigSchema> : unknown
          >,
        ) => Effect.Effect<GloveFoldArgs<TInput>, unknown, never>;
      }
  );

export type FoundrySharedTool<
  TInput = unknown,
  TConfigSchema extends z.ZodType | undefined = any,
> = Readonly<
  SharedToolOptions<TInput, TConfigSchema>
> & {
  readonly id: string;
  readonly [FOUNDRY_SHARED_TOOL_BRAND]: true;
};

export function defineSharedTool<
  TInput,
  const TConfigSchema extends z.ZodType | undefined = undefined,
>(
  options: SharedToolOptions<TInput, TConfigSchema>,
): FoundrySharedTool<TInput, TConfigSchema> {
  if (options.id) assertCapabilityId(options.id, "shared tool");
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_SHARED_TOOL_BRAND]: true as const,
  }, "tool", id));
}

/** What an installed app does with one of its MCP server's tools. */
export type FoundryAppToolDecision = "allow" | "ask" | "hide";

/** One tool on an app's MCP server, as the app's tool policy sees it. */
export interface FoundryAppMcpTool {
  /** The tool's name on the server. */
  readonly name: string;
  readonly description?: string;
  /** The server marks the tool read-only. */
  readonly readOnly: boolean;
  /** The server marks the tool destructive. */
  readonly destructive: boolean;
}

/**
 * Back an app with an MCP server. The app stays the unit a person connects:
 * the server's tools reach the agent through the app, opened with the
 * installation's account and filtered by the app's tool policy.
 */
export interface FoundryAppMcp<TConfig = unknown> {
  /** Where the server is: a static entry, or one resolved from the installation. */
  readonly entry:
    | McpCatalogueEntryWithoutId
    | ((
        context: AgentApplicationInstallContext<TConfig>,
      ) =>
        | McpCatalogueEntryWithoutId
        | Promise<McpCatalogueEntryWithoutId>
        | Effect.Effect<McpCatalogueEntryWithoutId, unknown, never>);
  /**
   * Turn the installation's account session into credentials for the
   * connection: HTTP headers for an HTTP server, environment variables for a
   * stdio one. It runs inside the agent's `accountSessions` boundary, so
   * Foundry never holds the credential. Omit it for a server that needs none.
   */
  readonly auth?: (
    session: unknown,
    context: AgentApplicationInstallContext<TConfig>,
  ) => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Decide each tool: run it, ask the person first, or leave it out. The
   * default runs read-only tools and asks before everything else.
   */
  readonly tools?: (
    tool: FoundryAppMcpTool,
    context: AgentApplicationInstallContext<TConfig>,
  ) => FoundryAppToolDecision;
}

/** One installed app and the tools it mounted for this run. */
export interface FoundryInstalledApp {
  readonly id: string;
  readonly description: string;
  readonly accountId?: string;
  /** The app's live tool names, with whether each only reads. */
  readonly tools: ReadonlyArray<{ readonly name: string; readonly readOnly?: boolean }>;
}

export interface AgentApplicationOptions<
  TConfigSchema extends z.ZodType | undefined = undefined,
> extends ConfiguredCapability<TConfigSchema> {
  /** Tools from an MCP server, connected with the installation's account. */
  readonly mcp?: FoundryAppMcp<
    TConfigSchema extends z.ZodType ? z.output<TConfigSchema> : unknown
  >;
  /** Inbound transmission mechanisms owned by this application. */
  readonly inbound?: ReadonlyArray<AnyFoundryTransmission>;
  /** Outbound transmission mechanisms mounted as tools when installed. */
  readonly outbound?: ReadonlyArray<AnyFoundryTransmission>;
  /** Mixed/bidirectional definitions; prefer inbound/outbound for clarity. */
  readonly transmissions?: ReadonlyArray<AnyFoundryTransmission>;
  /** Purpose-built long-lived provider connections for inbound transmissions. */
  readonly connections?: ReadonlyArray<FoundryApplicationConnection>;
  readonly install?: (
    context: AgentApplicationInstallContext<
      TConfigSchema extends z.ZodType ? z.output<TConfigSchema> : unknown
    >,
  ) => Effect.Effect<AgentApplicationContribution | void, unknown, never>;
}

export type FoundryAgentApplication<
  TConfigSchema extends z.ZodType | undefined = any,
> = Readonly<AgentApplicationOptions<TConfigSchema>> & {
  readonly id: string;
  readonly [FOUNDRY_AGENT_APPLICATION_BRAND]: true;
};

export function defineAgentApplication<
  const TConfigSchema extends z.ZodType | undefined = undefined,
>(
  options: AgentApplicationOptions<TConfigSchema>,
): FoundryAgentApplication<TConfigSchema> {
  if (options.id) assertCapabilityId(options.id, "agent application");
  const label = options.id ?? "<application file route>";
  if (options.mcp && (!options.mcp.entry || !["object", "function"].includes(typeof options.mcp.entry))) {
    throw new Error(`Application "${label}" declares mcp without an entry.`);
  }
  const inbound = Object.freeze([...(options.inbound ?? [])]);
  const outbound = Object.freeze([...(options.outbound ?? [])]);
  for (const transmission of inbound) {
    if (!transmission.inbound) {
      throw new Error(
        `Application "${label}" declares an outbound-only transmission as inbound.`,
      );
    }
  }
  for (const transmission of outbound) {
    if (!transmission.outbound) {
      throw new Error(
        `Application "${label}" declares an inbound-only transmission as outbound.`,
      );
    }
  }
  const transmissionDefinitions = new Map<object | string, AnyFoundryTransmission>();
  for (const transmission of [
    ...(options.transmissions ?? []),
    ...inbound,
    ...outbound,
  ]) {
    const key = fileDefinitionKey(transmission);
    const existing = transmissionDefinitions.get(key);
    if (!existing) transmissionDefinitions.set(key, transmission);
  }
  const transmissions = Object.freeze([...transmissionDefinitions.values()]);
  const connections = Object.freeze([...(options.connections ?? [])]);
  const connectionIds = new Set<object | string>();
  for (const connection of connections) {
    const connectionKey = fileDefinitionKey(connection);
    if (connectionIds.has(connectionKey)) {
      throw new Error(`Application "${label}" contains the same connection more than once.`);
    }
    connectionIds.add(connectionKey);
    for (const transmission of connection.transmissions) {
      if (!transmissionDefinitions.has(fileDefinitionKey(transmission))) {
        throw new Error(
          `Application "${label}" contains a connection for a transmission it does not own.`,
        );
      }
    }
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    inbound,
    outbound,
    transmissions,
    connections,
    [FOUNDRY_AGENT_APPLICATION_BRAND]: true as const,
  }, "application", id));
}

/** Concise authoring name for an agent-local application definition. */
export const defineApp = defineAgentApplication;
export type FoundryApp = FoundryAgentApplication;

export interface FoundryMcpOptions<
  TConfigSchema extends z.ZodType | undefined = undefined,
> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description?: string;
  readonly config?: TConfigSchema;
  /**
   * Static catalogue metadata or a lazy, instance-configured resolver.
   *
   * The resolver receives decoded installation data but never credentials.
   * Auth remains the responsibility of the agent-owned `mcpAdapter` and is
   * resolved only when glove-mcp opens a connection.
   */
  readonly entry:
    | McpCatalogueEntryWithoutId
    | ((
        context: AgentApplicationInstallContext<
          TConfigSchema extends z.ZodType ? z.output<TConfigSchema> : unknown
        >,
      ) =>
        | McpCatalogueEntryWithoutId
        | Promise<McpCatalogueEntryWithoutId>
        | Effect.Effect<McpCatalogueEntryWithoutId, unknown, never>);
}

type McpCatalogueEntryWithoutId = McpCatalogueEntry extends infer Entry
  ? Entry extends unknown ? Omit<Entry, "id"> : never
  : never;

function identifyMcpEntry(entry: McpCatalogueEntryWithoutId, id: string): McpCatalogueEntry {
  if (entry.transport) return { ...entry, id };
  return { ...entry, id, url: entry.url };
}

export type FoundryMcp<
  TConfigSchema extends z.ZodType | undefined = any,
> = Readonly<FoundryMcpOptions<TConfigSchema>> & {
  readonly id: string;
  readonly [FOUNDRY_MCP_BRAND]: true;
};

export function defineMcp<
  const TConfigSchema extends z.ZodType | undefined = undefined,
>(options: FoundryMcpOptions<TConfigSchema>): FoundryMcp<TConfigSchema> {
  if (options.id) assertCapabilityId(options.id, "MCP");
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_MCP_BRAND]: true as const,
  }, "mcp", id));
}

type MemoryAdapterFactory<A> = (
  context: AgentDefinitionSurfaceContext,
) => Effect.Effect<A, unknown, never>;

interface MemorySurfaceOptions {
  readonly access?: "reader" | "curator";
  readonly tools?: MemoryToolOptions["tools"];
}

export interface FoundryMemoryProfileOptions<
  TConfigSchema extends z.ZodType | undefined = undefined,
> extends ConfiguredCapability<TConfigSchema> {
  readonly entity?: MemorySurfaceOptions & {
    readonly adapter: MemoryAdapterFactory<EntityMemoryAdapter>;
  };
  readonly episodic?: MemorySurfaceOptions & {
    readonly adapter: MemoryAdapterFactory<EpisodicMemoryAdapter>;
  };
  readonly resources?: MemorySurfaceOptions & {
    readonly adapter: MemoryAdapterFactory<ResourceFsAdapter>;
  };
  /** Ambient context remains on the main agent, matching glove-memory. */
  readonly context?: {
    readonly adapter: MemoryAdapterFactory<ContextAdapter>;
    readonly tools?: MemoryToolOptions["tools"];
  };
  /** Escape hatch for subagent-delegated or application-specific composition. */
  readonly mount?: (
    context: AgentDefinitionSurfaceContext,
  ) => Effect.Effect<void, unknown, never>;
}

export type FoundryMemoryProfile<
  TConfigSchema extends z.ZodType | undefined = any,
> = Readonly<FoundryMemoryProfileOptions<TConfigSchema>> & {
  readonly id: string;
  readonly [FOUNDRY_MEMORY_BRAND]: true;
};

export function defineMemory<
  const TConfigSchema extends z.ZodType | undefined = undefined,
>(
  options: FoundryMemoryProfileOptions<TConfigSchema>,
): FoundryMemoryProfile<TConfigSchema> {
  if (options.id) assertCapabilityId(options.id, "memory profile");
  if (
    !options.entity &&
    !options.episodic &&
    !options.resources &&
    !options.context &&
    !options.mount
  ) {
    throw new Error(`Foundry memory profile "${options.id ?? "<file route>"}" is empty.`);
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_MEMORY_BRAND]: true as const,
  }, "memory", id));
}

export interface FoundryCapabilityRegistry {
  readonly tools: ReadonlyArray<FoundrySharedTool<any>>;
  readonly applications: ReadonlyArray<FoundryAgentApplication>;
  readonly mcp: ReadonlyArray<FoundryMcp>;
  readonly memory: ReadonlyArray<FoundryMemoryProfile>;
}

export interface FoundryCapabilityManifestEntry {
  readonly id: string;
  readonly kind: FoundryCapabilityKind;
  readonly description: string;
  readonly ownership: "instance" | "definition";
  readonly file?: string;
}

export interface FoundryCapabilityManifest {
  readonly tools: ReadonlyArray<FoundryCapabilityManifestEntry>;
  readonly applications: ReadonlyArray<FoundryCapabilityManifestEntry>;
  readonly mcp: ReadonlyArray<FoundryCapabilityManifestEntry>;
  readonly memory: ReadonlyArray<FoundryCapabilityManifestEntry>;
}

export const EMPTY_CAPABILITY_REGISTRY: FoundryCapabilityRegistry =
  Object.freeze({
    tools: Object.freeze([]),
    applications: Object.freeze([]),
    mcp: Object.freeze([]),
    memory: Object.freeze([]),
  });

export interface McpAdapterFactory {
  (
    context: Omit<AgentInstallContext, "installation" | "config"> & {
      readonly installed: ReadonlyArray<FoundryMcp>;
      /** Fully decoded, per-instance MCP selections for this assembly. */
      readonly resolved: ReadonlyArray<FoundryResolvedMcp>;
    },
  ): Effect.Effect<McpAdapter, unknown, never>;
}

export interface FoundryResolvedMcp {
  readonly definition: FoundryMcp;
  readonly installation: AgentInstallation;
  readonly config: unknown;
  readonly entry: McpCatalogueEntry;
}

function inboxMethods(store: StoreAdapter): boolean {
  return (
    typeof store.getInboxItems === "function" &&
    typeof store.addInboxItem === "function" &&
    typeof store.updateInboxItem === "function" &&
    typeof store.getResolvedInboxItems === "function"
  );
}

export function isInboxCapableStore(
  store: StoreAdapter,
): store is StoreAdapter &
  Required<
    Pick<
      StoreAdapter,
      | "getInboxItems"
      | "addInboxItem"
      | "updateInboxItem"
      | "getResolvedInboxItems"
    >
  > {
  return inboxMethods(store);
}

function indexRegistry<T extends { readonly id: string }>(
  values: ReadonlyArray<T>,
  kind: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) {
      throw new Error(`Duplicate Foundry ${kind} id "${value.id}".`);
    }
    result.set(value.id, value);
  }
  return result;
}

function mountMemory(
  profile: FoundryMemoryProfile,
  context: AgentDefinitionSurfaceContext,
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    if (profile.entity) {
      const adapter = yield* profile.entity.adapter(context);
      const options = profile.entity.tools
        ? { tools: profile.entity.tools }
        : undefined;
      if ((profile.entity.access ?? "reader") === "curator") {
        useMemoryCurator(context.glove, adapter, options);
      } else {
        useMemoryReader(context.glove, adapter, options);
      }
    }
    if (profile.episodic) {
      const adapter = yield* profile.episodic.adapter(context);
      const options = profile.episodic.tools
        ? { tools: profile.episodic.tools }
        : undefined;
      if ((profile.episodic.access ?? "reader") === "curator") {
        useEpisodicCurator(context.glove, adapter, options);
      } else {
        useEpisodicReader(context.glove, adapter, options);
      }
    }
    if (profile.resources) {
      const adapter = yield* profile.resources.adapter(context);
      const options = profile.resources.tools
        ? { tools: profile.resources.tools }
        : undefined;
      if ((profile.resources.access ?? "reader") === "curator") {
        useResourcesCurator(context.glove, adapter, options);
      } else {
        useResourcesReader(context.glove, adapter, options);
      }
    }
    if (profile.context) {
      const adapter = yield* profile.context.adapter(context);
      useContext(
        context.glove,
        adapter,
        profile.context.tools ? { tools: profile.context.tools } : undefined,
      );
    }
    if (profile.mount) yield* profile.mount(context);
  });
}

export interface FoundryMemoryReference<
  TProfile extends FoundryMemoryProfile<any> = FoundryMemoryProfile<any>,
> {
  readonly profile: TProfile;
  readonly config: DefinitionConfigInput<TProfile>;
}

export type FoundryMemorySelection =
  | FoundryMemoryProfile
  | FoundryMemoryReference;

/** Select a configured memory profile with schema-inferred input. */
export function configureMemory<TProfile extends FoundryMemoryProfile<any>>(
  profile: TProfile,
  config: DefinitionConfigInput<TProfile>,
): FoundryMemoryReference<TProfile> {
  return Object.freeze({ profile, config });
}

export interface MountAgentDefinitionMemoryOptions {
  readonly registry: FoundryCapabilityRegistry;
  readonly memory: ReadonlyArray<FoundryMemorySelection>;
  readonly context: Omit<AgentDefinitionSurfaceContext, "surface" | "config">;
}

/** Mount definition-owned memory surfaces for one assembled run. */
export function mountAgentDefinitionMemory(
  options: MountAgentDefinitionMemoryOptions,
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    const memory = indexRegistry(options.registry.memory, "memory profile");
    const seen = new Set<string>();

    for (const selection of options.memory) {
      const reference = "profile" in selection ? selection.profile : selection;
      const profile = memory.get(reference.id);
      if (!profile) {
        throw new Error(`Unknown agent memory profile "${reference.id}".`);
      }
      if (seen.has(`memory:${profile.id}`)) {
        throw new Error(`Duplicate agent memory profile "${profile.id}".`);
      }
      seen.add(`memory:${profile.id}`);
      const config = typeof selection === "object" && "profile" in selection
        ? selection.config
        : undefined;
      const capability = {
        kind: "memory" as const,
        id: profile.id,
        ...(config !== undefined ? { config } : {}),
      };
      const context: AgentDefinitionSurfaceContext = {
        ...options.context,
        surface: { kind: "memory", id: profile.id },
        config: decodeCapabilityConfig(profile, capability),
      };
      yield* mountMemory(profile, context);
      options.context.emit({
        type: "foundry.definition.memory.mounted",
        data: { id: profile.id },
      });
    }
  });
}

export interface InstallRegistryOptions {
  readonly registry: FoundryCapabilityRegistry;
  readonly installations: ReadonlyArray<AgentInstallation>;
  readonly context: Omit<AgentInstallContext, "installation" | "config">;
  readonly mcpAdapter?: McpAdapterFactory;
  readonly accountSessions?: FoundryAccountSessionAdapter;
  /** Receives each installed app and its tools. */
  readonly onApp?: (app: FoundryInstalledApp) => void;
  /** Receives work to do when the run ends, such as closing app connections. */
  readonly onCleanup?: (cleanup: () => Promise<void>) => void;
}

export interface FoundryAccountSessionAdapter {
  readonly identifier: string;
  withSession<A>(
    request: {
      readonly accountId: string;
      readonly operation: string;
      readonly agentId: string;
      readonly conversationId: string;
      readonly workspaceId: string;
    },
    use: (session: unknown) => Effect.Effect<A, unknown, never>,
  ): Effect.Effect<A, unknown, never>;
}

/** A tool name the model and every REPL language accept. */
function appNamespace(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

function mountAppMcp(
  application: FoundryAgentApplication,
  context: AgentApplicationInstallContext,
  options: InstallRegistryOptions,
): Effect.Effect<
  { readonly toolSet: MountedMcpToolSet; readonly readOnly: ReadonlyMap<string, boolean> },
  unknown,
  never
> {
  return Effect.gen(function* () {
    const spec = application.mcp!;
    if (spec.auth && !context.withAccountSession) {
      throw new Error(
        `App "${application.id}" connects with an account. Install it with an account and give the agent definition accountSessions.`,
      );
    }
    const source = typeof spec.entry === "function" ? spec.entry(context) : spec.entry;
    const resolved = Effect.isEffect(source)
      ? yield* source
      : source instanceof Promise
        ? yield* Effect.tryPromise({ try: () => source, catch: (cause) => cause })
        : source;
    const entry = identifyMcpEntry(resolved, appNamespace(application.id));
    const credentials = (): Promise<Record<string, string>> =>
      Effect.runPromise(context.withAccountSession!(
        "mcp:connect",
        (session) => Effect.tryPromise({
          try: async () => spec.auth!(session, context),
          catch: (cause) => cause,
        }),
      ));
    const adapter: McpAdapter = {
      identifier: `foundry-app:${application.id}`,
      getActive: async () => [entry.id],
      activate: async () => undefined,
      deactivate: async () => undefined,
      ...(spec.auth
        ? entry.transport?.kind === "stdio"
          ? { getStdioEnvironment: async () => credentials() }
          : { getAuthHeaders: async () => credentials() }
        : {}),
    };
    const decisions = new Map<string, { readonly decision: FoundryAppToolDecision; readonly readOnly: boolean }>();
    const decide = (tool: McpToolDef): boolean => {
      const described: FoundryAppMcpTool = {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        readOnly: tool.annotations?.readOnlyHint === true,
        destructive: tool.annotations?.destructiveHint === true,
      };
      const decision = spec.tools
        ? spec.tools(described, context)
        : described.readOnly ? "allow" : "ask";
      if (decision !== "allow" && decision !== "ask" && decision !== "hide") {
        throw new Error(
          `App "${application.id}" returned "${String(decision)}" for tool "${tool.name}". Return "allow", "ask" or "hide".`,
        );
      }
      decisions.set(`${entry.id}__${tool.name}`, { decision, readOnly: described.readOnly });
      return decision !== "hide";
    };
    const toolSet = yield* Effect.tryPromise({
      try: async () => {
        const connection = await connectMcpEntry({
          adapter,
          entry,
          clientInfo: { name: `glove-foundry:${application.id}`, version: "1" },
          filterTools: decide,
        });
        try {
          return await mountMcpToolSet({
            glove: options.context.glove,
            connection,
            entry,
            // Foundry's agents run in server mode, where bridged MCP tools would
            // never ask. The app's decision sets the approval instead.
            wrapTool: (tool) => {
              const decided = decisions.get(tool.name);
              return decided ? { ...tool, requiresPermission: decided.decision === "ask" } : tool;
            },
          });
        } catch (cause) {
          await connection.close().catch(() => undefined);
          throw cause;
        }
      },
      catch: (cause) => cause,
    });
    options.onCleanup?.(() => toolSet.dispose());
    options.context.emit({
      type: "foundry.application.mcp.mounted",
      data: { id: application.id, tools: toolSet.toolNames },
    });
    const readOnly = new Map<string, boolean>();
    for (const [name, decided] of decisions) readOnly.set(name, decided.readOnly);
    return { toolSet, readOnly };
  });
}

/** Install only explicitly selected capabilities onto a running Glove. */
export function installRegistry(
  options: InstallRegistryOptions,
): Effect.Effect<ReadonlyArray<AgentInstallation>, unknown, never> {
  return Effect.gen(function* () {
    const tools = indexRegistry(options.registry.tools, "shared tool");
    const applications = indexRegistry(
      options.registry.applications,
      "agent application",
    );
    const mcp = indexRegistry(options.registry.mcp, "MCP");
    const seen = new Set<string>();
    const installedMcp: FoundryResolvedMcp[] = [];
    const installed: AgentInstallation[] = [];

    for (const installation of options.installations) {
      assertCapabilityId(installation.id, installation.kind);
      if (
        installation.config &&
        typeof installation.config === "object" &&
        Object.prototype.hasOwnProperty.call(installation.config, "accountId")
      ) {
        throw new Error(
          `Installation config for ${installation.kind} "${installation.id}" cannot contain accountId. Select a persisted account on the installation, or pass { account } as install()'s third argument in code.`,
        );
      }
      const key = installationKey(installation);
      if (seen.has(key)) continue;
      seen.add(key);

      const definition =
        installation.kind === "tool"
          ? tools.get(installation.id)
          : installation.kind === "application"
            ? applications.get(installation.id)
            : mcp.get(installation.id);
      if (!definition) {
        throw new Error(
          `Agent "${options.context.agentId}" requests unknown ${installation.kind} "${installation.id}".`,
        );
      }
      const config = decodeCapabilityConfig(
        definition as ConfiguredCapability,
        installation,
      );
      const context: AgentInstallContext = {
        ...options.context,
        installation,
        config,
        ...(installation.accountId
          ? {
              accountId: installation.accountId,
              ...(options.accountSessions
                ? {
                    withAccountSession: <A>(operation: string, use: (session: unknown) => Effect.Effect<A, unknown, never>) =>
                      options.accountSessions!.withSession({
                        accountId: installation.accountId!,
                        operation,
                        agentId: options.context.agentId,
                        conversationId: options.context.conversationId,
                        workspaceId: options.context.workspaceId,
                      }, use),
                  }
                : {}),
            }
          : {}),
      };

      if (installation.kind === "tool") {
        const shared = definition as FoundrySharedTool<any>;
        const tool = shared.tool ?? (yield* shared.create(context));
        options.context.glove.fold(tool);
      } else if (installation.kind === "application") {
        const { glove: _glove, store: _store, ...headlessContext } = context;
        const application = definition as FoundryAgentApplication;
        const contribution = application.install
          ? yield* application.install(headlessContext)
          : undefined;
        for (const tool of contribution?.tools ?? []) options.context.glove.fold(tool);
        const mounted = application.mcp
          ? yield* mountAppMcp(application, headlessContext, options)
          : undefined;
        const ownTools = (contribution?.tools ?? []).map((tool) => ({ name: tool.name }));
        options.onApp?.(Object.freeze({
          id: application.id,
          description: application.description,
          ...(installation.accountId ? { accountId: installation.accountId } : {}),
          get tools() {
            return [
              ...ownTools,
              ...(mounted?.toolSet.toolNames ?? []).map((name) => ({
                name,
                readOnly: mounted?.readOnly.get(name) ?? true,
              })),
            ];
          },
        }));
      } else {
        const mcpDefinition = definition as FoundryMcp;
        const headlessContext: AgentApplicationInstallContext = (() => {
          const { glove: _glove, store: _store, ...headless } = context;
          return headless;
        })();
        const source = typeof mcpDefinition.entry === "function"
          ? mcpDefinition.entry(headlessContext)
          : mcpDefinition.entry;
        const entry = Effect.isEffect(source)
          ? yield* source
          : source instanceof Promise
            ? yield* Effect.tryPromise({ try: () => source, catch: (cause) => cause })
            : source;
        installedMcp.push({
          definition: mcpDefinition,
          installation,
          config,
          entry: identifyMcpEntry(entry, mcpDefinition.id),
        });
      }
      installed.push(installation);
      options.context.emit({
        type: "foundry.installation.completed",
        data: { kind: installation.kind, id: installation.id },
      });
    }

    if (installedMcp.length > 0) {
      if (!options.mcpAdapter) {
        throw new Error(
          `Agent "${options.context.agentId}" installs MCP capabilities but the application does not define mcpAdapter.`,
        );
      }
      const adapter = yield* options.mcpAdapter({
        ...options.context,
        installed: installedMcp.map(({ definition }) => definition),
        resolved: installedMcp,
      });
      const selectedIds = new Set(installedMcp.map(({ definition }) => definition.id));
      const scopedAdapter: McpAdapter = {
        identifier: adapter.identifier,
        getActive: async () => [...selectedIds],
        activate: (id) => adapter.activate(id),
        deactivate: (id) => adapter.deactivate(id),
        ...(adapter.getAccessToken
          ? { getAccessToken: (id: string) => adapter.getAccessToken!(id) }
          : {}),
        ...(adapter.getAuthHeaders
          ? { getAuthHeaders: (id: string) => adapter.getAuthHeaders!(id) }
          : {}),
        ...(adapter.getStdioEnvironment
          ? { getStdioEnvironment: (id: string) => adapter.getStdioEnvironment!(id) }
          : {}),
      };
      yield* Effect.tryPromise({
        try: () =>
          mountMcp(options.context.glove, {
            adapter: scopedAdapter,
            entries: installedMcp.map(({ entry }) => entry),
            ambiguityPolicy: { type: "auto-pick-best" },
          }),
        catch: (cause) => cause,
      });
    }

    return Object.freeze(installed);
  });
}

export function isFoundryCapability(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<PropertyKey, unknown>;
  return (
    object[FOUNDRY_SHARED_TOOL_BRAND] === true ||
    object[FOUNDRY_AGENT_APPLICATION_BRAND] === true ||
    object[FOUNDRY_MCP_BRAND] === true ||
    object[FOUNDRY_MEMORY_BRAND] === true
  );
}
