import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Effect,
  Layer,
  ManagedRuntime as EffectManagedRuntime,
  Schema,
} from "effect";
import { EnvStore, MemoryEnvStorage } from "station-env";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  MemoryAdapter,
  parseInterval,
  SignalRunner,
  type AnySignal,
  type EnvProvider,
  type Run,
  type SignalQueueAdapter,
} from "station-signal";
import {
  ScheduleMemoryAdapter,
  ScheduleReconciler,
  nextCronOccurrence,
  type Schedule,
  type ScheduleAdapter,
} from "station-schedules";
import type { StationNetworkAdapter, StationNode } from "station-network";
import {
  EMPTY_FOUNDRY_APPLICATION,
  type FoundryApplication,
  type FoundryExecutionAdapters,
} from "./application.js";
import type { FoundryConfig } from "./config.js";
import { DEFAULT_FOUNDRY_CONFIG } from "./config.js";
import {
  FOUNDRY_APPLICATION_ENV,
  FOUNDRY_AGENT_FILE_ENV,
  FOUNDRY_AGENT_ROUTE_ENV,
  FOUNDRY_EXECUTION_MARKER,
  routeFromInternalAgentName,
} from "./definition.js";
import { compileAgentDefinition } from "./agent-runtime.js";
import type {
  AgentInstallation,
  FoundryCapabilityRegistry,
  FoundryCapabilityManifest,
} from "./capabilities.js";
import { EMPTY_CAPABILITY_REGISTRY, installationKey } from "./capabilities.js";
import type { FoundryAgentComposition } from "./composition.js";
import { EMPTY_AGENT_COMPOSITION } from "./composition.js";
import {
  createManifest,
  discoverAgents,
  type DiscoveredAgent,
  type FoundryManifest,
} from "./discovery.js";
import type {
  AccountReference,
  AccountSummary,
  AgentBinding,
  AgentId,
  BindingId,
  EventReference,
  InboundRoute,
  Route,
  RouteId,
  RunGrant,
  RunId,
} from "./domain.js";
import {
  GrantResolver,
  grantResolverLive,
  type ResolveGrantRequest,
} from "./grants.js";
import {
  compileApplicationManifest,
  type FoundryApplicationManifest,
} from "./manifest.js";
import { transmissionPredicate, type AnyFoundryTransmission } from "./integration.js";
import { serializeInboundTransmissionXml } from "./transmission.js";
import { reconstructPlaybook, type AgentPlaybook } from "./playbook.js";
import {
  definePlaybookSubscription,
  reconstructPlaybookSubscription,
  type DefinePlaybookSubscriptionOptions,
  type PlaybookSubscription,
  type PlaybookSubscriptionTarget,
} from "./subscription.js";
import {
  ApplicationConnectionSupervisor,
  type DesiredApplicationConnection,
} from "./connection-supervisor.js";
import type { ApplicationConnectionState } from "./connection.js";
import {
  FoundryObserver,
  MemoryObservabilityAdapter,
  type FoundryObservabilityAdapter,
} from "./observability.js";
import {
  AccountDirectory,
  EventStore,
  TopologyStore,
  memoryAccountDirectory,
  memoryEventStore,
  memoryTopologyStore,
} from "./services.js";
import {
  discoverFoundryRegistry,
  type DiscoveredFoundryRegistry,
} from "./registry.js";
import type { FoundryNativeManifest, FoundryNativeRegistry } from "./surfaces.js";
import { FOUNDRY_CORE_COMMAND_EVENT, type FoundryCoreCommand } from "./core-tools.js";
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
  id as foundryId,
  normalizeAgentInstallations,
  type AgentInstance,
  type Conversation,
  type CreateAgentInstanceOptions,
  type CreateConversationOptions,
  type UpdateAgentInstanceOptions,
  type FoundryDataAdapter,
  type FoundryActivationRecord,
  type FoundryMessageInput,
  type FoundryRequest,
  type FoundryResult,
  type FoundryTask,
  type EnvironmentValue,
  type SharedInboxItem,
  type WorkspaceEntry,
} from "./primitives.js";

export interface FoundryRun<TOutput = unknown> {
  readonly id: string;
  readonly agent: string;
  readonly kind: "trigger" | "recurring";
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly input: unknown;
  readonly output?: TOutput;
  readonly agentId?: string;
  readonly conversationId?: string;
  readonly workspaceId?: string;
  readonly error?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export class FoundryRuntimeError extends Schema.TaggedError<FoundryRuntimeError>(
  "FoundryRuntimeError",
)("FoundryRuntimeError", {
  operation: Schema.String,
  message: Schema.String,
}) {}

export interface FoundryRuntimeOptions {
  readonly rootDir: string;
  readonly agents: DiscoveredAgent[];
  readonly application?: FoundryApplication;
  readonly applicationFilePath?: string;
  readonly registry?: DiscoveredFoundryRegistry;
  readonly config?: FoundryConfig;
  readonly observability?: FoundryObservabilityAdapter;
}

/**
 * How this process participates in a fleet. Derived once so every later
 * decision reads a boolean instead of re-deriving role semantics.
 */
interface ResolvedFleet {
  readonly role: "headquarters" | "station" | "standalone";
  readonly stationId: string;
  readonly networkId: string;
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly endpoint?: string;
  readonly adapter?: StationNetworkAdapter;
  readonly heartbeatIntervalMs: number;
  readonly membershipLeaseMs: number;
  /** Reconciles schedules and arms activations. Exactly one process should. */
  readonly runsControlPlane: boolean;
  /** Claims and executes runs. */
  readonly runsExecutionPlane: boolean;
}

interface ResolvedExecutionConfig {
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly pollIntervalMs: number;
  readonly idlePollIntervalMs: number;
}

/**
 * Identity this process records on every run it claims. Two processes sharing
 * a queue must differ, so the generated form carries host, pid and a random
 * suffix — a restart is a new station, which is what makes its abandoned runs
 * recoverable rather than silently re-owned.
 */
function generateStationId(): string {
  return `foundry-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/**
 * Borrow an adapter without taking responsibility for its lifetime.
 *
 * `SignalRunner.stop()` closes its adapter unconditionally, which is right for
 * one Foundry owns and wrong for one the application built — that adapter may
 * share a connection pool with the data adapter, and closing it would take the
 * application's storage down with the runtime. Hiding `close` leaves the
 * runner's other calls untouched and keeps the ownership rule structural.
 */
function borrowSignalAdapter(adapter: SignalQueueAdapter): SignalQueueAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "close") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, property) {
      if (property === "close") return false;
      return Reflect.has(target, property);
    },
  });
}

/**
 * Derive fleet participation once.
 *
 * The plane split follows Station's: Headquarters reconciles and serves,
 * stations execute, standalone does both. `runRunners` defaults to false for
 * Headquarters so the common case needs no extra configuration.
 */
function resolveFleet(
  execution: FoundryExecutionAdapters | undefined,
): ResolvedFleet {
  const role = execution?.role ?? "standalone";
  const runRunners = execution?.runRunners ?? role !== "headquarters";
  const stationId = execution?.stationId ?? generateStationId();
  const heartbeatIntervalMs = execution?.network?.heartbeatIntervalMs ?? 15_000;

  return {
    role,
    stationId,
    networkId: execution?.network?.id ?? "default",
    name: execution?.network?.name ?? stationId,
    labels: { ...(execution?.network?.labels ?? {}) },
    ...(execution?.network?.endpoint ? { endpoint: execution.network.endpoint } : {}),
    ...(execution?.network?.adapter ? { adapter: execution.network.adapter } : {}),
    heartbeatIntervalMs,
    // Membership must outlive a missed beat or ordinary jitter evicts a
    // healthy process from the fleet.
    membershipLeaseMs: Math.max(
      execution?.network?.membershipLeaseMs ?? 45_000,
      heartbeatIntervalMs * 2,
    ),
    runsControlPlane: role === "headquarters" || (role === "standalone" && runRunners),
    runsExecutionPlane: role !== "headquarters" && runRunners,
  };
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function runtimeFailure(operation: string, cause: unknown): FoundryRuntimeError {
  return new FoundryRuntimeError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function promiseEffect<A>(
  operation: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A, FoundryRuntimeError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => runtimeFailure(operation, cause),
  }).pipe(Effect.withSpan(`foundry.${operation}`));
}

function executionAgentEntrypoint(): string {
  const built = fileURLToPath(new URL("./execution-agent.js", import.meta.url));
  if (existsSync(built)) return built;
  return fileURLToPath(new URL("./execution-agent.ts", import.meta.url));
}

export class FoundryRuntime {
  readonly rootDir: string;
  readonly agents: readonly DiscoveredAgent[];
  readonly application: FoundryApplication;
  readonly applicationFilePath?: string;
  readonly registry: DiscoveredFoundryRegistry;
  readonly manifest: FoundryManifest;
  readonly applicationManifest: FoundryApplicationManifest;
  readonly observability: FoundryObservabilityAdapter;
  readonly data: FoundryDataAdapter;

  private readonly byRoute = new Map<string, DiscoveredAgent>();
  private readonly routeBySignalName = new Map<string, string>();
  private readonly transmissionById = new Map<string, AnyFoundryTransmission>();
  /** Stable topology view used by synchronous playbook validation. */
  private readonly topologyRoutes = new Map<string, Route>();
  private readonly compositionByDefinition = new Map<
    string,
    FoundryAgentComposition
  >();
  private readonly connectionSupervisor: ApplicationConnectionSupervisor;
  private readonly execution: ResolvedExecutionConfig;
  private readonly observer: FoundryObserver;
  private readonly signalRunner: SignalRunner;
  private readonly envStore: EnvStore;
  private readonly envProvider: EnvProvider;
  private readonly scheduleAdapter: ScheduleAdapter;
  /** False when the application supplied the schedule store and owns closing it. */
  private readonly ownsScheduleAdapter: boolean;
  private readonly fleet: ResolvedFleet;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight = false;
  private readonly startedAt = new Date();
  private readonly services: EffectManagedRuntime.ManagedRuntime<
    AccountDirectory | TopologyStore | EventStore | GrantResolver,
    unknown
  >;
  private readonly runnerLoops: Promise<void>[] = [];
  private readonly materializedActivations = new Set<string>();
  private started = false;
  private disposed = false;

  constructor(options: FoundryRuntimeOptions) {
    this.rootDir = options.rootDir;
    this.agents = Object.freeze([...options.agents]);
    this.application = options.application ?? EMPTY_FOUNDRY_APPLICATION;
    this.applicationFilePath = options.applicationFilePath;
    for (const route of this.application.routes ?? []) {
      this.topologyRoutes.set(route.id, route);
    }
    const capabilities: {
      -readonly [K in keyof FoundryCapabilityRegistry]: Array<
        FoundryCapabilityRegistry[K][number]
      >;
    } = { tools: [], applications: [], mcp: [], memory: [] };
    const native: {
      -readonly [K in keyof FoundryNativeRegistry]: Array<
        FoundryNativeRegistry[K][number]
      >;
    } = { layers: [], subscribers: [] };
    for (const discovered of this.agents) {
      const composition = discovered.definition.components ?? EMPTY_AGENT_COMPOSITION;
      this.compositionByDefinition.set(discovered.route, composition);
      capabilities.tools.push(...composition.capabilities.tools);
      capabilities.applications.push(...composition.capabilities.applications);
      capabilities.mcp.push(...composition.capabilities.mcp);
      capabilities.memory.push(...composition.capabilities.memory);
      native.layers.push(...composition.native.layers);
      native.subscribers.push(...composition.native.subscribers);
      for (const application of composition.capabilities.applications) {
        for (const transmission of application.transmissions ?? []) {
          const existing = this.transmissionById.get(transmission.id);
          if (existing && existing !== transmission) {
            throw new Error(
              `Transmission "${transmission.id}" is defined by more than one agent-local application. Share one application definition instead.`,
            );
          }
          this.transmissionById.set(transmission.id, transmission);
        }
      }
    }
    this.registry = Object.freeze({
      capabilities: Object.freeze({
        tools: Object.freeze(capabilities.tools),
        applications: Object.freeze(capabilities.applications),
        mcp: Object.freeze(capabilities.mcp),
        memory: Object.freeze(capabilities.memory),
      }),
      native: Object.freeze({
        layers: Object.freeze(native.layers),
        subscribers: Object.freeze(native.subscribers),
      }),
      files: Object.freeze([]),
      nativeFiles: Object.freeze([]),
    });
    this.manifest = createManifest(this.agents);
    this.applicationManifest = Effect.runSync(
      compileApplicationManifest([...this.transmissionById.values()]),
    );
    this.observability =
      options.observability ??
      new MemoryObservabilityAdapter({
        maxEvents: options.config?.observability?.maxEvents,
      });
    this.data = this.application.data ?? new MemoryFoundryDataAdapter();

    for (const discovered of this.agents) {
      this.byRoute.set(discovered.route, discovered);
      this.routeBySignalName.set(discovered.executionName, discovered.route);
    }
    this.observer = new FoundryObserver(
      this.observability,
      (name) => this.routeBySignalName.get(name) ?? name,
      (event) => {
        if (event.type === FOUNDRY_CORE_COMMAND_EVENT) {
          void this.executeCoreCommand(event.data as FoundryCoreCommand, event.run.id).catch((cause) => {
            this.observability.append({
              type: "core.command.failed",
              category: "system",
              agent: event.route,
              runId: event.run.id,
              data: { error: cause instanceof Error ? cause.message : String(cause), command: event.data },
            });
          });
        }
      },
    );
    this.connectionSupervisor = new ApplicationConnectionSupervisor({
      receive: async (input) => {
        await this.dispatchInbound(input);
      },
      emit: (event) => {
        this.observability.append({
          type: event.type,
          category: "application",
          data: event.data,
        });
      },
    });

    const configured = options.config?.execution;
    const defaults = DEFAULT_FOUNDRY_CONFIG.execution;
    this.execution = {
      maxConcurrent: configured?.maxConcurrent ?? defaults.maxConcurrent,
      maxAttempts: configured?.maxAttempts ?? defaults.maxAttempts,
      retryBackoffMs:
        configured?.retryBackoffMs ?? defaults.retryBackoffMs,
      pollIntervalMs: configured?.pollIntervalMs ?? defaults.pollIntervalMs,
      idlePollIntervalMs:
        configured?.idlePollIntervalMs ?? defaults.idlePollIntervalMs,
    };

    this.envStore = new EnvStore(new MemoryEnvStorage());
    this.envProvider = {
      resolveFor: async (target) => {
        const resolvedEnvironment = await this.envStore.resolveFor(target);
        if (target.kind === "signal") {
          const route = routeFromInternalAgentName(target.name);
          resolvedEnvironment[FOUNDRY_AGENT_ROUTE_ENV] = route;
          const discovered = this.byRoute.get(route);
          if (discovered) {
            resolvedEnvironment[FOUNDRY_AGENT_FILE_ENV] = discovered.filePath;
          }
        }
        if (this.applicationFilePath) {
          resolvedEnvironment[FOUNDRY_APPLICATION_ENV] =
            this.applicationFilePath;
        }
        return resolvedEnvironment;
      },
    };
    // Storage is the application's call; the engine above it is not. An
    // adapter supplied here is borrowed, so its lifetime stays with whoever
    // constructed it.
    const executionAdapters = this.application.execution;
    this.fleet = resolveFleet(executionAdapters);
    this.ownsScheduleAdapter = executionAdapters?.schedules === undefined;
    this.scheduleAdapter =
      executionAdapters?.schedules ?? new ScheduleMemoryAdapter();
    const signalAdapter = executionAdapters?.runs
      ? borrowSignalAdapter(executionAdapters.runs)
      : new MemoryAdapter();
    // Only the control plane reconciles. A station that also armed schedules
    // would race every peer for the same occurrence and, worse, arm every
    // pending activation in the system at boot.
    const signalScheduleReconciler = !this.fleet.runsControlPlane
      ? undefined
      : new ScheduleReconciler({
      adapter: this.scheduleAdapter,
      kinds: ["signal"],
      triggerFn: (schedule, scheduledFor) =>
        this.signalRunner.triggerSignal(
          schedule.target,
          schedule.input,
          { id: schedule.id, scheduledFor },
        ),
      hasPendingOrRunning: (schedule) =>
        this.signalRunner.hasPendingOrRunningForSignal(schedule.target),
      parseInterval,
      onError: (error, schedule) =>
        this.observability.append({
          type: "schedule.error",
          category: "activation",
          data: { scheduleId: schedule?.id, error: error.message },
        }),
    });
    this.signalRunner = new SignalRunner({
      adapter: signalAdapter,
      pollIntervalMs: this.execution.pollIntervalMs,
      idlePollIntervalMs: this.execution.idlePollIntervalMs,
      // Headquarters ticks the same loop but claims nothing: the reconciler
      // rides the poll cadence, and a zero ceiling keeps execution off it.
      maxConcurrent: this.fleet.runsExecutionPlane ? this.execution.maxConcurrent : 0,
      maxAttempts: this.execution.maxAttempts,
      retryBackoffMs: this.execution.retryBackoffMs,
      subscribers: [this.observer],
      ...(signalScheduleReconciler
        ? { scheduleReconciler: signalScheduleReconciler }
        : {}),
      envProvider: this.envProvider,
      stationId: this.fleet.stationId,
      networkId: this.fleet.networkId,
      stationLabels: this.fleet.labels,
      ...(this.fleet.adapter ? { networkCoordinator: this.fleet.adapter } : {}),
      ...(executionAdapters?.canClaim ? { canClaim: executionAdapters.canClaim } : {}),
      ...(executionAdapters?.leaseDurationMs === undefined
        ? {}
        : { leaseDurationMs: executionAdapters.leaseDurationMs }),
      failUnknownSignals: true,
    });
    for (const discovered of this.agents) {
      this.signalRunner.registerSignal(
        this.executionSignal(discovered),
        executionAgentEntrypoint(),
      );
    }

    const topologyLayer = memoryTopologyStore;
    const defaultServices = Layer.mergeAll(
      memoryAccountDirectory(this.application.accounts ?? []),
      topologyLayer,
      memoryEventStore,
    );
    const serviceBase = (this.application.services ??
      defaultServices) as Layer.Layer<
      AccountDirectory | TopologyStore | EventStore,
      unknown
    >;
    const resolver = grantResolverLive.pipe(Layer.provide(serviceBase));
    this.services = EffectManagedRuntime.make(
      Layer.merge(serviceBase, resolver),
    );
  }

  static async discover(options: {
    rootDir: string;
    agentsDir: string;
    application?: FoundryApplication;
    applicationFilePath?: string;
    config?: FoundryConfig;
    observability?: FoundryObservabilityAdapter;
  }): Promise<FoundryRuntime> {
    const agents = await discoverAgents({
      agentsDir: options.agentsDir,
      strictFileRoutes: options.config?.strictFileRoutes,
    });
    const registry = await discoverFoundryRegistry({
      rootDir: options.rootDir,
      capabilities: false,
      native: false,
      strictFileRoutes: options.config?.strictFileRoutes,
    });
    return new FoundryRuntime({
      rootDir: options.rootDir,
      agents,
      application: options.application,
      applicationFilePath: options.applicationFilePath,
      registry,
      config: options.config,
      observability: options.observability,
    });
  }

  startEffect(): Effect.Effect<void, FoundryRuntimeError> {
    return promiseEffect("runtime.start", async () => {
      if (this.started) throw new Error("Foundry runtime is already started.");
      if (this.disposed) {
        throw new Error("Foundry runtime has been stopped and cannot be restarted.");
      }
      if (this.agents.length === 0) {
        throw new Error("Foundry did not discover any agents.");
      }
      this.started = true;
      try {
        await this.seedTopology();
        for (const instance of await this.listAgentInstances()) {
          if (!this.byRoute.has(instance.definitionId)) {
            throw new Error(
              `Agent instance "${instance.id}" references unknown definition "${instance.definitionId}".`,
            );
          }
          for (const installation of instance.installations) {
            this.assertRegisteredInstallation(instance.definitionId, installation);
          }
          this.validatePlaybooks(
            instance.definitionId,
            instance.playbooks,
            instance.installations,
          );
        }
        for (const subscription of await this.listPlaybookSubscriptions()) {
          await this.validatePlaybookSubscription(subscription);
        }
        await this.signalRunner.initialize();
        // Arming pending activations is control-plane work. A station that did
        // it would re-arm every schedule and sleeping run in the system on
        // every deploy — correct, because claimDue still picks one winner, but
        // multiplied by the station count exactly when that hurts most.
        if (this.fleet.runsControlPlane) await this.reconstructActivations();
        if (this.fleet.adapter) {
          await this.fleet.adapter.upsertStation(this.stationSnapshot());
          this.heartbeatTimer = setInterval(
            () => void this.sendHeartbeat(),
            this.fleet.heartbeatIntervalMs,
          );
          this.heartbeatTimer.unref?.();
        } else if (this.fleet.role !== "standalone") {
          console.warn(
            `[foundry] role "${this.fleet.role}" has no network adapter — this process ` +
              "will run correctly but stays invisible to its peers, so placement and " +
              "network-wide concurrency have nothing to coordinate through.",
          );
        }
        this.runInBackground("signal", this.signalRunner.start());
        await this.reconcileApplicationConnections();
      } catch (cause) {
        try {
          await this.stop();
        } catch {
          // Preserve the startup failure; shutdown diagnostics are observable.
        }
        throw cause;
      }
    });
  }

  start(): Promise<void> {
    return Effect.runPromise(this.startEffect());
  }

  /**
   * What this process advertises to the fleet: what it can run, how loaded it
   * is, and how long peers should believe it without another beat.
   */
  private stationSnapshot(status: StationNode["status"] = "online"): StationNode {
    const now = new Date();
    return {
      id: this.fleet.stationId,
      networkId: this.fleet.networkId,
      name: this.fleet.name,
      role: this.fleet.role,
      status,
      labels: { ...this.fleet.labels },
      capacity: {
        maxConcurrent: this.fleet.runsExecutionPlane ? this.execution.maxConcurrent : 0,
        activeRuns: this.signalRunner.getActiveCount(),
      },
      definitions: {
        // A station only claims what it can actually run, so the fleet needs
        // to know which definitions this process was deployed with.
        signals: this.agents.map((agent) => agent.executionName).sort(),
        broadcasts: [],
        beacons: [],
      },
      ...(this.fleet.endpoint ? { endpoint: this.fleet.endpoint } : {}),
      startedAt: this.startedAt,
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + this.fleet.membershipLeaseMs),
    };
  }

  /**
   * Report liveness. A drained station keeps beating so operators can watch it
   * empty; it just stops claiming. Heartbeat failure is logged, never fatal —
   * losing sight of the fleet must not take a working process down with it.
   */
  private async sendHeartbeat(): Promise<void> {
    const adapter = this.fleet.adapter;
    if (!adapter || this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      const existing = await adapter.getStation(this.fleet.stationId);
      const snapshot = this.stationSnapshot(
        existing?.status === "draining" ? "draining" : "online",
      );
      if (!(await adapter.heartbeat(snapshot.id, snapshot))) {
        await adapter.upsertStation(snapshot);
      }
      await adapter.markOfflineBefore(new Date(), this.fleet.networkId);
    } catch (cause) {
      this.observability.append({
        type: "fleet.heartbeat.failed",
        category: "system",
        data: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  stopEffect(): Effect.Effect<void, FoundryRuntimeError> {
    return promiseEffect("runtime.stop", async () => {
      if (this.disposed) return;
      if (!this.started) {
        await this.services.dispose();
        this.disposed = true;
        return;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.fleet.adapter) {
        // Leave the fleet deliberately rather than waiting for the membership
        // lease to lapse, so a rolling deploy reads as a departure and not a
        // failure.
        try {
          await this.fleet.adapter.heartbeat(
            this.fleet.stationId,
            this.stationSnapshot("offline"),
          );
        } catch {
          // A process that cannot announce its exit still exits; the lease
          // expiry is the backstop.
        }
      }
      await this.connectionSupervisor.stopAll();
      this.observability.append({ type: "runtime.stop.signals", category: "system", data: {} });
      await this.signalRunner.stop({ graceful: true, timeoutMs: 10_000 });
      this.observability.append({ type: "runtime.stop.loops", category: "system", data: {} });
      await this.settleRunnerLoops(1_000);
      this.runnerLoops.length = 0;
      await this.envStore.close();
      if (this.ownsScheduleAdapter) await this.scheduleAdapter.close?.();
      await this.services.dispose();
      this.started = false;
      this.disposed = true;
      this.observability.append({ type: "runtime.stopped", category: "system", data: {} });
    });
  }

  stop(): Promise<void> {
    return Effect.runPromise(this.stopEffect());
  }

  requestEffect(
    route: string,
    request: FoundryRequest,
  ): Effect.Effect<FoundryRun, FoundryRuntimeError> {
    return promiseEffect("agent.request", async () => {
      if (!this.started) throw new Error("Foundry runtime is not started.");
      const discovered = this.byRoute.get(route);
      if (!discovered) throw new Error(`Foundry agent "${route}" was not found.`);
      const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
      if (!agent) throw new Error(`Foundry agent instance "${request.agentId}" was not found.`);
      if (agent.definitionId !== route) {
        throw new Error(`Agent instance "${request.agentId}" uses definition "${agent.definitionId}", not "${route}".`);
      }
      const conversation = await Effect.runPromise(this.data.getConversation(request.conversationId));
      if (!conversation || conversation.agentId !== agent.id) {
        throw new Error(`Conversation "${request.conversationId}" does not belong to agent instance "${agent.id}".`);
      }
      if (request.workspaceId !== agent.workspaceId || request.workspaceId !== conversation.workspaceId) {
        throw new Error("The request, agent instance, and conversation must share a workspace.");
      }
      const runId = await this.signalRunner.triggerSignal(
        discovered.executionName,
        await this.executionEnvelope(request),
      );
      const run = await this.signalRunner.getRun(runId);
      if (!run) throw new Error(`Foundry failed to create run "${runId}".`);
      return this.toFoundryRun(run);
    }).pipe(
      Effect.withSpan("foundry.agent.request", {
        attributes: { "foundry.agent.id": route },
      }),
    );
  }

  request(route: string, request: FoundryRequest): Promise<FoundryRun> {
    return Effect.runPromise(this.requestEffect(route, request));
  }

  async createAgent(
    definitionId: string,
    options: CreateAgentInstanceOptions = {},
  ): Promise<AgentInstance> {
    if (!this.byRoute.has(definitionId)) {
      throw new Error(`Foundry agent definition "${definitionId}" was not found.`);
    }
    const agent = createAgentInstance(definitionId, options);
    for (const installation of agent.installations) {
      this.assertRegisteredInstallation(definitionId, installation);
    }
    this.validatePlaybooks(definitionId, agent.playbooks, agent.installations);
    if (await Effect.runPromise(this.data.getAgent(agent.id))) {
      throw new Error(`Foundry agent instance "${agent.id}" already exists.`);
    }
    await Effect.runPromise(this.data.putAgent(agent));
    this.observability.append({ type: "agent.instance.created", category: "agent", agent: definitionId, data: agent });
    if (this.started) await this.reconcileApplicationConnections();
    return agent;
  }

  async createConversation(
    agentId: string,
    options: CreateConversationOptions = {},
  ): Promise<Conversation> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    const conversation = createConversation(agent, options);
    if (await Effect.runPromise(this.data.getConversation(conversation.id))) {
      throw new Error(`Foundry conversation "${conversation.id}" already exists.`);
    }
    await Effect.runPromise(this.data.putConversation(conversation));
    this.observability.append({ type: "conversation.created", category: "agent", agent: agent.definitionId, data: conversation });
    return conversation;
  }

  listAgentInstances(definitionId?: string): Promise<ReadonlyArray<AgentInstance>> {
    return Effect.runPromise(this.data.listAgents(definitionId));
  }

  async setAgentPlaybooks(
    agentId: string,
    playbooks: ReadonlyArray<AgentPlaybook>,
  ): Promise<AgentInstance> {
    const agent = await this.configureAgent(agentId, { playbooks });
    this.observability.append({
      type: "agent.playbooks.updated",
      category: "agent",
      agent: agent.definitionId,
      data: { agentId, playbookIds: agent.playbooks.map((playbook) => playbook.id) },
    });
    return agent;
  }

  listPlaybookSubscriptions(
    workspaceId?: string,
  ): Promise<ReadonlyArray<PlaybookSubscription>> {
    return Effect.runPromise(this.data.listPlaybookSubscriptions(workspaceId));
  }

  /** List persisted future activations created by schedules or sleeping runs. */
  listActivations(
    workspaceId?: string,
  ): Promise<ReadonlyArray<FoundryActivationRecord>> {
    return Effect.runPromise(this.data.listActivations(workspaceId));
  }

  async putPlaybookSubscription(
    input: DefinePlaybookSubscriptionOptions | PlaybookSubscription,
  ): Promise<PlaybookSubscription> {
    const firstTarget = input.targets[0];
    const subscription = firstTarget && "definitionId" in firstTarget
      ? reconstructPlaybookSubscription(input as PlaybookSubscription)
      : definePlaybookSubscription(input as DefinePlaybookSubscriptionOptions);
    await this.validatePlaybookSubscription(subscription);
    await Effect.runPromise(this.data.putPlaybookSubscription(subscription));
    this.observability.append({
      type: "playbook.subscription.updated",
      category: "application",
      data: {
        subscriptionId: subscription.id,
        playbookId: subscription.playbook.id,
        targetDefinitions: subscription.targets.map((target) => target.definitionId),
      },
    });
    if (this.started) await this.reconcileApplicationConnections();
    return subscription;
  }

  async deletePlaybookSubscription(id: string): Promise<boolean> {
    const removed = await Effect.runPromise(this.data.deletePlaybookSubscription(id));
    if (removed) {
      this.observability.append({
        type: "playbook.subscription.deleted",
        category: "application",
        data: { subscriptionId: id },
      });
      if (this.started) await this.reconcileApplicationConnections();
    }
    return removed;
  }

  listApplicationConnections(): ReadonlyArray<ApplicationConnectionState> {
    return this.connectionSupervisor.list();
  }

  reconnectApplicationConnection(id: string): Promise<void> {
    return this.connectionSupervisor.reconnect(id);
  }

  /** Atomically replace the persisted, frontend-editable instance configuration. */
  async configureAgent(
    agentId: string,
    options: UpdateAgentInstanceOptions,
  ): Promise<AgentInstance> {
    const current = await Effect.runPromise(this.data.getAgent(agentId));
    if (!current) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    const installations = options.installations
      ? normalizeAgentInstallations(options.installations)
      : current.installations;
    for (const installation of installations) {
      this.assertRegisteredInstallation(current.definitionId, installation);
    }
    const playbooks = options.playbooks
      ? Object.freeze(options.playbooks.map(reconstructPlaybook))
      : current.playbooks;
    this.validatePlaybooks(current.definitionId, playbooks, installations);
    const agent = Object.freeze({
      ...current,
      ...(options.context
        ? { context: Object.freeze(structuredClone(options.context)) }
        : {}),
      installations,
      playbooks,
      updatedAt: new Date().toISOString(),
    });
    await Effect.runPromise(this.data.putAgent(agent));
    this.observability.append({
      type: "agent.instance.configured",
      category: "agent",
      agent: current.definitionId,
      data: {
        agentId,
        installations: installations.map(installationKey),
        playbookIds: playbooks.map((playbook) => playbook.id),
      },
    });
    if (this.started) await this.reconcileApplicationConnections();
    return agent;
  }

  listConversations(agentId: string): Promise<ReadonlyArray<Conversation>> {
    return Effect.runPromise(this.data.listConversations(agentId));
  }

  listWorkspaceEntries(workspaceId: string): Promise<ReadonlyArray<WorkspaceEntry>> {
    return Effect.runPromise(this.data.listWorkspaceEntries(workspaceId));
  }

  async putWorkspaceEntry(workspaceId: string, key: string, value: unknown): Promise<WorkspaceEntry> {
    const entry = { workspaceId, key, value, updatedAt: new Date().toISOString() };
    await Effect.runPromise(this.data.putWorkspaceEntry(entry));
    return entry;
  }

  listSharedInbox(workspaceId: string): Promise<ReadonlyArray<SharedInboxItem>> {
    return Effect.runPromise(this.data.listInboxItems(workspaceId));
  }

  async postSharedInbox(input: Omit<SharedInboxItem, "id" | "createdAt" | "updatedAt">): Promise<SharedInboxItem> {
    const now = new Date().toISOString();
    const item: SharedInboxItem = { ...input, id: foundryId("inbox"), createdAt: now, updatedAt: now };
    await Effect.runPromise(this.data.putInboxItem(item));
    return item;
  }

  async updateSharedInbox(
    workspaceId: string,
    itemId: string,
    status: SharedInboxItem["status"],
  ): Promise<SharedInboxItem> {
    const current = (await this.listSharedInbox(workspaceId)).find((item) => item.id === itemId);
    if (!current) throw new Error(`Shared inbox item "${itemId}" was not found in workspace "${workspaceId}".`);
    const item = { ...current, status, updatedAt: new Date().toISOString() };
    await Effect.runPromise(this.data.putInboxItem(item));
    return item;
  }

  listTasks(workspaceId: string): Promise<ReadonlyArray<FoundryTask>> {
    return Effect.runPromise(this.data.listTasks(workspaceId));
  }

  async createTask(input: Omit<FoundryTask, "id" | "createdAt" | "updatedAt">): Promise<FoundryTask> {
    const now = new Date().toISOString();
    const task: FoundryTask = { ...input, id: foundryId("task"), createdAt: now, updatedAt: now };
    await Effect.runPromise(this.data.putTask(task));
    return task;
  }

  async updateTask(
    workspaceId: string,
    taskId: string,
    status: FoundryTask["status"],
  ): Promise<FoundryTask> {
    const current = (await this.listTasks(workspaceId)).find((task) => task.id === taskId);
    if (!current) throw new Error(`Task "${taskId}" was not found in workspace "${workspaceId}".`);
    const task = { ...current, status, updatedAt: new Date().toISOString() };
    await Effect.runPromise(this.data.putTask(task));
    return task;
  }

  listDataEnvironment(scope: {
    readonly workspaceId: string;
    readonly agentId?: string;
    readonly conversationId?: string;
  }): Promise<ReadonlyArray<EnvironmentValue>> {
    return Effect.runPromise(this.data.listEnvironment(scope));
  }

  async send(
    agentId: string,
    conversationId: string,
    message: FoundryMessageInput,
    options: { readonly payload?: unknown; readonly context?: Readonly<Record<string, unknown>> } = {},
  ): Promise<FoundryRun<FoundryResult>> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    return this.request(agent.definitionId, {
      agentId,
      conversationId,
      workspaceId: agent.workspaceId,
      message,
      ...(options.payload !== undefined ? { payload: options.payload } : {}),
      ...(options.context ? { context: options.context } : {}),
      source: { kind: "direct" },
    }) as Promise<FoundryRun<FoundryResult>>;
  }

  async getRun<TOutput = unknown>(
    runId: string,
  ): Promise<FoundryRun<TOutput> | null> {
    const run = await this.signalRunner.getRun(runId);
    return run ? this.toFoundryRun<TOutput>(run) : null;
  }

  async listRuns(route?: string): Promise<FoundryRun[]> {
    const signalName = route ? this.byRoute.get(route)?.executionName : undefined;
    if (route && !signalName) return [];
    const runs = await this.signalRunner.listAllRuns({ signalName });
    return runs.map((run) => this.toFoundryRun(run));
  }

  async waitForRun<TOutput = unknown>(
    runId: string,
    options?: { pollMs?: number; timeoutMs?: number },
  ): Promise<FoundryRun<TOutput> | null> {
    const run = await this.signalRunner.waitForRun(runId, options);
    return run ? this.toFoundryRun<TOutput>(run) : null;
  }

  cancel(runId: string): Promise<boolean> {
    return this.signalRunner.cancel(runId);
  }

  capabilityManifest(definitionId: string): FoundryCapabilityManifest {
    if (!this.compositionByDefinition.has(definitionId)) {
      throw new Error(`Foundry agent definition "${definitionId}" was not found.`);
    }
    const capabilities = this.compositionByDefinition.get(definitionId)!
      .capabilities;
    const fileByKey = new Map(
      this.registry.files.map((file) => [`${file.kind}:${file.id}`, file]),
    );
    const map = <T extends { readonly id: string; readonly description?: string }>(
      kind: "tool" | "application" | "mcp" | "memory",
      values: ReadonlyArray<T>,
      ownership: "instance" | "definition",
    ) =>
      values.map((value) => ({
        id: value.id,
        kind,
        description: value.description ?? "",
        ownership,
        file: fileByKey.get(`${kind}:${value.id}`)?.relativePath,
      }));
    return {
      tools: map("tool", capabilities.tools, "instance"),
      applications: map(
        "application",
        capabilities.applications,
        "instance",
      ),
      mcp: map("mcp", capabilities.mcp, "instance"),
      memory: map("memory", capabilities.memory, "definition"),
    };
  }

  nativeManifest(definitionId: string): FoundryNativeManifest {
    if (!this.compositionByDefinition.has(definitionId)) {
      throw new Error(`Foundry agent definition "${definitionId}" was not found.`);
    }
    const native = this.compositionByDefinition.get(definitionId)!.native;
    const fileByKey = new Map(
      this.registry.nativeFiles.map((file) => [`${file.kind}:${file.id}`, file]),
    );
    const map = <
      T extends { readonly id: string; readonly description: string },
    >(
      kind: "layer" | "subscriber",
      values: ReadonlyArray<T>,
    ) =>
      values.map((value) => ({
        id: value.id,
        kind,
        description: value.description,
        file: fileByKey.get(`${kind}:${value.id}`)?.relativePath,
      }));
    return {
      layers: map("layer", native.layers),
      subscribers: map("subscriber", native.subscribers),
    };
  }

  async listInstallations(
    agentId: string,
  ): Promise<ReadonlyArray<AgentInstallation>> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) {
      throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    }
    return agent.installations;
  }

  async installCapability(
    agentId: string,
    installation: AgentInstallation,
  ): Promise<AgentInstance> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) {
      throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    }
    this.assertRegisteredInstallation(agent.definitionId, installation);
    const installations = normalizeAgentInstallations([
      ...agent.installations,
      installation,
    ]);
    const updated = Object.freeze({
      ...agent,
      installations,
      updatedAt: new Date().toISOString(),
    });
    await Effect.runPromise(this.data.putAgent(updated));
    this.observability.append({
      type: "installation.installed",
      category: "application",
      agent: agentId,
      data: installation,
    });
    if (this.started) await this.reconcileApplicationConnections();
    return updated;
  }

  async uninstallCapability(
    agentId: string,
    installation: AgentInstallation,
  ): Promise<AgentInstance> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    const installations = normalizeAgentInstallations(
      agent.installations.filter(
        (candidate) => installationKey(candidate) !== installationKey(installation),
      ),
    );
    this.validatePlaybooks(agent.definitionId, agent.playbooks, installations);
    const updated = Object.freeze({
      ...agent,
      installations,
      updatedAt: new Date().toISOString(),
    });
    await Effect.runPromise(this.data.putAgent(updated));
    this.observability.append({
      type: "installation.uninstalled",
      category: "application",
      agent: agentId,
      data: installation,
    });
    if (this.started) await this.reconcileApplicationConnections();
    return updated;
  }

  listAccounts() {
    return this.services.runPromise(
      Effect.gen(function* () {
        const accounts = yield* (yield* AccountDirectory).list();
        return accounts.map(
          ({ accessRef: _accessRef, ...account }) => account satisfies AccountSummary,
        );
      }),
    );
  }

  listRoutes() {
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).listRoutes();
      }),
    );
  }

  async putRoute(route: Route): Promise<Route> {
    await this.validateRoute(route);
    const stored = await this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).putRoute(route);
      }),
    );
    this.topologyRoutes.set(stored.id, stored);
    return stored;
  }

  async removeRoute(id: RouteId): Promise<void> {
    await this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).removeRoute(id);
      }),
    );
    this.topologyRoutes.delete(id);
  }

  listBindings() {
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).listBindings();
      }),
    );
  }

  async putBinding(binding: AgentBinding): Promise<AgentBinding> {
    await this.validateBinding(binding);
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).putBinding(binding);
      }),
    );
  }

  removeBinding(id: BindingId): Promise<void> {
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* TopologyStore).removeBinding(id);
      }),
    );
  }

  resolveGrant(request: ResolveGrantRequest): Promise<RunGrant> {
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* GrantResolver).resolve(request);
      }),
    );
  }

  putEvent(reference: EventReference, payload: unknown): Promise<void> {
    return this.services.runPromise(
      Effect.gen(function* () {
        return yield* (yield* EventStore).put(reference, payload);
      }),
    );
  }

  async dispatchInbound(input: {
    readonly routeId: string;
    readonly eventId: string;
    readonly threadKey: string;
    readonly raw: unknown;
  }): Promise<ReadonlyArray<FoundryRun>> {
    const route = (await this.listRoutes()).find((item) => item.id === input.routeId);
    if (!route || route.direction !== "inbound" || !route.enabled) {
      throw new Error(`Inbound route "${input.routeId}" is missing or disabled.`);
    }
    const claim = `${route.id}:${input.eventId}`;
    const prior = await Effect.runPromise(this.data.getInboundDelivery(claim));
    if (prior?.status === "completed") {
      return this.runsFromIds(prior.runIds);
    }
    const acquired = await Effect.runPromise(this.data.claimInboundDelivery(claim));
    if (!acquired) return this.waitForInboundDelivery(claim);
    try {
    const integration = this.transmissionById.get(route.transmissionId);
    if (!integration?.inbound) throw new Error(`Transmission "${route.transmissionId}" has no inbound contract.`);
    const account = route.accountId
      ? await this.services.runPromise(Effect.gen(function* () {
          return yield* (yield* AccountDirectory).get(route.accountId!);
        }))
      : undefined;
    const ingressContext = { route, ...(account ? { account } : {}) };
    if (integration.inbound.adapter) {
      const authenticated = await Effect.runPromise(integration.inbound.adapter.authenticate(input.raw, ingressContext));
      if (!authenticated) throw new Error(`Inbound event for route "${route.id}" was not authenticated.`);
    }
    const event = integration.inbound.adapter
      ? await Effect.runPromise(integration.inbound.adapter.normalize(input.raw, ingressContext))
      : await Schema.decodeUnknownPromise(integration.inbound.event)(input.raw);
    const inferredEventName = event && typeof event === "object"
      ? ["type", "kind", "event"].map((key) => (event as Record<string, unknown>)[key])
          .find((value): value is string => typeof value === "string" && value.length > 0)
      : undefined;
    const classifiedEvent = integration.inbound.classify
      ? await Effect.runPromise(integration.inbound.classify(event, ingressContext))
      : undefined;
    if (
      classifiedEvent &&
      !integration.events?.some((candidate) => candidate.id === classifiedEvent.id)
    ) {
      throw new Error(
        `Transmission "${integration.id}" classified an event it does not declare. Add the imported event definition to its events array.`,
      );
    }
    const eventName = classifiedEvent?.id ?? inferredEventName ?? "event";
    const instances = await this.listAgentInstances();
    const runs: FoundryRun[] = [];
    const deliveries: Array<{ agentId: string; playbookIds: string[]; runId: string }> = [];
    const matchedByAgent = new Map<string, { agent: AgentInstance; playbooks: AgentPlaybook[] }>();
    for (const agent of instances) {
      const installedApplications = new Set(
        agent.installations
          .filter((installation) => installation.kind === "application")
          .map((installation) => installation.id),
      );
      const hasInstalledOwner = (
        this.compositionByDefinition.get(agent.definitionId)?.capabilities.applications ?? []
      ).some((application) =>
        installedApplications.has(application.id) &&
        application.transmissions?.some(
          (candidate) => candidate.id === integration.id && candidate.inbound,
        ),
      );
      if (!hasInstalledOwner) continue;
      const matched: AgentPlaybook[] = [];
      for (const playbook of agent.playbooks) {
        if (await this.playbookMatches(
          playbook,
          integration,
          route,
          eventName,
          event,
          ingressContext,
        )) matched.push(playbook);
      }
      if (matched.length === 0) continue;
      matchedByAgent.set(agent.id, { agent, playbooks: matched });
    }

    for (const subscription of await this.listPlaybookSubscriptions()) {
      if (!subscription.enabled || subscription.workspaceId.length === 0) continue;
      if (!await this.playbookMatches(
        subscription.playbook,
        integration,
        route,
        eventName,
        event,
        ingressContext,
      )) continue;
      for (const [targetIndex, target] of subscription.targets.entries()) {
        const resolved = await this.resolveSubscriptionTarget(
          subscription,
          target,
          targetIndex,
          {
            route,
            eventId: input.eventId,
            eventName,
            threadKey: input.threadKey,
            event,
          },
        );
        for (const agent of resolved) {
          const prior = matchedByAgent.get(agent.id);
          if (prior) {
            if (!prior.playbooks.some((playbook) => playbook.id === subscription.playbook.id)) {
              prior.playbooks.push(subscription.playbook);
            }
          } else {
            matchedByAgent.set(agent.id, {
              agent,
              playbooks: [subscription.playbook],
            });
          }
        }
      }
    }

    for (const { agent, playbooks: matched } of matchedByAgent.values()) {
      const conversationId = `transmission:${route.id}:${agent.id}:${input.threadKey}`;
      let conversation = await Effect.runPromise(this.data.getConversation(conversationId));
      if (!conversation) {
        conversation = await this.createConversation(agent.id, {
          id: conversationId,
          context: { routeId: route.id, threadKey: input.threadKey },
        });
      }
      const serializationContext = {
        ...ingressContext,
        eventId: input.eventId,
        eventName,
        threadKey: input.threadKey,
        playbooks: matched,
      };
      const eventMessage = integration.inbound.serialize
        ? await Effect.runPromise(integration.inbound.serialize(event, serializationContext))
        : serializeInboundTransmissionXml({
            transmissionId: integration.id,
            routeId: route.id,
            eventId: input.eventId,
            eventName,
            threadKey: input.threadKey,
            event,
            playbooks: matched,
          });
      const run = await this.request(agent.definitionId, {
        agentId: agent.id,
        conversationId: conversation.id,
        workspaceId: agent.workspaceId,
        message: eventMessage,
        payload: event,
        context: {
          playbookIds: matched.map((playbook) => playbook.id),
          outbound: matched.flatMap((playbook) => playbook.outbound ?? []),
        },
        source: {
          kind: "transmission",
          id: route.id,
          provider: route.transmissionId,
          eventId: input.eventId,
          threadKey: input.threadKey,
        },
      });
      runs.push(run);
      deliveries.push({
        agentId: agent.id,
        playbookIds: matched.map((playbook) => playbook.id),
        runId: run.id,
      });
    }
    await Effect.runPromise(
      this.data.completeInboundDelivery(claim, runs.map((run) => run.id)),
    );
    this.observability.append({
      type: "transmission.dispatched",
      category: "application",
      data: { routeId: route.id, eventId: input.eventId, eventName, deliveries },
    });
    return runs;
    } catch (cause) {
      await Effect.runPromise(this.data.releaseInboundDelivery(claim));
      throw cause;
    }
  }

  async dispatchOutbound(input: {
    readonly routeId: string;
    readonly agentId: string;
    readonly runId: string;
    readonly payload: unknown;
    readonly commandId?: string;
    readonly applicationId?: string;
    readonly transmissionId?: string;
  }): Promise<unknown> {
    const route = (await this.listRoutes()).find((item) => item.id === input.routeId);
    if (!route || route.direction !== "outbound" || !route.enabled) {
      throw new Error(`Outbound route "${input.routeId}" is missing or disabled.`);
    }
    if (input.transmissionId && route.transmissionId !== input.transmissionId) {
      throw new Error(
        `Outbound route "${route.id}" does not belong to transmission "${input.transmissionId}".`,
      );
    }
    if (input.applicationId) {
      const agent = await Effect.runPromise(this.data.getAgent(input.agentId));
      const application = agent
        ? this.compositionByDefinition
            .get(agent.definitionId)
            ?.capabilities.applications.find(
              (candidate) => candidate.id === input.applicationId,
            )
        : undefined;
      if (
        !application ||
        !agent?.installations.some(
          (installation) =>
            installation.kind === "application" &&
            installation.id === input.applicationId,
        ) ||
        !application.transmissions?.some(
          (candidate) => candidate.id === route.transmissionId,
        )
      ) {
        throw new Error(
          `Application "${input.applicationId}" does not own outbound transmission "${route.transmissionId}" for agent "${input.agentId}".`,
        );
      }
    }
    const grant = await this.resolveGrant({
      runId: input.runId as RunId,
      agentId: input.agentId as AgentId,
    });
    if (!grant.outboundRouteIds.includes(route.id)) {
      throw new Error(`Run "${input.runId}" is not authorized for outbound route "${route.id}".`);
    }
    const transmission = this.transmissionById.get(route.transmissionId);
    if (!transmission?.outbound?.adapter) {
      throw new Error(`Transmission "${route.transmissionId}" has no outbound delivery adapter.`);
    }
    const account = route.accountId
      ? await this.services.runPromise(Effect.gen(function* () {
          return yield* (yield* AccountDirectory).get(route.accountId!);
        }))
      : undefined;
    const payload = await Schema.decodeUnknownPromise(transmission.outbound.input)(input.payload);
    const output = await Effect.runPromise(transmission.outbound.adapter.deliver(payload, {
      route,
      ...(account ? { account } : {}),
      grant,
    }));
    const validated = await Schema.decodeUnknownPromise(transmission.outbound.output)(output);
    this.observability.append({
      type: "transmission.outbound.delivered",
      category: "application",
      runId: input.runId,
      data: {
        ...(input.commandId ? { commandId: input.commandId } : {}),
        ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        ...(input.transmissionId ? { transmissionId: input.transmissionId } : {}),
        routeId: route.id,
        output: validated,
      },
    });
    return validated;
  }

  async health(): Promise<Record<string, unknown>> {
    const [execution, environment, activations] = await Promise.all([
      this.signalRunner.getAdapter().ping(),
      this.envStore.ping(),
      this.scheduleAdapter.ping(),
    ]);
    return {
      ok: execution && environment && activations,
      execution,
      environment,
      activations,
      agents: this.agents.length,
      capabilities: this.registry.files.length,
      surfaces: this.registry.nativeFiles.length,
    };
  }

  private async runsFromIds(
    runIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<FoundryRun>> {
    return (await Promise.all(runIds.map((id) => this.getRun(id)))).filter(
      (run): run is FoundryRun => run !== null,
    );
  }

  private async waitForInboundDelivery(
    key: string,
  ): Promise<ReadonlyArray<FoundryRun>> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const claim = await Effect.runPromise(this.data.getInboundDelivery(key));
      if (!claim) {
        throw new Error(`Inbound delivery "${key}" was released before completion.`);
      }
      if (claim.status === "completed") return this.runsFromIds(claim.runIds);
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(`Timed out waiting for inbound delivery "${key}".`);
  }

  private async validatePlaybookSubscription(
    subscription: PlaybookSubscription,
  ): Promise<void> {
    for (const target of subscription.targets) {
      if (!this.byRoute.has(target.definitionId)) {
        throw new Error(
          `Playbook subscription "${subscription.id}" targets unknown agent definition "${target.definitionId}".`,
        );
      }
      for (const installation of target.installations) {
        this.assertRegisteredInstallation(target.definitionId, installation);
      }
      if (target.provisioning.mode === "existing") {
        for (const agentId of target.provisioning.agentIds) {
          const agent = await Effect.runPromise(this.data.getAgent(agentId));
          if (!agent || agent.definitionId !== target.definitionId) {
            throw new Error(
              `Playbook subscription "${subscription.id}" references missing or incompatible agent instance "${agentId}".`,
            );
          }
          this.validatePlaybooks(
            agent.definitionId,
            [subscription.playbook],
            agent.installations,
          );
        }
      } else {
        this.validatePlaybooks(
          target.definitionId,
          [subscription.playbook],
          target.installations,
        );
      }
    }
  }

  private async playbookMatches(
    playbook: AgentPlaybook,
    transmission: AnyFoundryTransmission,
    route: InboundRoute,
    eventName: string,
    event: unknown,
    ingressContext: { readonly route: InboundRoute; readonly account?: AccountReference },
  ): Promise<boolean> {
    if (playbook.enabled === false || playbook.transmissionId !== transmission.id) return false;
    if (playbook.match?.routeIds && !playbook.match.routeIds.includes(route.id)) return false;
    if (playbook.match?.event && playbook.match.event !== eventName) return false;
    const predicateRef = playbook.match?.predicate;
    if (!predicateRef) return true;
    const predicate = transmissionPredicate(transmission, predicateRef.name);
    if (!predicate) {
      throw new Error(
        `Playbook "${playbook.id}" references unknown predicate "${predicateRef.name}" on transmission "${transmission.id}".`,
      );
    }
    return Effect.runPromise(
      predicate.match(event, predicateRef.parameters ?? {}, ingressContext),
    );
  }

  private async resolveSubscriptionTarget(
    subscription: PlaybookSubscription,
    target: PlaybookSubscriptionTarget,
    targetIndex: number,
    input: {
      readonly route: InboundRoute;
      readonly eventId: string;
      readonly eventName: string;
      readonly threadKey: string;
      readonly event: unknown;
    },
  ): Promise<ReadonlyArray<AgentInstance>> {
    const policy = target.provisioning;
    if (policy.mode === "existing") {
      return Promise.all(policy.agentIds.map(async (agentId) => {
        const agent = await Effect.runPromise(this.data.getAgent(agentId));
        if (!agent) throw new Error(`Subscribed agent instance "${agentId}" was not found.`);
        return this.attachSubscriptionPlaybook(agent, subscription, target);
      }));
    }

    const seeds = policy.mode === "custom"
      ? await Effect.runPromise(
          this.application.provisioner?.provision(policy.adapter, {
            subscription,
            target,
            route: input.route,
            eventId: input.eventId,
            eventName: input.eventName,
            threadKey: input.threadKey,
            event: input.event,
          }) ?? Effect.fail(
            new Error(
              `Playbook subscription "${subscription.id}" requires custom provisioner "${policy.adapter}", but the Foundry application does not define one.`,
            ),
          ),
        )
      : [{
          provisioningKey: [
            "subscription",
            subscription.workspaceId,
            subscription.id,
            String(targetIndex),
            policy.mode,
            ...(policy.mode === "per-thread"
              ? [input.route.id, input.threadKey]
              : policy.mode === "per-event"
                ? [input.route.id, input.eventId]
                : [policy.key ?? "default"]),
          ].join(":"),
        }];

    const agents: AgentInstance[] = [];
    for (const seed of seeds) {
      const agent = await Effect.runPromise(this.data.provisionAgent({
        definitionId: target.definitionId,
        provisioningKey: seed.provisioningKey,
        workspaceId: seed.workspaceId ?? subscription.workspaceId,
        context: seed.context ?? target.context,
        installations: seed.installations ?? target.installations,
        playbooks: seed.playbooks ?? [subscription.playbook],
        ...(seed.id ? { id: seed.id } : {}),
      }));
      const attached = await this.attachSubscriptionPlaybook(agent, subscription, target);
      agents.push(attached);
      this.observability.append({
        type: "playbook.subscription.agent-resolved",
        category: "agent",
        agent: target.definitionId,
        data: {
          subscriptionId: subscription.id,
          agentId: attached.id,
          provisioningKey: seed.provisioningKey,
        },
      });
    }
    return agents;
  }

  private async attachSubscriptionPlaybook(
    agent: AgentInstance,
    subscription: PlaybookSubscription,
    target: PlaybookSubscriptionTarget,
  ): Promise<AgentInstance> {
    const playbooks = [
      ...agent.playbooks.filter((playbook) => playbook.id !== subscription.playbook.id),
      subscription.playbook,
    ];
    const installations = normalizeAgentInstallations([
      ...agent.installations,
      ...target.installations,
    ]);
    this.validatePlaybooks(agent.definitionId, playbooks, installations);
    const changed =
      JSON.stringify(agent.playbooks) !== JSON.stringify(playbooks) ||
      JSON.stringify(agent.installations) !== JSON.stringify(installations);
    if (!changed) return agent;
    const updated = Object.freeze({
      ...agent,
      playbooks: Object.freeze(playbooks),
      installations,
      updatedAt: new Date().toISOString(),
    });
    await Effect.runPromise(this.data.putAgent(updated));
    return updated;
  }

  private async reconcileApplicationConnections(): Promise<void> {
    const requirements: Array<{
      definitionId: string;
      workspaceId: string;
      playbook: AgentPlaybook;
      installedApplications?: ReadonlySet<string>;
    }> = [];
    for (const subscription of await this.listPlaybookSubscriptions()) {
      if (!subscription.enabled || subscription.playbook.enabled === false) continue;
      for (const target of subscription.targets) {
        requirements.push({
          definitionId: target.definitionId,
          workspaceId: subscription.workspaceId,
          playbook: subscription.playbook,
          installedApplications: new Set(
            target.installations
              .filter((installation) => installation.kind === "application")
              .map((installation) => installation.id),
          ),
        });
      }
    }
    for (const agent of await this.listAgentInstances()) {
      const installedApplications = new Set(
        agent.installations
          .filter((installation) => installation.kind === "application")
          .map((installation) => installation.id),
      );
      for (const playbook of agent.playbooks) {
        if (playbook.enabled === false) continue;
        requirements.push({
          definitionId: agent.definitionId,
          workspaceId: agent.workspaceId,
          playbook,
          installedApplications,
        });
      }
    }

    const routes = (await this.listRoutes()).filter(
      (route): route is InboundRoute => route.direction === "inbound" && route.enabled,
    );
    const grouped = new Map<string, DesiredApplicationConnection & { routes: InboundRoute[] }>();
    for (const requirement of requirements) {
      const composition = this.compositionByDefinition.get(requirement.definitionId);
      if (!composition) continue;
      for (const application of composition.capabilities.applications) {
        if (
          requirement.installedApplications &&
          !requirement.installedApplications.has(application.id)
        ) continue;
        if (!application.transmissions?.some(
          (transmission) => transmission.id === requirement.playbook.transmissionId,
        )) continue;
        for (const connection of application.connections ?? []) {
          if (!connection.transmissions.some(
            (transmission) => transmission.id === requirement.playbook.transmissionId,
          )) continue;
          const matchingRoutes = routes.filter((route) =>
            route.transmissionId === requirement.playbook.transmissionId &&
            (!requirement.playbook.match?.routeIds ||
              requirement.playbook.match.routeIds.includes(route.id))
          );
          for (const route of matchingRoutes) {
            const account = route.accountId
              ? this.application.accounts?.find((candidate) => candidate.id === route.accountId)
              : undefined;
            const id = [
              requirement.definitionId,
              requirement.workspaceId,
              application.id,
              connection.id,
              account?.id ?? "no-account",
            ].join(":");
            const prior = grouped.get(id);
            if (prior) {
              if (!prior.routes.some((candidate) => candidate.id === route.id)) prior.routes.push(route);
            } else {
              grouped.set(id, {
                id,
                application,
                connection,
                definitionId: requirement.definitionId,
                workspaceId: requirement.workspaceId,
                ...(account ? { account } : {}),
                routes: [route],
                accountSessions: this.byRoute.get(requirement.definitionId)?.definition.accountSessions,
              });
            }
          }
        }
      }
    }
    await this.connectionSupervisor.reconcile([...grouped.values()]);
  }

  private assertRegisteredInstallation(
    definitionId: string,
    installation: AgentInstallation,
  ): void {
    const registry = this.compositionByDefinition.get(definitionId)?.capabilities ??
      EMPTY_CAPABILITY_REGISTRY;
    const values =
      installation.kind === "tool"
        ? registry.tools
        : installation.kind === "application"
          ? registry.applications
          : registry.mcp;
    if (!values.some((value) => value.id === installation.id)) {
      throw new Error(
        `Unknown Foundry ${installation.kind} capability "${installation.id}".`,
      );
    }
  }

  private validatePlaybooks(
    definitionId: string,
    playbooks: ReadonlyArray<AgentPlaybook>,
    installations: ReadonlyArray<AgentInstallation>,
  ): void {
    const routes = this.topologyRoutes;
    const applicationDefinitions =
      this.compositionByDefinition.get(definitionId)?.capabilities.applications ?? [];
    const applications = new Map(
      applicationDefinitions.map((application) => [application.id, application]),
    );
    const installedApplications = new Set(
      installations
        .filter((installation) => installation.kind === "application")
        .map((installation) => installation.id),
    );
    const localTransmissions = new Map(
      (this.compositionByDefinition.get(definitionId)?.capabilities.applications ?? [])
        .flatMap((application) =>
          (application.transmissions ?? []).map((transmission) => [
            transmission.id,
            transmission,
          ] as const),
        ),
    );
    for (const playbook of playbooks) {
      const transmission = localTransmissions.get(playbook.transmissionId);
      if (!transmission?.inbound) {
        throw new Error(
          `Playbook "${playbook.id}" references transmission "${playbook.transmissionId}" without an inbound definition.`,
        );
      }
      const inboundOwners = applicationDefinitions.filter((application) =>
        application.transmissions?.some(
          (candidate) => candidate.id === playbook.transmissionId && candidate.inbound,
        ),
      );
      if (!inboundOwners.some((application) => installedApplications.has(application.id))) {
        throw new Error(
          `Playbook "${playbook.id}" requires an installed application that owns inbound transmission "${playbook.transmissionId}".`,
        );
      }
      const predicate = playbook.match?.predicate?.name;
      if (predicate && !transmissionPredicate(transmission, predicate)) {
        throw new Error(
          `Playbook "${playbook.id}" references unknown predicate "${predicate}" on transmission "${playbook.transmissionId}".`,
        );
      }
      for (const routeId of playbook.match?.routeIds ?? []) {
        const route = routes.get(routeId);
        if (!route || route.direction !== "inbound" || route.transmissionId !== playbook.transmissionId) {
          throw new Error(`Playbook "${playbook.id}" references invalid inbound route "${routeId}".`);
        }
      }
      for (const outbound of playbook.outbound ?? []) {
        const route = routes.get(outbound.routeId);
        if (!route || route.direction !== "outbound") {
          throw new Error(`Playbook "${playbook.id}" references invalid outbound route "${outbound.routeId}".`);
        }
        if (outbound.accountId && route.accountId !== outbound.accountId) {
          throw new Error(
            `Playbook "${playbook.id}" selects account "${outbound.accountId}" outside outbound route "${outbound.routeId}".`,
          );
        }
        if (outbound.applicationId) {
          const application = applications.get(outbound.applicationId);
          if (!application) {
            throw new Error(
              `Playbook "${playbook.id}" references unknown application "${outbound.applicationId}".`,
            );
          }
          if (!installedApplications.has(outbound.applicationId)) {
            throw new Error(
              `Playbook "${playbook.id}" references uninstalled application "${outbound.applicationId}".`,
            );
          }
          if (!application.transmissions?.some(
            (candidate) => candidate.id === route.transmissionId && candidate.outbound,
          )) {
            throw new Error(
              `Application "${outbound.applicationId}" does not own outbound route "${outbound.routeId}".`,
            );
          }
        } else {
          const hasInstalledOwner = applicationDefinitions.some((application) =>
            installedApplications.has(application.id) &&
            application.transmissions?.some(
              (candidate) => candidate.id === route.transmissionId && candidate.outbound,
            ),
          );
          if (!hasInstalledOwner) {
            throw new Error(
              `Playbook "${playbook.id}" outbound route "${outbound.routeId}" has no installed owning application.`,
            );
          }
        }
      }
      for (const applicationId of playbook.applications ?? []) {
        if (!applications.has(applicationId)) {
          throw new Error(`Playbook "${playbook.id}" references unknown application "${applicationId}".`);
        }
        if (!installedApplications.has(applicationId)) {
          throw new Error(`Playbook "${playbook.id}" references uninstalled application "${applicationId}".`);
        }
      }
    }
  }

  private async validateRoute(route: Route): Promise<void> {
    const integration = this.transmissionById.get(route.transmissionId);
    if (!integration) {
      throw new Error(
        `Route "${route.id}" references unknown transmission "${route.transmissionId}".`,
      );
    }
    const contract =
      route.direction === "inbound" ? integration.inbound : integration.outbound;
    if (!contract) {
      throw new Error(
        `Integration "${integration.id}" does not support ${route.direction} routes.`,
      );
    }
    if (integration.account?.required && !route.accountId) {
      throw new Error(`Route "${route.id}" requires an account.`);
    }
    if (route.accountId) {
      const account = await this.services.runPromise(
        Effect.gen(function* () {
          return yield* (yield* AccountDirectory).get(route.accountId!);
        }),
      );
      if (account.transmissionId !== route.transmissionId) {
        throw new Error(
          `Route "${route.id}" has an account outside transmission "${route.transmissionId}".`,
        );
      }
    }
    await Schema.decodeUnknownPromise(contract.config)(route.config);
  }

  private async validateBinding(binding: AgentBinding): Promise<void> {
    if (!(await Effect.runPromise(this.data.getAgent(binding.agentId)))) {
      throw new Error(
        `Binding "${binding.id}" references unknown agent instance "${binding.agentId}".`,
      );
    }
    const integration = this.transmissionById.get(binding.transmissionId);
    if (!integration) {
      throw new Error(
        `Binding "${binding.id}" references unknown transmission "${binding.transmissionId}".`,
      );
    }
    if (integration.account?.required && !binding.accountId) {
      throw new Error(`Binding "${binding.id}" requires an account.`);
    }
    if (binding.accountId) {
      const account = await this.services.runPromise(
        Effect.gen(function* () {
          return yield* (yield* AccountDirectory).get(binding.accountId!);
        }),
      );
      if (account.transmissionId !== binding.transmissionId) {
        throw new Error(
          `Binding "${binding.id}" has an account outside transmission "${binding.transmissionId}".`,
        );
      }
    }
    const declared = new Set(
      (integration.capabilities ?? []).map((capability) => capability.id),
    );
    const unknown = binding.capabilities.filter(
      (capability) => !declared.has(capability),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Binding "${binding.id}" requests undeclared capabilities: ${unknown.join(", ")}.`,
      );
    }
    const referencedRoutes = [
      ...(binding.routeId ? [binding.routeId] : []),
      ...(binding.reply?.mode === "route" ? [binding.reply.routeId] : []),
    ];
    for (const routeId of referencedRoutes) {
      const route = await this.services.runPromise(
        Effect.gen(function* () {
          return yield* (yield* TopologyStore).getRoute(routeId);
        }),
      );
      if (route.transmissionId !== binding.transmissionId) {
        throw new Error(
          `Binding "${binding.id}" has a route outside transmission "${binding.transmissionId}".`,
        );
      }
      if (binding.reply?.mode === "route" && binding.reply.routeId === routeId) {
        if (route.direction !== "outbound") {
          throw new Error(
            `Binding "${binding.id}" reply route must be outbound.`,
          );
        }
      }
    }
  }

  private executionSignal(discovered: DiscoveredAgent): AnySignal {
    return compileAgentDefinition(
      discovered.definition,
      discovered.route,
    );
  }

  private async seedTopology(): Promise<void> {
    for (const route of this.application.routes ?? []) {
      await this.putRoute(route);
    }
    for (const binding of this.application.bindings ?? []) {
      await this.putBinding(binding);
    }
  }

  private runInBackground(kind: string, loop: Promise<void>): void {
    const observed = loop.catch((cause) => {
      this.observability.append({
        type: `runtime.${kind}.failed`,
        category: "system",
        data: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    });
    this.runnerLoops.push(observed);
  }

  private async settleRunnerLoops(timeoutMs: number): Promise<void> {
    if (this.runnerLoops.length === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      Promise.allSettled(this.runnerLoops).then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (!settled) {
      this.observability.append({
        type: "runtime.stop.loop-drain-timeout",
        category: "system",
        data: { timeoutMs, loops: this.runnerLoops.length },
      });
    }
  }

  private async enqueueCoreRequest(
    definitionId: string,
    request: FoundryRequest,
    runAt?: string,
  ): Promise<string> {
    const discovered = this.byRoute.get(definitionId);
    if (!discovered) throw new Error(`Foundry agent definition "${definitionId}" was not found.`);
    const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
    const conversation = await Effect.runPromise(this.data.getConversation(request.conversationId));
    if (!agent || !conversation) throw new Error("Core command references an unknown agent instance or conversation.");
    const runId = await this.signalRunner.triggerSignal(
      discovered.executionName,
      await this.executionEnvelope(request),
    );
    if (runAt) {
      const date = new Date(runAt);
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid future run date "${runAt}".`);
      await this.signalRunner.getAdapter().updateRun(runId, { nextRunAt: date });
    }
    return runId;
  }

  private async executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void> {
    if (command.type === "transmit") {
      await this.deliverOutbound(command, parentRunId);
      return;
    }
    if (command.type === "playbook.sync") {
      await this.syncAgentPlaybooks(command, parentRunId);
      return;
    }
    if (command.type === "schedule.sync") {
      await this.syncDefinitionSchedules(command, parentRunId);
      return;
    }
    if (command.type === "schedule.update") {
      await this.updateScheduledActivation(command, parentRunId);
      return;
    }
    if (command.type === "schedule.cancel") {
      await this.cancelScheduledActivation(command, parentRunId);
      return;
    }
    let agent = command.agentId
      ? await Effect.runPromise(this.data.getAgent(command.agentId))
      : null;
    if (!agent) {
      agent = await this.createAgent(command.definitionId, {
        ...(command.agentId ? { id: command.agentId } : {}),
        workspaceId: command.workspaceId,
        context: { spawnedByRunId: parentRunId },
      });
    }
    let conversation = command.conversationId
      ? await Effect.runPromise(this.data.getConversation(command.conversationId))
      : null;
    if (!conversation) {
      conversation = await this.createConversation(agent.id, {
        ...(command.conversationId ? { id: command.conversationId } : {}),
        workspaceId: command.workspaceId,
        context: { spawnedByRunId: parentRunId },
      });
    }
    const request: FoundryRequest = {
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: command.workspaceId,
      message: command.message,
      ...("payload" in command && command.payload !== undefined ? { payload: command.payload } : {}),
      source: {
        kind: command.type === "sleep" || command.type === "schedule" ? "activation" : command.type,
        id: command.id,
      },
    };
    if (command.type === "schedule" || command.type === "sleep") {
      const now = new Date();
      const activation: FoundryActivationRecord = {
        id: command.id,
        kind: command.type === "sleep" ? "sleep" : "scheduled",
        definitionId: command.definitionId,
        agentId: agent.id,
        conversationId: conversation.id,
        workspaceId: command.workspaceId,
        message: command.message,
        ...(command.type === "schedule" && command.payload !== undefined
          ? { payload: command.payload }
          : {}),
        timing: command.type === "sleep"
          ? { kind: "at", at: command.wakeAt }
          : command.timing,
        origin: "agent-tool",
        status: "pending",
        createdByRunId: parentRunId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await Effect.runPromise(this.data.putActivation(activation));
      await this.materializeActivation(activation);
      return;
    }
    const runId = await this.enqueueCoreRequest(
      command.definitionId,
      request,
      undefined,
    );
    this.observability.append({
      type: "core.command.accepted",
      category: "system",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, childRunId: runId, type: command.type },
    });
    if (command.type === "background" && command.reconvene) {
      void this.waitForRun<FoundryResult>(runId).then(async (run) => {
        const now = new Date().toISOString();
        const item: SharedInboxItem = {
          id: foundryId("inbox"),
          workspaceId: command.workspaceId,
          agentId: command.agentId,
          conversationId: command.conversationId,
          topic: "background.reconvene",
          payload: { commandId: command.id, run },
          status: "resolved",
          createdAt: now,
          updatedAt: now,
        };
        await Effect.runPromise(this.data.putInboxItem(item));
      });
    }
  }

  private async syncAgentPlaybooks(
    command: Extract<FoundryCoreCommand, { readonly type: "playbook.sync" }>,
    parentRunId: string,
  ): Promise<void> {
    const agent = await Effect.runPromise(this.data.getAgent(command.agentId));
    if (
      !agent ||
      agent.definitionId !== command.definitionId ||
      agent.workspaceId !== command.workspaceId
    ) {
      throw new Error("Playbook synchronization references an invalid agent instance.");
    }
    const currentById = new Map(agent.playbooks.map((item) => [item.id, item]));
    const instancePlaybooks = agent.playbooks.filter(
      (item) => item.origin !== "agent-definition",
    );
    const reconciled = command.playbooks.map((desired) => {
      const current = currentById.get(desired.id);
      return current && current.definitionRevision === desired.definitionRevision
        ? current
        : desired;
    });
    const updated: AgentInstance = {
      ...agent,
      playbooks: Object.freeze([...instancePlaybooks, ...reconciled]),
      updatedAt: new Date().toISOString(),
    };
    this.validatePlaybooks(command.definitionId, updated.playbooks, updated.installations);
    await Effect.runPromise(this.data.putAgent(updated));
    await this.reconcileApplicationConnections();
    this.observability.append({
      type: "agent.playbooks.composed",
      category: "agent",
      agent: command.definitionId,
      runId: parentRunId,
      data: {
        agentId: command.agentId,
        playbookIds: reconciled.map((item) => item.id),
      },
    });
  }

  private assertActivationOwnership(
    activation: FoundryActivationRecord,
    command: { readonly agentId: string; readonly workspaceId: string },
  ): void {
    if (
      activation.kind !== "scheduled" ||
      activation.agentId !== command.agentId ||
      activation.workspaceId !== command.workspaceId
    ) {
      throw new Error(`Scheduled activation "${activation.id}" is not owned by this agent instance.`);
    }
  }

  private backendScheduleId(activationId: string): string {
    return `activation/${activationId.replaceAll("_", "-")}`;
  }

  private async disarmActivation(activation: FoundryActivationRecord): Promise<void> {
    if (activation.timing.kind === "every" || activation.timing.kind === "cron") {
      await this.scheduleAdapter.delete(this.backendScheduleId(activation.id));
    } else if (activation.lastRunId) {
      await this.signalRunner.cancel(activation.lastRunId);
    }
    this.materializedActivations.delete(activation.id);
  }

  private async syncDefinitionSchedules(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.sync" }>,
    parentRunId: string,
  ): Promise<void> {
    const current = (await Effect.runPromise(this.data.listActivations(command.workspaceId)))
      .filter((item) =>
        item.agentId === command.agentId &&
        item.kind === "scheduled" &&
        item.origin === "agent-definition",
      );
    const desiredIds = new Set(command.schedules.map((item) => item.id));
    for (const stale of current.filter((item) => !desiredIds.has(item.id))) {
      await this.disarmActivation(stale);
      await Effect.runPromise(this.data.putActivation({
        ...stale,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      }));
    }
    for (const desired of command.schedules) {
      const existing = await Effect.runPromise(this.data.getActivation(desired.id));
      if (existing) this.assertActivationOwnership(existing, command);
      if (!desired.enabled) {
        if (existing && existing.status !== "cancelled") {
          await this.disarmActivation(existing);
          await Effect.runPromise(this.data.putActivation({
            ...existing,
            status: "cancelled",
            updatedAt: new Date().toISOString(),
          }));
        }
        continue;
      }
      const unchanged = existing?.definitionRevision === desired.revision;
      if (unchanged || existing?.status === "cancelled") continue;
      if (existing) await this.disarmActivation(existing);
      const now = new Date().toISOString();
      const activation: FoundryActivationRecord = {
        id: desired.id,
        kind: "scheduled",
        definitionId: command.definitionId,
        agentId: command.agentId,
        conversationId: command.conversationId,
        workspaceId: command.workspaceId,
        message: desired.message,
        ...(desired.payload !== undefined ? { payload: desired.payload } : {}),
        timing: desired.timing,
        origin: "agent-definition",
        scheduleName: desired.name,
        definitionRevision: desired.revision,
        status: "pending",
        createdByRunId: parentRunId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await Effect.runPromise(this.data.putActivation(activation));
      await this.materializeActivation(activation);
    }
  }

  private async updateScheduledActivation(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.update" }>,
    parentRunId: string,
  ): Promise<void> {
    const existing = await Effect.runPromise(this.data.getActivation(command.activationId));
    if (!existing) throw new Error(`Scheduled activation "${command.activationId}" was not found.`);
    this.assertActivationOwnership(existing, command);
    await this.disarmActivation(existing);
    const updated: FoundryActivationRecord = {
      ...existing,
      ...command.patch,
      status: "pending",
      createdByRunId: parentRunId,
      lastRunId: undefined,
      updatedAt: new Date().toISOString(),
    };
    await Effect.runPromise(this.data.putActivation(updated));
    await this.materializeActivation(updated);
    this.observability.append({
      type: "scheduled-action.updated",
      category: "activation",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, activationId: updated.id },
    });
  }

  private async cancelScheduledActivation(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.cancel" }>,
    parentRunId: string,
  ): Promise<void> {
    const existing = await Effect.runPromise(this.data.getActivation(command.activationId));
    if (!existing) throw new Error(`Scheduled activation "${command.activationId}" was not found.`);
    this.assertActivationOwnership(existing, command);
    await this.disarmActivation(existing);
    await Effect.runPromise(this.data.putActivation({
      ...existing,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    }));
    this.observability.append({
      type: "scheduled-action.cancelled",
      category: "activation",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, activationId: existing.id },
    });
  }

  private async reconstructActivations(): Promise<void> {
    for (const activation of await Effect.runPromise(this.data.listActivations())) {
      if (activation.status === "completed" || activation.status === "cancelled") continue;
      await this.materializeActivation(activation);
    }
  }

  private async materializeActivation(activation: FoundryActivationRecord): Promise<void> {
    if (this.materializedActivations.has(activation.id)) return;
    this.materializedActivations.add(activation.id);
    try {
      const discovered = this.byRoute.get(activation.definitionId);
      if (!discovered) {
        throw new Error(
          `Activation "${activation.id}" references unknown agent definition "${activation.definitionId}".`,
        );
      }
      const storedAgent = await Effect.runPromise(this.data.getAgent(activation.agentId));
      const storedConversation = await Effect.runPromise(
        this.data.getConversation(activation.conversationId),
      );
      if (!storedAgent || storedAgent.definitionId !== activation.definitionId) {
        throw new Error(`Activation "${activation.id}" references an invalid agent instance.`);
      }
      if (!storedConversation || storedConversation.agentId !== activation.agentId) {
        throw new Error(`Activation "${activation.id}" references an invalid conversation.`);
      }
      if (
        activation.timing.kind === "every" &&
        (!Number.isFinite(activation.timing.intervalMs) || activation.timing.intervalMs <= 0)
      ) {
        throw new Error(`Activation "${activation.id}" has an invalid recurrence interval.`);
      }
      if (
        activation.timing.kind === "at" &&
        Number.isNaN(new Date(activation.timing.at).getTime())
      ) {
        throw new Error(`Activation "${activation.id}" has an invalid wake time.`);
      }
      const request: FoundryRequest = {
        agentId: activation.agentId,
        conversationId: activation.conversationId,
        workspaceId: activation.workspaceId,
        message: activation.message,
        ...(activation.payload !== undefined ? { payload: activation.payload } : {}),
        source: { kind: "activation", id: activation.id },
      };
      if (activation.timing.kind === "every" || activation.timing.kind === "cron") {
        const now = new Date();
        const schedule: Schedule = {
          id: this.backendScheduleId(activation.id),
          kind: "signal",
          target: discovered.executionName,
          ...(activation.timing.kind === "every"
            ? { interval: `${activation.timing.intervalMs}ms` }
            : { cron: activation.timing.expression, timezone: activation.timing.timezone }),
          overlapPolicy: "skip",
          misfirePolicy: "fire-once",
          misfireGraceMs: 60_000,
          input: await this.executionEnvelope(request),
          enabled: true,
          nextRunAt: activation.timing.kind === "every"
            ? new Date(now.getTime() + activation.timing.intervalMs)
            : nextCronOccurrence(
                activation.timing.expression,
                activation.timing.timezone,
                now,
              ),
          createdAt: now,
          updatedAt: now,
          createdBy: `core:${activation.createdByRunId}`,
        };
        await this.scheduleAdapter.add(schedule);
        await Effect.runPromise(this.data.putActivation({
          ...activation,
          status: "active",
          updatedAt: now.toISOString(),
        }));
        this.observability.append({
          type: "scheduled-action.created",
          category: "activation",
          agent: activation.definitionId,
          runId: activation.createdByRunId,
          data: { commandId: activation.id, recurring: true, nextRunAt: schedule.nextRunAt },
        });
        return;
      }
      const runId = await this.enqueueCoreRequest(
        activation.definitionId,
        request,
        activation.timing.at,
      );
      const active: FoundryActivationRecord = {
        ...activation,
        status: "active",
        lastRunId: runId,
        updatedAt: new Date().toISOString(),
      };
      await Effect.runPromise(this.data.putActivation(active));
      this.observability.append({
        type: "core.command.accepted",
        category: "system",
        agent: activation.definitionId,
        runId: activation.createdByRunId,
        data: { commandId: activation.id, childRunId: runId, type: activation.kind },
      });
      void this.waitForRun(runId).then(async (run) => {
        if (!run || (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled")) return;
        await Effect.runPromise(this.data.putActivation({
          ...active,
          status: run.status === "cancelled" ? "cancelled" : "completed",
          updatedAt: new Date().toISOString(),
        }));
      }).catch((cause) => {
        this.observability.append({
          type: "activation.persistence.error",
          category: "activation",
          agent: activation.definitionId,
          runId,
          data: { error: cause instanceof Error ? cause.message : String(cause) },
        });
      });
    } catch (cause) {
      this.materializedActivations.delete(activation.id);
      throw cause;
    }
  }

  private async deliverOutbound(
    command: Extract<FoundryCoreCommand, { readonly type: "transmit" }>,
    parentRunId: string,
  ): Promise<void> {
    await this.dispatchOutbound({
      routeId: command.routeId,
      agentId: command.agentId,
      runId: parentRunId,
      payload: command.payload,
      commandId: command.id,
      ...(command.applicationId ? { applicationId: command.applicationId } : {}),
      ...(command.transmissionId
        ? { transmissionId: command.transmissionId }
        : {}),
    });
  }

  private async executionEnvelope(request: FoundryRequest): Promise<unknown> {
    const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
    const conversation = await Effect.runPromise(this.data.getConversation(request.conversationId));
    if (!agent || !conversation) throw new Error("Cannot schedule an unknown agent instance or conversation.");
    const activations = (await Effect.runPromise(this.data.listActivations(request.workspaceId)))
      .filter((activation) => activation.agentId === request.agentId);
    return { [FOUNDRY_EXECUTION_MARKER]: true, request, agent, conversation, activations };
  }

  private toFoundryRun<TOutput = unknown>(run: Run): FoundryRun<TOutput> {
    const storedInput = parseJson(run.input);
    const input =
      storedInput &&
      typeof storedInput === "object" &&
      (storedInput as Record<string, unknown>)[FOUNDRY_EXECUTION_MARKER] === true
        ? (storedInput as { request: unknown }).request
        : storedInput;
    const request = input && typeof input === "object" ? input as Partial<FoundryRequest> : undefined;
    return {
      id: run.id,
      agent: this.routeBySignalName.get(run.signalName) ?? run.signalName,
      kind: run.kind,
      status: run.status,
      input,
      ...(request?.agentId ? { agentId: request.agentId } : {}),
      ...(request?.conversationId ? { conversationId: request.conversationId } : {}),
      ...(request?.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(run.output !== undefined
        ? { output: parseJson(run.output) as TOutput }
        : {}),
      ...(run.error ? { error: run.error } : {}),
      attempts: run.attempts,
      maxAttempts: run.maxAttempts,
      timeoutMs: run.timeout,
      createdAt: run.createdAt.toISOString(),
      ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
      ...(run.completedAt
        ? { completedAt: run.completedAt.toISOString() }
        : {}),
    };
  }
}
