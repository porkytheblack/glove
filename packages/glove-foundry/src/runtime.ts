import { isDeepStrictEqual } from "node:util";
import type { AgentEvent } from "glove-core";
import { eventRecordId, eventDue, eventPolicySchema, messageOptionsSchema, foundryEventSchema, type FoundryEventRecord, type FoundryEventTarget, type FoundryEventPolicy, type FoundryMessageOptions } from "./event-delivery.js";
import { deliveryEvent } from "./delegation.js";
import { durableRoute, durableKey, durableInstanceId, agentInboxId, inheritedInstallations, type AgentMessageReceipt, type DurableMessageCommand } from "./durable-subagents.js";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Effect,
  Layer,
  ManagedRuntime as EffectManagedRuntime,
  Schema,
} from "effect";
import type { Message, TokenConsumptionCounter } from "glove-core";
import type { Run } from "station-signal";
import { FoundryExecutionBackend } from "./execution-backend.js";
import {
  activationScheduleRevision,
  compareOccurrences,
  firstScheduledTime,
  matchesOccurrenceFilter,
  planScheduleOccurrence,
  prunableOccurrences,
  scheduleOccurrenceId,
  scheduleRevisionMatches,
  TERMINAL_OCCURRENCE_STATUSES,
  type FoundryScheduleOccurrence,
  type FoundryScheduleOccurrenceFilter,
  type ScheduleOccurrencePlan,
} from "./schedule-occurrences.js";
import {
  EMPTY_FOUNDRY_APPLICATION,
  type FoundryApplication,
} from "./application.js";
import type { FoundryConfig } from "./config.js";
import { DEFAULT_FOUNDRY_CONFIG } from "./config.js";
import { FOUNDRY_MODEL_REQUESTS_ENV } from "./request-trace.js";
import {
  FOUNDRY_APPLICATION_ENV,
  FOUNDRY_EXECUTION_MARKER,
  FOUNDRY_RUN_PROCESS_EVENT,
  hostedMeshOptions,
  resolveResolvable,
} from "./definition.js";
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
import { ConversationGate } from "./conversation-gate.js";
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
import { builtinsForCommand, FOUNDRY_BUILTINS_MOUNTED_EVENT } from "./builtins.js";
import {
  FOUNDRY_CONVERSATION_LEASE_EVENT,
  FOUNDRY_CONVERSATION_LISTEN_EVENT,
  FOUNDRY_MAILBOX_DIRECTORY_ENV,
  delegationFromContext,
  drainMailbox,
  isDelegationId,
  isOpenDelegation,
  renderDelegatedTask,
  renderDeliveries,
  undeliveredUpdate,
  workerAgentId,
  writeConversationLease,
  writeMailboxDelivery,
  type FoundryConversationDelivery,
  type FoundryDelegation,
  type FoundryDelegationCommand,
  type FoundryDelegationStatus,
  type FoundryMeshDelivery,
} from "./delegation.js";
import {
  DEFAULT_MESH_REFUSAL,
  isBindableThreadId,
  isMeshCommand,
  isOpenThread,
  isTakenOverBy,
  isThreadId,
  meshIdentity,
  newMessageId,
  startedThreadIds,
  threadFromContext,
  threadSubject,
  type FoundryMeshCommand,
  type FoundryMeshDecision,
  type FoundryMeshHeldMessage,
  type FoundryMeshHookContext,
  type FoundryMeshMessage,
  type FoundryMeshSend,
  type FoundryMeshSent,
  type FoundryMeshThread,
  type FoundryMeshThreadStatus,
} from "./mesh.js";
import {
  FOUNDRY_CORE_COMMAND_DIRECTORY_ENV,
  claimFoundryCoreCommandRequest,
  getFoundryCoreCommandRequest,
  monitorFoundryCoreCommandRequest,
  settleFoundryCoreCommandRequest,
} from "./core-command-result.js";
import {
  DEFAULT_APPROVAL_EXPIRES_AFTER_MS,
  DEFAULT_APPROVAL_WAIT_MS,
  FOUNDRY_APPROVAL_DIRECTORY_ENV,
  FOUNDRY_APPROVAL_POLICY_ENV,
  foundryApprovalRequested,
  foundryApprovalSuspended,
  isFoundryApprovalId,
  listFoundryApprovals,
  markFoundryApprovalSuspended,
  readFoundryApprovalResolution,
  resolveFoundryApproval,
  type FoundryApproval,
  type FoundryApprovalDecision,
  type FoundryApprovalPolicy,
  type FoundryApprovalStatus,
} from "./approval.js";
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
  type UpdateConversationOptions,
  type UpdateAgentInstanceOptions,
  type FoundryDataAdapter,
  type FoundryActivationRecord,
  type FoundryMessageInput,
  type FoundryPendingInbound,
  type FoundryRequest,
  type FoundryResult,
  type FoundryTask,
  type EnvironmentValue,
  type SharedInboxItem,
  type WorkspaceEntry,
  freezeGloveMessage,
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

export interface FoundrySteerResult<TOutput = unknown> {
  /** The run whose direction was changed. */
  readonly fromRunId: string;
  /** True when an active source run accepted cooperative cancellation. */
  readonly interrupted: boolean;
  /** The replacement run in the same instance and conversation. */
  readonly run: FoundryRun<TOutput>;
}

/** Exact native Glove history and counters for one persisted conversation. */
export interface FoundryConversationTranscript {
  readonly conversation: Conversation;
  readonly messages: ReadonlyArray<Message>;
  readonly turnCount: number;
  readonly tokenCount: number;
  readonly tokenConsumption?: TokenConsumptionCounter;
  readonly page: {
    readonly offset: number;
    readonly limit: number;
    readonly total: number;
    readonly hasEarlier: boolean;
    readonly hasLater: boolean;
  };
  /** False means the definition did not configure a durable conversation store. */
  readonly persisted: boolean;
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

interface ResolvedExecutionConfig {
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly pollIntervalMs: number;
  readonly idlePollIntervalMs: number;
}

type DelegationPatch = Partial<Pick<
  FoundryDelegation,
  "status" | "question" | "result" | "error" | "undelivered" | "pendingReplies" | "pendingReplyIds" | "updateId"
>>;

type ThreadPatch = Partial<Pick<
  FoundryMeshThread,
  "status" | "question" | "reply" | "error" | "messageIds" | "held" | "outbox" | "takenOver"
>>;

/** The application's mesh refused a send: the sender reads `message`, the trace keeps `reason`. */
class MeshRefusal extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
  }
}

/** Commit retries for a thread's outbox, before the next start takes over. */
const MESH_COMMIT_RETRY_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;

function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** Where a delegation delivery or mesh message goes: one agent instance's conversation. */
interface DeliveryTarget {
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
}

/** Where a run started from held deliveries came from. */
function deliverySource(deliveries: ReadonlyArray<FoundryConversationDelivery>): FoundryRequest["source"] {
  const first = deliveries[0]!;
  if (first.kind === "mesh") return { kind: "mesh", id: first.message.threadId };
  if (first.durable?.event.kind?.startsWith("delegation.")) return { kind: "delegation", id: first.durable.event.id };
  if (first.kind === "agent-message") return { kind: "agent-message", id: first.pendingId };
  if (deliveries.every((delivery) => delivery.kind === "transmission")) {
    return first.kind === "transmission"
      ? { kind: "transmission", id: first.routeId, eventId: first.eventId }
      : { kind: "transmission" };
  }
  const delegation = deliveries.find((delivery) => delivery.kind !== "transmission");
  return { kind: "delegation", ...(delegation && "delegationId" in delegation ? { id: delegation.delegationId } : {}) };
}

function deliveryText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

// A cancelled run's process reports "released" when it has let go of its
// conversation. Station SIGKILLs it 5 s after the cancel's SIGTERM, so a steer
// never needs to wait longer than that plus margin.
const RUN_PROCESS_RELEASE_TIMEOUT_MS = 10_000;
// A started run whose process has not reported "acquired" by now died on the
// SIGTERM before it ran any agent code.
const RUN_PROCESS_REPORT_GRACE_MS = 1_000;
const RUN_PROCESS_RETENTION_MS = 60_000;

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
  private readonly signalRunner: FoundryExecutionBackend;
  private readonly services: EffectManagedRuntime.ManagedRuntime<
    AccountDirectory | TopologyStore | EventStore | GrantResolver,
    unknown
  >;
  private readonly runnerLoops: Promise<void>[] = [];
  private readonly materializedActivations = new Set<string>();
  // Serialize host-owned activation transitions across asynchronous adapters and daemon IPC.
  private readonly activationTransitions = Effect.unsafeMakeSemaphore(1);
  private readonly activationDispatches = new Map<string, object>();
  private readonly activationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Occurrences when the data adapter does not store them. */
  private readonly memoryOccurrences = new Map<string, FoundryScheduleOccurrence>();
  /** Occurrences this process handed (or is handing) to a run. */
  private readonly occurrencesInHand = new Set<string>();
  /** Run id to the occurrence it delivers. */
  private readonly occurrenceRuns = new Map<string, string>();
  /** How recent runs settled, for an occurrence recorded after its run already finished. */
  private readonly recentlySettledRuns = new Map<string, "completed" | "failed" | "cancelled">();
  /** Whether each run's child process still holds its conversation, from FOUNDRY_RUN_PROCESS_EVENT. */
  private readonly runProcesses = new Map<string, "acquired" | "released">();
  private readonly approvalDirectory = join(
    tmpdir(),
    "glove-foundry-approvals",
    randomUUID(),
  );
  private readonly coreCommandDirectory = join(
    tmpdir(),
    "glove-foundry-core-commands",
    randomUUID(),
  );
  private readonly mailboxDirectory = join(
    tmpdir(),
    "glove-foundry-mailboxes",
    randomUUID(),
  );
  /** The run listening for deliveries on each conversation. */
  private readonly conversationListeners = new Map<string, string>();
  /** Runs holding each conversation, from enqueue or acquire until release. */
  private readonly conversationRuns = new Map<string, Set<string>>();
  private readonly runConversations = new Map<string, string>();
  /** Deliveries waiting for their conversation to be free. */
  private readonly heldDeliveries = new Map<
    string,
    { target: DeliveryTarget; deliveries: FoundryConversationDelivery[] }
  >();
  private readonly conversationQueues = new Map<string, Promise<unknown>>();
  /** Runs cancelled by steering: a replacement follows, so their delegation stays open. */
  private readonly steeredRuns = new Set<string>();
  /** One run at a time per conversation; the next starts once the one ahead has let go. */
  private readonly gate = new ConversationGate({
    idle: (conversationId) => {
      void this.inConversation(conversationId, () => this.flushHeldDeliveries(conversationId))
        .catch((cause) => this.reportDeliveryFailure(conversationId, cause));
    },
    failed: (conversationId, runId, cause) => {
      this.observability.append({
        type: "conversation.run.start-failed",
        category: "system",
        runId,
        data: { conversationId, error: cause instanceof Error ? cause.message : String(cause) },
      });
    },
  });
  /** Pending inbound records each run is handling, so they are cleared when it settles. */
  private readonly eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Events a run withheld because preparing them failed: attempts so far and the pending retry. */
  private readonly eventRetries = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout> }>();
  private readonly completedEventRuns = new Map<string, ReadonlySet<string>>();
  private readonly pendingInboundByRun = new Map<string, Set<string>>();
  /** Recently settled runs, for a record assigned to a run that already finished. */
  private readonly settledRuns = new Set<string>();
  /** The built-ins each restricted run mounted, as it reported them. Runs without a policy are absent. */
  private readonly runBuiltins = new Map<string, { readonly tools: ReadonlySet<string>; readonly transmissionTools: boolean }>();
  /** How runs treat approvals; durable when the data adapter can keep them. */
  private readonly approvalPolicy: FoundryApprovalPolicy;
  /** Approval records change one at a time. */
  private approvalWrites: Promise<unknown> = Promise.resolve();
  private started = false;
  private stopping = false;
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
    const durableApprovals = Boolean(
      this.data.putApproval && this.data.getApproval && this.data.listApprovals
        && this.data.claimEvent && this.data.putEvent && this.data.listEvents,
    );
    this.approvalPolicy = {
      durable: durableApprovals,
      waitMs: this.application.approvals?.waitMs ?? (durableApprovals ? DEFAULT_APPROVAL_WAIT_MS : 300_000),
      expiresAfterMs: this.application.approvals?.expiresAfterMs ?? DEFAULT_APPROVAL_EXPIRES_AFTER_MS,
    };

    for (const discovered of this.agents) {
      this.byRoute.set(discovered.route, discovered);
      this.routeBySignalName.set(discovered.executionName, discovered.route);
    }
    this.observer = new FoundryObserver(
      this.observability,
      (name) => this.routeBySignalName.get(name) ?? name,
      (event) => {
        if (event.type === FOUNDRY_RUN_PROCESS_EVENT) {
          const state = (event.data as { state?: unknown } | null)?.state;
          if (state === "acquired" || state === "released") {
            this.trackRunProcess(event.run.id, state);
            this.trackConversationRun(event.run, state);
          }
          return;
        }
        if (event.type === FOUNDRY_CONVERSATION_LISTEN_EVENT) {
          const state = (event.data as { state?: unknown } | null)?.state;
          if (state === "on" || state === "off") this.trackConversationListener(event.run, state);
          return;
        }
        if (event.type === FOUNDRY_CONVERSATION_LEASE_EVENT) {
          const conversationId = this.toFoundryRun(event.run).conversationId;
          if (!conversationId) return;
          const runId = event.run.id;
          void this.gate.claim(conversationId, runId)
            .then(() => writeConversationLease(this.mailboxDirectory, runId))
            .catch((cause) => this.reportDeliveryFailure(conversationId, cause));
          return;
        }
        if (event.type === "foundry.approval.requested" || event.type === "foundry.approval.suspended" || event.type === "foundry.approval.settled") {
          void this.recordApprovalEvent(event.type, event.data).catch((cause) => this.reportApprovalFailure(event.run.id, cause));
          return;
        }
        if (event.type === FOUNDRY_BUILTINS_MOUNTED_EVENT) {
          const data = event.data as { tools?: ReadonlyArray<string>; transmissionTools?: ReadonlyArray<string> } | undefined;
          this.runBuiltins.set(event.run.id, {
            tools: new Set(data?.tools ?? []),
            transmissionTools: (data?.transmissionTools ?? []).length > 0,
          });
          this.observability.append({
            type: FOUNDRY_BUILTINS_MOUNTED_EVENT,
            category: "system",
            agent: event.route,
            runId: event.run.id,
            data: { tools: [...(data?.tools ?? [])], transmissionTools: [...(data?.transmissionTools ?? [])] },
          });
          return;
        }
        if (event.type === FOUNDRY_CORE_COMMAND_EVENT) {
          const refusal = this.withheldBuiltinRefusal(event.data as FoundryCoreCommand, event.run.id);
          if (refusal) {
            void this.refuseCoreCommand(event.data as FoundryCoreCommand, event.run.id, refusal, event.route);
            return;
          }
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
      (settled) => {
        void this.handleRunSettled(settled).catch((cause) => {
          this.observability.append({
            type: "delegation.failed-to-report",
            category: "system",
            agent: settled.route,
            runId: settled.run.id,
            data: { error: cause instanceof Error ? cause.message : String(cause) },
          });
        });
      },
    );
    this.connectionSupervisor = new ApplicationConnectionSupervisor({
      receive: async (input) => {
        const runs = await this.dispatchInbound(input);
        if (!input.awaitCompletion || runs.length === 0) return;
        if (input.signal?.aborted) return;
        const completion = Promise.all(runs.map((run) =>
          this.waitForRun(run.id, { timeoutMs: Math.max(1_000, run.timeoutMs + 1_000) })
        ));
        await new Promise<void>((resolveWait) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            input.signal?.removeEventListener("abort", finish);
            resolveWait();
          };
          if (input.signal?.aborted) {
            finish();
            return;
          }
          input.signal?.addEventListener("abort", finish, { once: true });
          void completion.then(finish, finish);
        });
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

    if (this.application.daemon && !this.applicationFilePath) {
      throw new Error("A daemon adapter requires applicationFilePath so Foundry can load it in the managed process.");
    }
    this.signalRunner = new FoundryExecutionBackend({
      rootDir: this.rootDir,
      agents: this.agents.map(agent => ({ route: agent.route, filePath: agent.filePath })),
      runner: this.execution,
      observer: this.observer,
      env: {
        [FOUNDRY_APPROVAL_DIRECTORY_ENV]: this.approvalDirectory,
        [FOUNDRY_APPROVAL_POLICY_ENV]: JSON.stringify(this.approvalPolicy),
        [FOUNDRY_CORE_COMMAND_DIRECTORY_ENV]: this.coreCommandDirectory,
        [FOUNDRY_MAILBOX_DIRECTORY_ENV]: this.mailboxDirectory,
        ...(this.applicationFilePath ? { [FOUNDRY_APPLICATION_ENV]: this.applicationFilePath } : {}),
        ...(options.config?.observability?.modelRequests === false ? { [FOUNDRY_MODEL_REQUESTS_ENV]: "off" } : {}),
      },
    });

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
        await Promise.all([
          mkdir(this.approvalDirectory, { recursive: true, mode: 0o700 }),
          mkdir(this.coreCommandDirectory, { recursive: true, mode: 0o700 }),
          mkdir(this.mailboxDirectory, { recursive: true, mode: 0o700 }),
        ]);
        await this.seedTopology();
        for (const instance of await this.listAgentInstances()) {
          if (instance.durableSubagent) continue;
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
        await this.reconstructActivations();
        this.runInBackground("signal", this.signalRunner.start());
        await this.reconcileApplicationConnections();
        // Restore queued deliveries before repairing tasks that have no delivery record.
        void this.redeliverInbound().then(() => this.redeliverDelegations()).then(() => this.redeliverThreads()).then(() => this.redeliverEvents())
          .then(() => this.reconcileApprovals())
          .catch((cause) => this.reportDeliveryFailure("startup", cause));
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

  stopEffect(): Effect.Effect<void, FoundryRuntimeError> {
    return promiseEffect("runtime.stop", async () => {
      if (this.disposed) return;
      if (!this.started) {
        await this.services.dispose();
        await Promise.all([
          rm(this.approvalDirectory, { recursive: true, force: true }),
          rm(this.coreCommandDirectory, { recursive: true, force: true }),
          rm(this.mailboxDirectory, { recursive: true, force: true }),
        ]);
        this.disposed = true;
        return;
      }
      this.stopping = true;
      for (const timer of this.eventTimers.values()) clearTimeout(timer);
      this.eventTimers.clear();
      for (const retry of this.eventRetries.values()) if (retry.timer) clearTimeout(retry.timer);
      this.eventRetries.clear();
      for (const timer of this.activationTimers.values()) clearTimeout(timer);
      this.activationTimers.clear();
      this.activationDispatches.clear();
      await this.connectionSupervisor.stopAll();
      this.observability.append({ type: "runtime.stop.signals", category: "system", data: {} });
      await this.signalRunner.stop({ graceful: true, timeoutMs: 10_000 });
      this.observability.append({ type: "runtime.stop.loops", category: "system", data: {} });
      await this.settleRunnerLoops(1_000);
      this.runnerLoops.length = 0;
      await this.services.dispose();
      await Promise.all([
        rm(this.approvalDirectory, { recursive: true, force: true }),
        rm(this.coreCommandDirectory, { recursive: true, force: true }),
        rm(this.mailboxDirectory, { recursive: true, force: true }),
      ]);
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
    options: { readonly front?: boolean } = {},
  ): Effect.Effect<FoundryRun, FoundryRuntimeError> {
    return promiseEffect("agent.request", async () => {
      if (!this.started) throw new Error("Foundry runtime is not started.");
      const discovered = this.byRoute.get(route);
      if (!discovered) throw new Error(`Foundry agent "${route}" was not found.`);
      const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
      if (!agent) throw new Error(`Foundry agent instance "${request.agentId}" was not found.`);
      await this.assertDurableActive(agent);
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
      await Effect.runPromise(this.data.putConversation(Object.freeze({
        ...conversation,
        updatedAt: new Date().toISOString(),
      })));
      const runId = await this.admitRun(discovered.executionName, request, options);
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
    if (definitionId.includes("/workers/") || options.durableSubagent) throw new Error("Create durable workers through subagent(parentAgentId, name).");
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

  /** Provision exactly one owned worker per parent instance and declared slot. */
  subagent(parentAgentId: string, name: string): Promise<AgentInstance> {
    return this.inConversation("durable:mutations", () => this.ensureSubagent(parentAgentId, name));
  }

  private async ensureSubagent(parentAgentId: string, name: string): Promise<AgentInstance> {
    const parent = await Effect.runPromise(this.data.getAgent(parentAgentId));
    if (!parent) throw new Error(`Parent agent "${parentAgentId}" does not exist.`);
    await this.assertDurableActive(parent);
    const selection = this.byRoute.get(parent.definitionId)?.definition.durableSubagents?.[name];
    if (!selection || !Object.hasOwn(this.byRoute.get(parent.definitionId)!.definition.durableSubagents ?? {}, name)) throw new Error(`Agent "${parentAgentId}" has no durable worker "${name}".`);
    const route = durableRoute(parent.definitionId, name);
    const child = await Effect.runPromise(this.data.provisionAgent({
      id: durableInstanceId(parent.id, name),
      definitionId: route,
      provisioningKey: durableKey(parent.id, name),
      workspaceId: parent.workspaceId,
      context: selection.inherit?.context ? parent.context : {},
      durableSubagent: { parentAgentId: parent.id, name, status: "active" },
    }));
    if (child.definitionId !== route || child.workspaceId !== parent.workspaceId || child.durableSubagent?.parentAgentId !== parent.id || child.durableSubagent.name !== name) throw new Error("Durable worker ownership conflict.");
    await this.assertDurableActive(child);
    return child;
  }

  async listSubagents(parentAgentId: string): Promise<ReadonlyArray<AgentInstance>> {
    return (await this.listAgentInstances()).filter((agent) => agent.durableSubagent?.parentAgentId === parentAgentId);
  }

  private async assertDurableActive(agent: AgentInstance): Promise<void> {
    if (agent.definitionId.includes("/workers/") && !agent.durableSubagent) throw new Error("Durable worker ownership is missing.");
    const seen = new Set<string>();
    let current = agent;
    while (current.durableSubagent) {
      if (seen.has(current.id)) throw new Error("Cyclic durable worker ownership.");
      seen.add(current.id);
      const ownership = current.durableSubagent;
      if (ownership.status !== "active") throw new Error(`Durable worker "${current.id}" is ${ownership.status}.`);
      const parent = await Effect.runPromise(this.data.getAgent(ownership.parentAgentId));
      if (!parent || parent.workspaceId !== current.workspaceId || !this.byRoute.get(parent.definitionId)?.definition.durableSubagents?.[ownership.name] || current.definitionId !== durableRoute(parent.definitionId, ownership.name)) throw new Error(`Durable worker "${current.id}" is detached from its definition or parent.`);
      current = parent;
    }
  }

  private async effectiveAgent(agent: AgentInstance): Promise<AgentInstance> {
    await this.assertDurableActive(agent);
    if (!agent.durableSubagent) return agent;
    const parent = await this.effectiveAgent((await Effect.runPromise(this.data.getAgent(agent.durableSubagent.parentAgentId)))!);
    const definition = this.byRoute.get(agent.definitionId)!.definition;
    const selection = this.byRoute.get(parent.definitionId)!.definition.durableSubagents![agent.durableSubagent.name]!;
    const inheritedIds = new Set((selection.inherit?.apps ?? []).map((app) => typeof app === "string" ? app : app.id));
    return { ...agent, installations: [
      ...agent.installations.filter((item) => item.kind !== "application" || !inheritedIds.has(item.id)),
      ...inheritedInstallations(parent, definition, selection),
    ] };
  }

  private async ensureAgentEventConversation(agent: AgentInstance): Promise<Conversation> {
    const id = agentInboxId(agent.id);
    return this.inConversation(`agent-events:${id}`, async () => {
      const existing = await Effect.runPromise(this.data.getConversation(id));
      if (existing) {
        if (existing.agentId !== agent.id || existing.workspaceId !== agent.workspaceId) throw new Error("Agent event conversation ownership conflict.");
        return existing;
      }
      return this.createConversation(agent.id, { id, title: "Agent events" });
    });
  }

  /** A message to an owned worker, independent of any delegated task. */
  async messageSubagent(parentAgentId: string, name: string, message: string, options: FoundryMessageOptions = {}): Promise<AgentMessageReceipt> {
    return this.inConversation("durable:mutations", async () => {
      const child = await this.ensureSubagent(parentAgentId, name);
      return this.postAgentMessage(child, message, parentAgentId, options.id, options);
    });
  }

  private async postAgentMessage(target: AgentInstance, message: string, from: string, messageId = `message_${randomUUID()}`, options: FoundryMessageOptions = {}, replyTo?: FoundryEventTarget): Promise<AgentMessageReceipt> {
    options = messageOptionsSchema.parse(options);
    if (typeof message !== "string" || !message.trim()) throw new Error("Agent messages must not be empty.");
    const conversationId = options.conversationId ?? (await this.ensureAgentEventConversation(target)).id;
    return this.acceptEvent({ agentId: target.id, conversationId }, {
      id: options.id ?? messageId, source: `foundry:agent:${from}`, kind: "agent-message", content: message,
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}), metadata: { from, ...(replyTo ? { replyTo } : {}) },
    }, options);
  }

  /** Persist a spontaneous event before dispatching it to one exact runtime context. */
  async emitEvent(target: FoundryEventTarget, event: AgentEvent, policy: FoundryEventPolicy = {}): Promise<AgentMessageReceipt> {
    return this.inConversation("durable:mutations", () => this.acceptEvent(target, event, policy));
  }

  private async acceptEvent(target: FoundryEventTarget, event: AgentEvent, policy: FoundryEventPolicy): Promise<AgentMessageReceipt> {
    foundryEventSchema.parse(event);
    eventPolicySchema.parse(policy);
    const agent = await Effect.runPromise(this.data.getAgent(target.agentId));
    const conversation = await Effect.runPromise(this.data.getConversation(target.conversationId));
    if (!agent || conversation?.agentId !== agent.id || conversation.workspaceId !== agent.workspaceId) throw new Error("Event target must name a conversation owned by the addressed agent.");
    await this.assertDurableActive(agent);
    const defaults = this.byRoute.get(agent.definitionId)?.definition.eventDelivery;
    const resolved = eventPolicySchema.parse({ ...defaults, ...(event.whenIdle && event.whenIdle !== "auto" ? { whenIdle: event.whenIdle } : {}), ...policy });
    const id = eventRecordId(target, event.id);
    await this.deliver({ ...target, definitionId: agent.definitionId, workspaceId: agent.workspaceId }, [{
      kind: "agent-message", pendingId: id,
      message: typeof event.content === "string" ? event.content : JSON.stringify(event.content),
      durable: { id, event, policy: resolved },
    }]);
    const record = (await Effect.runPromise(this.data.listEvents!())).find((item) => item.id === id);
    return { messageId: event.id, ...target, ...(record?.runId ? { runId: record.runId } : {}) };
  }

  private async executeAgentMessage(command: DurableMessageCommand): Promise<AgentMessageReceipt> {
    return this.inConversation("durable:mutations", async () => {
      const sender = await Effect.runPromise(this.data.getAgent(command.agentId));
      const conversation = await Effect.runPromise(this.data.getConversation(command.conversationId));
      if (!sender || sender.definitionId !== command.definitionId || sender.workspaceId !== command.workspaceId || conversation?.agentId !== sender.id) throw new Error("Invalid agent message sender.");
      await this.assertDurableActive(sender);
      const target = command.to === "parent"
        ? sender.durableSubagent && await Effect.runPromise(this.data.getAgent(sender.durableSubagent.parentAgentId))
        : await this.ensureSubagent(sender.id, command.to);
      if (!target || target.workspaceId !== sender.workspaceId) throw new Error("Agent message recipient is not an owned worker or parent.");
      return this.postAgentMessage(target, command.message, sender.id, command.id, command.delivery, { agentId: sender.id, conversationId: command.conversationId });
    });
  }

  /** Inspect owned records without provisioning or requiring the declaration to still exist. */
  async subagentData(parentAgentId: string, name: string) {
    const agent = (await this.listSubagents(parentAgentId)).find((item) => item.durableSubagent?.name === name);
    if (!agent) throw new Error(`Durable worker "${name}" was not found.`);
    const conversations = await Effect.runPromise(this.data.listConversations(agent.id));
    return {
      agent, conversations,
      events: this.data.listEvents ? (await Effect.runPromise(this.data.listEvents())).filter((item) => item.target.agentId === agent.id) : [],
      children: await this.listSubagents(agent.id),
      activations: (await Effect.runPromise(this.data.listActivations(agent.workspaceId))).filter((item) => item.agentId === agent.id),
      pendingMessages: this.data.listPendingInbound ? (await Effect.runPromise(this.data.listPendingInbound())).filter((item) => item.request.agentId === agent.id) : [],
      tasks: (await Effect.runPromise(this.data.listTasks(agent.workspaceId))).filter((item) => item.agentId === agent.id),
      inbox: (await Effect.runPromise(this.data.listInboxItems(agent.workspaceId))).filter((item) => item.agentId === agent.id),
    };
  }

  async archiveSubagent(parentAgentId: string, name: string): Promise<AgentInstance> {
    return this.inConversation("durable:mutations", async () => {
      const { agent } = await this.subagentData(parentAgentId, name);
      const archive = async (current: AgentInstance): Promise<AgentInstance> => {
        if (current.durableSubagent!.status === "purged") return current;
        const archived = { ...current, durableSubagent: { ...current.durableSubagent!, status: "archived" as const }, updatedAt: new Date().toISOString() };
        await Effect.runPromise(this.data.putAgent(archived));
        for (const child of await this.listSubagents(current.id)) await archive(child);
        await this.withActivationTransition(async () => {
          for (const activation of await Effect.runPromise(this.data.listActivations(current.workspaceId))) {
            if (activation.agentId !== current.id || ["cancelled", "completed"].includes(activation.status)) continue;
            await this.disarmActivation(activation, "paused");
            await Effect.runPromise(this.data.putActivation({ ...activation, status: "paused", updatedAt: new Date().toISOString() }));
          }
        });
        for (const conversation of await Effect.runPromise(this.data.listConversations(current.id))) {
          this.heldDeliveries.delete(conversation.id);
          this.conversationListeners.delete(conversation.id);
          await drainMailbox(this.mailboxDirectory, conversation.id);
        }
        for (const run of await this.listRuns(current.definitionId)) {
          if (run.agentId === current.id && !["completed", "cancelled", "failed"].includes(run.status)) {
            await this.cancel(run.id);
            const settled = await this.waitForRun(run.id, { timeoutMs: 30_000 });
            if (settled && !["completed", "cancelled", "failed"].includes(settled.status)) throw new Error("Worker is still stopping; retry archival before purging.");
            if (settled) await this.waitForRunProcessRelease(settled, current.definitionId);
          }
        }
        return archived;
      };
      const archived = await archive(agent);
      if (this.started) await this.reconcileApplicationConnections();
      this.observability.append({ type: "agent.subagent.archived", category: "agent", agent: agent.definitionId, data: { agentId: agent.id } });
      return archived;
    });
  }

  async resumeSubagent(parentAgentId: string, name: string): Promise<AgentInstance> {
    return this.inConversation("durable:mutations", async () => {
      const { agent } = await this.subagentData(parentAgentId, name);
      if (agent.durableSubagent!.status === "purged") throw new Error("A purged worker cannot be resumed.");
      if (agent.durableSubagent!.status === "active") return agent;
      const resumed = { ...agent, durableSubagent: { ...agent.durableSubagent!, status: "active" as const }, updatedAt: new Date().toISOString() };
      await this.assertDurableActive(resumed);
      await Effect.runPromise(this.data.putAgent(resumed));
      for (const pending of this.data.listPendingInbound ? await Effect.runPromise(this.data.listPendingInbound()) : []) {
        if (pending.request.agentId === agent.id) await this.admitInbound(pending);
      }
      await this.redeliverEvents(agent.id);
      return resumed;
    });
  }

  /** Purge requires archival and an explicit application cleanup hook. Shared data is never passed to it. */
  async purgeSubagent(parentAgentId: string, name: string): Promise<void> {
    return this.inConversation("durable:mutations", async () => {
      const { agent, conversations, children } = await this.subagentData(parentAgentId, name);
      if (agent.durableSubagent!.status === "purged") return;
      if (agent.durableSubagent!.status !== "archived") throw new Error("Archive the worker before purging it.");
      const running = (await this.listRuns(agent.definitionId)).some((run) => run.agentId === agent.id && !["completed", "failed", "cancelled"].includes(run.status));
      if (running) throw new Error("Wait for worker runs to stop before purging.");
      if (children.some((child) => child.durableSubagent?.status !== "purged")) throw new Error("Purge owned child workers first.");
      if (!this.data.purgeAgentData) throw new Error("The data adapter does not support purging agent data.");
      const parent = await Effect.runPromise(this.data.getAgent(parentAgentId));
      const selection = parent && this.byRoute.get(parent.definitionId)?.definition.durableSubagents?.[name];
      if (!selection?.cleanup) throw new Error("Define an idempotent durable subagent cleanup hook to purge private external memory, transcripts, and files. Keep the declaration until cleanup completes.");
      await selection.cleanup({ agent, conversationIds: conversations.map((item) => item.id) });
      await Effect.runPromise(this.data.purgeAgentData(agent.id));
      this.observability.append({ type: "agent.subagent.purged", category: "agent", agent: agent.definitionId, data: { agentId: agent.id } });
    });
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
    await this.assertDurableActive(current);
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
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
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

  async updateConversation(
    agentId: string,
    conversationId: string,
    options: UpdateConversationOptions,
  ): Promise<Conversation> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    const current = await Effect.runPromise(this.data.getConversation(conversationId));
    if (!current || current.agentId !== agent.id) {
      throw new Error(`Conversation "${conversationId}" does not belong to agent instance "${agent.id}".`);
    }
    const title = options.title?.trim();
    if (options.title !== undefined && (!title || title.length > 120)) {
      throw new Error("A conversation title must contain 1 to 120 characters.");
    }
    const conversation = Object.freeze({
      ...current,
      ...(title ? { title } : {}),
      ...(options.context ? { context: Object.freeze(structuredClone(options.context)) } : {}),
      updatedAt: new Date().toISOString(),
    });
    await Effect.runPromise(this.data.putConversation(conversation));
    this.observability.append({
      type: "conversation.updated",
      category: "agent",
      agent: agent.definitionId,
      data: { agentId, conversationId, titleChanged: options.title !== undefined },
    });
    return conversation;
  }

  /**
   * Read the same StoreAdapter the child agent process uses. Foundry never
   * reconstructs chat history from runs or observability events: adapters stay
   * the single source of truth for durable conversations.
   */
  async conversationTranscript(
    agentId: string,
    conversationId: string,
    options: { readonly offset?: number; readonly limit?: number } = {},
  ): Promise<FoundryConversationTranscript> {
    const agent = await Effect.runPromise(this.data.getAgent(agentId));
    if (!agent) throw new Error(`Foundry agent instance "${agentId}" was not found.`);
    const conversation = await Effect.runPromise(this.data.getConversation(conversationId));
    if (!conversation || conversation.agentId !== agent.id) {
      throw new Error(`Conversation "${conversationId}" does not belong to agent instance "${agent.id}".`);
    }
    if (conversation.workspaceId !== agent.workspaceId) {
      throw new Error("The agent instance and conversation must share a workspace.");
    }
    const discovered = this.byRoute.get(agent.definitionId);
    if (!discovered) {
      throw new Error(`Foundry agent definition "${agent.definitionId}" was not found.`);
    }
    const storeFactory = discovered.definition.store ?? this.application.conversationStore;
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    if (!storeFactory) {
      return Object.freeze({
        conversation,
        messages: Object.freeze([]),
        turnCount: 0,
        tokenCount: 0,
        page: Object.freeze({ offset: 0, limit, total: 0, hasEarlier: false, hasLater: false }),
        persisted: false,
      });
    }
    const store = await storeFactory({
      definitionId: agent.definitionId,
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
    });
    const [messages, turnCount, tokenCount, tokenConsumption] = await Promise.all([
      store.getMessages(),
      store.getTurnCount(),
      store.getTokenCount(),
      store.getTokenConsumption?.(),
    ]);
    const total = messages.length;
    const offset = Math.max(0, Math.min(
      total,
      Math.floor(options.offset ?? Math.max(0, total - limit)),
    ));
    const visibleMessages = messages.slice(offset, offset + limit);
    return Object.freeze({
      conversation,
      messages: Object.freeze(visibleMessages.map(freezeGloveMessage)),
      turnCount,
      tokenCount,
      ...(tokenConsumption ? { tokenConsumption: Object.freeze({ ...tokenConsumption }) } : {}),
      page: Object.freeze({
        offset,
        limit,
        total,
        hasEarlier: offset > 0,
        hasLater: offset + visibleMessages.length < total,
      }),
      persisted: true,
    });
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
    // Time spent waiting for the conversation does not count against the
    // wait: the timeout is for the run itself, which has not started yet.
    while (this.gate.waiting(runId)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, options?.pollMs ?? 100));
    }
    const run = await this.signalRunner.waitForRun(runId, options);
    return run ? this.toFoundryRun<TOutput>(run) : null;
  }

  async cancel(runId: string): Promise<boolean> {
    // A cancelled run's open approvals are void: nothing resumes them.
    await this.cancelApprovalsOf(runId).catch((cause) => this.reportApprovalFailure(runId, cause));
    return this.signalRunner.cancel(runId);
  }

  private trackRunProcess(runId: string, state: "acquired" | "released"): void {
    this.runProcesses.set(runId, state);
    if (state !== "released") return;
    // Long enough for a steer that is already waiting; a retry reuses the run id.
    const forget = setTimeout(() => {
      if (this.runProcesses.get(runId) === "released") this.runProcesses.delete(runId);
    }, RUN_PROCESS_RETENTION_MS);
    forget.unref?.();
  }

  /**
   * Wait until a cancelled run's process has let go of its conversation. A run
   * that never started has no process. A process that dies before it reports
   * (SIGTERM during startup, or Station's SIGKILL five seconds after the
   * cancel) cannot report, so the wait is bounded by that kill.
   */
  private async waitForRunProcessRelease(run: FoundryRun, agent: string): Promise<void> {
    if (!run.startedAt) return;
    const started = Date.now();
    for (;;) {
      const state = this.runProcesses.get(run.id);
      const waited = Date.now() - started;
      if (state === "released") return;
      if (state === undefined && waited >= RUN_PROCESS_REPORT_GRACE_MS) return;
      if (waited >= RUN_PROCESS_RELEASE_TIMEOUT_MS) {
        this.runProcesses.delete(run.id);
        this.observability.append({
          type: "run.steer.release-timeout",
          category: "system",
          agent,
          runId: run.id,
          data: { waitedMs: waited },
        });
        return;
      }
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
    }
  }

  /**
   * Change course at a run boundary.
   *
   * Foundry does not inject text into an arbitrary in-flight tool. If the
   * source is active, steering cooperatively cancels it first, waits for that
   * terminal boundary, then starts a replacement turn in the same durable
   * conversation with explicit lineage in the request context.
   */
  async steer(
    runId: string,
    message: FoundryMessageInput,
  ): Promise<FoundrySteerResult<FoundryResult>> {
    const source = await this.getRun(runId);
    if (!source) throw new Error(`Foundry run "${runId}" was not found.`);
    if (!source.agentId || !source.conversationId) {
      throw new Error(`Foundry run "${runId}" does not expose an agent conversation to steer.`);
    }
    const active = source.status === "pending" || source.status === "running";
    // Nothing else on the conversation starts between the cancel and the
    // replacement, which goes ahead of anything already waiting.
    const release = this.gate.hold(source.conversationId);
    let run: FoundryRun<FoundryResult>;
    let interrupted = false;
    try {
      if (active) this.steeredRuns.add(runId);
      interrupted = active ? await this.cancel(runId) : false;
      if (!interrupted) this.steeredRuns.delete(runId);
      if (interrupted) {
        const terminal = await this.waitForRun(runId, {
          pollMs: 25,
          timeoutMs: Math.min(Math.max(source.timeoutMs, 1_000), 30_000),
        });
        if (!terminal || (terminal.status === "pending" || terminal.status === "running")) {
          throw new Error(`Foundry could not reach a safe steering boundary for run "${runId}".`);
        }
        // Station marks the run cancelled before its process exits, so the
        // replacement must also wait for that process to let go of the conversation.
        await this.waitForRunProcessRelease(terminal, source.agent);
      }
      const agent = await Effect.runPromise(this.data.getAgent(source.agentId));
      if (!agent) throw new Error(`Foundry agent instance "${source.agentId}" was not found.`);
      run = await Effect.runPromise(this.requestEffect(agent.definitionId, {
        agentId: source.agentId,
        conversationId: source.conversationId,
        workspaceId: agent.workspaceId,
        message,
        context: {
          protocol: "foundry-control",
          steeredFromRunId: runId,
          steeringMode: "interrupt-and-restart",
        },
        source: { kind: "direct" },
      }, { front: true })) as FoundryRun<FoundryResult>;
    } finally {
      release();
    }
    this.observability.append({
      type: "run.steered",
      category: "system",
      agent: source.agent,
      runId: run.id,
      data: {
        fromRunId: runId,
        toRunId: run.id,
        agentId: source.agentId,
        conversationId: source.conversationId,
        interrupted,
        mode: "interrupt-and-restart",
      },
    });
    return { fromRunId: runId, interrupted, run };
  }

  async listApprovals(filter: {
    readonly runId?: string;
    readonly status?: FoundryApprovalStatus;
  } = {}): Promise<ReadonlyArray<FoundryApproval>> {
    if (!this.approvalPolicy.durable) return listFoundryApprovals(this.approvalDirectory, filter);
    return (await this.withApprovals(() => this.currentApprovals()))
      .filter((item) => (!filter.runId || item.runId === filter.runId) && (!filter.status || item.status === filter.status))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  /** One approval: what a link to it opens. Null when there is no such approval. */
  async getApproval(approvalId: string): Promise<FoundryApproval | null> {
    if (!this.approvalPolicy.durable) {
      return (await listFoundryApprovals(this.approvalDirectory)).find((item) => item.id === approvalId) ?? null;
    }
    return (await this.withApprovals(() => this.currentApprovals())).find((item) => item.id === approvalId) ?? null;
  }

  /**
   * Decide an approval. When the run that asked is still waiting, it reads the
   * decision and carries on. When it is not (it suspended, timed out, or the
   * runtime restarted since), the decision goes to the conversation as a
   * durable event, and the run that takes it resumes the turn at the tool
   * call that asked: approved, the call runs; denied, it is refused.
   */
  async resolveApproval(
    approvalId: string,
    decision: FoundryApprovalDecision,
  ): Promise<FoundryApproval> {
    if (!this.approvalPolicy.durable) {
      const approval = await resolveFoundryApproval(this.approvalDirectory, approvalId, decision);
      this.reportResolved(approval, decision);
      return approval;
    }
    const { decided, live } = await this.withApprovals(async () => {
      const current = (await this.currentApprovals()).find((item) => item.id === approvalId);
      if (!current) throw new Error(`Foundry approval "${approvalId}" was not found.`);
      if (current.status !== "pending") throw new Error(`Foundry approval "${approvalId}" is already ${current.status}.`);
      let waiting = false;
      if (!current.suspendedAt && await foundryApprovalRequested(this.approvalDirectory, approvalId)) {
        // Decision first, then the run's mark: see markFoundryApprovalSuspended.
        await resolveFoundryApproval(this.approvalDirectory, approvalId, decision).catch(() => undefined);
        waiting = !this.settledRuns.has(current.runId) && !(await foundryApprovalSuspended(this.approvalDirectory, approvalId));
      }
      const decided: FoundryApproval = {
        ...current,
        status: decision === "approve" ? "approved" : "denied",
        resolvedAt: new Date().toISOString(),
        ...(waiting ? {} : { suspendedAt: current.suspendedAt ?? new Date().toISOString() }),
      };
      await Effect.runPromise(this.data.putApproval!(decided));
      return { decided, live: waiting };
    });
    this.reportResolved(decided, decision);
    // A drafted mesh message: the decision delivers or drops it, and nobody is told.
    if (decided.mesh) {
      await this.settleMeshDraft(decided).catch((cause) => this.reportApprovalFailure(decided.runId, cause));
      return decided;
    }
    if (live) return decided;
    // The decision is recorded either way; a hand-back that fails is retried at the next start.
    return this.resumeApproval(decided).catch((cause) => {
      this.reportApprovalFailure(decided.runId, cause);
      return decided;
    });
  }

  private reportResolved(approval: FoundryApproval, decision: FoundryApprovalDecision): void {
    this.observability.append({
      type: "approval.resolved",
      category: "system",
      agent: approval.definitionId,
      runId: approval.runId,
      data: {
        approvalId: approval.id,
        toolName: approval.toolName,
        decision,
        status: approval.status,
      },
    });
  }

  private withApprovals<T>(work: () => Promise<T>): Promise<T> {
    const next = this.approvalWrites.then(work, work);
    this.approvalWrites = next.catch(() => undefined);
    return next;
  }

  private reportApprovalFailure(runId: string, cause: unknown): void {
    this.observability.append({
      type: "approval.failed",
      category: "system",
      runId,
      data: { error: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  /** Stored approvals, expired where their time ran out, plus requests not recorded yet. Call inside withApprovals. */
  private async currentApprovals(): Promise<FoundryApproval[]> {
    const now = Date.now();
    const byId = new Map<string, FoundryApproval>();
    for (const approval of await Effect.runPromise(this.data.listApprovals!())) {
      if (approval.status === "pending" && Date.parse(approval.expiresAt) <= now) {
        const expired: FoundryApproval = { ...approval, status: "expired", resolvedAt: new Date(now).toISOString() };
        await Effect.runPromise(this.data.putApproval!(expired));
        byId.set(expired.id, expired);
      } else {
        byId.set(approval.id, approval);
      }
    }
    // A run's request reaches the store a moment after the run made it.
    for (const live of await listFoundryApprovals(this.approvalDirectory)) {
      if (!byId.has(live.id)) byId.set(live.id, this.withApprovalUrl(live));
    }
    return [...byId.values()];
  }

  private withApprovalUrl(approval: FoundryApproval): FoundryApproval {
    let url: string | undefined;
    try {
      url = this.application.approvals?.url?.(approval) || undefined;
    } catch {
      url = undefined;
    }
    return url ? { ...approval, url } : approval;
  }

  /** What a run reported about one of its approvals, kept in the data adapter. */
  private async recordApprovalEvent(type: string, data: unknown): Promise<void> {
    if (!this.approvalPolicy.durable || !data || typeof data !== "object") return;
    await this.withApprovals(async () => {
      if (type === "foundry.approval.requested") {
        const requested = data as FoundryApproval;
        if (typeof requested.id !== "string" || await Effect.runPromise(this.data.getApproval!(requested.id))) return;
        await Effect.runPromise(this.data.putApproval!(this.withApprovalUrl({ ...requested, status: "pending" })));
        return;
      }
      const { approvalId, status } = data as { approvalId?: unknown; status?: unknown };
      if (typeof approvalId !== "string") return;
      const stored = await Effect.runPromise(this.data.getApproval!(approvalId));
      if (!stored) return;
      if (type === "foundry.approval.suspended") {
        if (!stored.suspendedAt) await Effect.runPromise(this.data.putApproval!({ ...stored, suspendedAt: new Date().toISOString() }));
        return;
      }
      // The run read a decision itself: nothing is owed to it.
      const settled = typeof status === "string" && ["approved", "denied", "expired", "cancelled"].includes(status)
        ? status as Exclude<FoundryApprovalStatus, "pending">
        : undefined;
      await Effect.runPromise(this.data.putApproval!({
        ...stored,
        settledInRun: true,
        ...(stored.status === "pending" && settled ? { status: settled, resolvedAt: new Date().toISOString() } : {}),
      }));
    });
  }

  /**
   * A run ended. Its approvals still open no longer have anyone waiting:
   * they stay open, and a decision resumes the conversation. A decision the
   * run never read (it ended first) is handed over now.
   */
  private async settleApprovalsOf(runId: string): Promise<void> {
    if (!this.approvalPolicy.durable) return;
    const owed = await this.withApprovals(async () => {
      const owed: FoundryApproval[] = [];
      for (const approval of await Effect.runPromise(this.data.listApprovals!())) {
        if (approval.runId !== runId) continue;
        if (approval.status === "pending" && !approval.suspendedAt) {
          await markFoundryApprovalSuspended(this.approvalDirectory, approval.id).catch(() => false);
          await Effect.runPromise(this.data.putApproval!({ ...approval, suspendedAt: new Date().toISOString() }));
        } else if ((approval.status === "approved" || approval.status === "denied") && !approval.settledInRun && !approval.resumedAt) {
          owed.push(approval);
        }
      }
      return owed;
    });
    for (const approval of owed) await this.resumeApproval(approval);
  }

  private async cancelApprovalsOf(runId: string): Promise<void> {
    if (!this.approvalPolicy.durable) return;
    await this.withApprovals(async () => {
      for (const approval of await Effect.runPromise(this.data.listApprovals!())) {
        if (approval.runId !== runId || approval.status !== "pending") continue;
        if (await foundryApprovalRequested(this.approvalDirectory, approval.id) && !(await readFoundryApprovalResolution(this.approvalDirectory, approval.id))) {
          await resolveFoundryApproval(this.approvalDirectory, approval.id, "deny").catch(() => undefined);
        }
        await Effect.runPromise(this.data.putApproval!({ ...approval, status: "cancelled", resolvedAt: new Date().toISOString(), settledInRun: true }));
      }
    });
  }

  /** After a restart: open approvals have no run waiting, and decided ones may still be owed. */
  private async reconcileApprovals(): Promise<void> {
    if (!this.approvalPolicy.durable) return;
    const owed = await this.withApprovals(async () => {
      const owed: FoundryApproval[] = [];
      for (const approval of await this.currentApprovals()) {
        if (approval.status === "pending" && !approval.suspendedAt) {
          await Effect.runPromise(this.data.putApproval!({ ...approval, suspendedAt: new Date().toISOString() }));
        } else if ((approval.status === "approved" || approval.status === "denied") && !approval.settledInRun && !approval.resumedAt) {
          owed.push(approval);
        }
      }
      return owed;
    });
    for (const approval of owed) await this.resumeApproval(approval).catch((cause) => this.reportApprovalFailure(approval.runId, cause));
  }

  /**
   * Hand a decision to the conversation that asked, as a durable event. The
   * run that takes it resumes the turn at the waiting tool call. If the
   * conversation moved on, the event tells the agent what was decided.
   */
  private async resumeApproval(approval: FoundryApproval): Promise<FoundryApproval> {
    const approved = approval.status === "approved";
    const content = approved
      ? `The person approved your earlier request to run ${approval.toolName} (approval ${approval.id}). It has not run yet. To do it now, call ${approval.toolName} again with the same input.`
      : `The person denied your earlier request to run ${approval.toolName} (approval ${approval.id}). Do not run it.`;
    const receipt = await this.emitEvent(
      { agentId: approval.agentId, conversationId: approval.conversationId },
      {
        id: `approval:${approval.id}`,
        source: "foundry:approval",
        kind: "approval.decided",
        content,
        metadata: {
          approval: {
            id: approval.id,
            toolName: approval.toolName,
            toolInput: approval.toolInput,
            status: approval.status,
            ...(approval.toolCallId ? { toolCallId: approval.toolCallId } : {}),
          },
        },
      },
      { whenIdle: "wake" },
    );
    const resumed: FoundryApproval = {
      ...approval,
      resumedAt: new Date().toISOString(),
      ...(receipt.runId ? { resumeRunId: receipt.runId } : {}),
    };
    await this.withApprovals(() => Effect.runPromise(this.data.putApproval!(resumed)));
    this.observability.append({
      type: "approval.resumed",
      category: "system",
      agent: approval.definitionId,
      runId: receipt.runId ?? approval.runId,
      data: { approvalId: approval.id, toolName: approval.toolName, status: approval.status },
    });
    return resumed;
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
    await this.assertDurableActive(agent);
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
    readonly conversationKey?: string;
    readonly conversationScope?: "route" | "agent";
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
    const deliveries: Array<{ agentId: string; playbookIds: string[]; runId?: string }> = [];
    const matchedByAgent = new Map<string, { agent: AgentInstance; playbooks: AgentPlaybook[] }>();
    for (const stored of instances) {
      let agent: AgentInstance;
      try { agent = await this.effectiveAgent(stored); } catch { if (stored.durableSubagent) continue; throw new Error(`Cannot resolve agent "${stored.id}".`); }
      const installedApplications = new Set(
        agent.installations
          .filter((installation) => installation.kind === "application")
          .map((installation) => installation.id),
      );
      const hasInstalledOwner = (
        this.compositionByDefinition.get(agent.definitionId)?.capabilities.applications ?? []
      ).some((application) =>
        installedApplications.has(application.id) &&
        (!application.restrictions || application.restrictions.transmissions?.includes(integration.id)) &&
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
      const conversationScope = input.conversationScope ?? "route";
      const conversationKey = input.conversationKey?.trim() || input.threadKey;
      const conversationId = conversationScope === "agent"
        ? `transmission:agent:${agent.id}:${encodeURIComponent(conversationKey)}`
        : `transmission:${route.id}:${agent.id}:${encodeURIComponent(conversationKey)}`;
      const keyedConversations = conversationScope === "agent"
        ? (await Effect.runPromise(this.data.listConversations(agent.id))).filter(
            (candidate) => candidate.context.conversationKey === conversationKey,
          )
        : [];
      if (keyedConversations.length > 1) {
        throw new Error(
          `Agent "${agent.id}" has multiple conversations for key "${conversationKey}".`,
        );
      }
      let conversation = keyedConversations[0]
        ?? await Effect.runPromise(this.data.getConversation(conversationId));
      if (!conversation) {
        conversation = await this.createConversation(agent.id, {
          id: conversationId,
          context: {
            routeId: route.id,
            threadKey: input.threadKey,
            conversationKey,
            conversationScope,
          },
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
      const run = await this.admitInbound({
        id: `${claim}:${agent.id}`,
        definitionId: agent.definitionId,
        createdAt: new Date().toISOString(),
        request: {
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
        },
      });
      if (run && !runs.some((item) => item.id === run.id)) runs.push(run);
      deliveries.push({
        agentId: agent.id,
        playbookIds: matched.map((playbook) => playbook.id),
        ...(run ? { runId: run.id } : {}),
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
    readonly signal?: AbortSignal;
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
    const storedAgent = await Effect.runPromise(this.data.getAgent(input.agentId));
    const agent = storedAgent ? await this.effectiveAgent(storedAgent) : null;
    if (!agent) {
      throw new Error(`Agent instance "${input.agentId}" does not exist.`);
    }
    if (input.applicationId) {
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
    const owners = this.compositionByDefinition.get(agent.definitionId)?.capabilities.applications.filter((app) =>
      (!input.applicationId || app.id === input.applicationId) && agent.installations.some((item) => item.kind === "application" && item.id === app.id)
      && app.transmissions?.some((transmission) => transmission.id === route.transmissionId)) ?? [];
    if (owners.length && !owners.some((app) => !app.restrictions || app.restrictions.transmissions?.includes(route.transmissionId))) throw new Error("Application restrictions deny this outbound transmission.");
    if (agent.durableSubagent && !owners.length) throw new Error("Durable workers require an installed application for outbound transmissions.");
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
    const accountSessions = this.byRoute.get(agent.definitionId)?.definition.accountSessions;
    const sourceRun = account && accountSessions ? await this.getRun(input.runId) : null;
    const output = await Effect.runPromise(transmission.outbound.adapter.deliver(payload, {
      route,
      ...(account ? { account } : {}),
      grant,
      signal: input.signal ?? new AbortController().signal,
      ...(account && accountSessions
        ? {
            withAccountSession: <A>(
              operation: string,
              use: (session: unknown) => Effect.Effect<A, unknown, never>,
            ) => owners.length && !owners.some((app) => !app.restrictions || (app.restrictions.transmissions?.includes(route.transmissionId) && app.restrictions.operations?.includes(operation)))
              ? Effect.fail(new Error(`Application restrictions deny account operation "${operation}".`))
              : accountSessions.withSession({
              accountId: account.id,
              operation,
              agentId: agent.id,
              conversationId: sourceRun?.conversationId ?? `egress:${input.runId}`,
              workspaceId: agent.workspaceId,
            }, use),
          }
        : {}),
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
      this.signalRunner.ping(),
      this.signalRunner.ping(),
    ]);
    return {
      ok: execution && environment && activations,
      execution,
      environment,
      activations,
      agents: this.agents.length,
      capabilities:
        this.registry.capabilities.tools.length +
        this.registry.capabilities.applications.length +
        this.registry.capabilities.mcp.length +
        this.registry.capabilities.memory.length,
      surfaces:
        this.registry.native.layers.length +
        this.registry.native.subscribers.length,
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
    for (const stored of await this.listAgentInstances()) {
      let agent: AgentInstance;
      try { agent = await this.effectiveAgent(stored); } catch { if (stored.durableSubagent) continue; throw new Error(`Cannot resolve agent "${stored.id}".`); }
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
        if (application.restrictions && !application.restrictions.transmissions?.includes(requirement.playbook.transmissionId)) continue;
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
            // The account directory is the source of accounts, so accounts an
            // application adds at runtime get their connections too.
            const account = route.accountId
              ? await this.services.runPromise(Effect.gen(function* () {
                  return yield* (yield* AccountDirectory).get(route.accountId!);
                })).catch(() => undefined)
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
      if (!inboundOwners.some((application) => installedApplications.has(application.id) && (!application.restrictions || application.restrictions.transmissions?.includes(playbook.transmissionId)))) {
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

  // ── Delegation ──────────────────────────────────────────────────────────
  //
  // A delegation is a worker conversation whose context carries the record.
  // Results and questions go back to the delegating conversation, replies go
  // to the worker. Each delivery reaches a run that is listening on the
  // conversation, or waits until the conversation is free and starts one run
  // carrying everything that arrived meanwhile.

  /** Every delegation, newest first, optionally narrowed to one delegating conversation. */
  async listDelegations(filter: {
    readonly agentId?: string;
    readonly conversationId?: string;
    readonly status?: FoundryDelegationStatus;
  } = {}): Promise<ReadonlyArray<FoundryDelegation>> {
    const found: FoundryDelegation[] = [];
    for (const agent of await Effect.runPromise(this.data.listAgents())) {
      for (const conversation of await Effect.runPromise(this.data.listConversations(agent.id))) {
        const delegation = delegationFromContext(conversation.context);
        if (!delegation || delegation.workerAgentId !== agent.id) continue;
        if (filter.agentId && delegation.from.agentId !== filter.agentId) continue;
        if (filter.conversationId && delegation.from.conversationId !== filter.conversationId) continue;
        if (filter.status && delegation.status !== filter.status) continue;
        found.push(delegation);
      }
    }
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async openDelegationsFrom(
    agentId: string,
    conversationId: string,
  ): Promise<ReadonlyArray<FoundryDelegation>> {
    return (await this.listDelegations({ agentId, conversationId })).filter(isOpenDelegation)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /** Run work for one conversation after the work already queued for it. */
  private inConversation<T>(conversationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.conversationQueues.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    const tail = next.catch(() => undefined);
    this.conversationQueues.set(conversationId, tail);
    void tail.then(() => {
      if (this.conversationQueues.get(conversationId) === tail) this.conversationQueues.delete(conversationId);
    });
    return next;
  }

  private occupyConversation(conversationId: string, runId: string): void {
    this.runConversations.set(runId, conversationId);
    const runs = this.conversationRuns.get(conversationId) ?? new Set<string>();
    runs.add(runId);
    this.conversationRuns.set(conversationId, runs);
  }

  private trackConversationRun(run: Run, state: "acquired" | "released"): void {
    if (state === "released") {
      this.releaseConversationRun(run.id);
      return;
    }
    const conversationId = this.toFoundryRun(run).conversationId;
    if (conversationId) this.occupyConversation(conversationId, run.id);
  }

  private releaseConversationRun(runId: string): void {
    const conversationId = this.runConversations.get(runId);
    if (!conversationId) return;
    this.runConversations.delete(runId);
    const runs = this.conversationRuns.get(conversationId);
    runs?.delete(runId);
    if (runs && runs.size === 0) this.conversationRuns.delete(conversationId);
    void this.inConversation(conversationId, async () => {
      if (this.conversationListeners.get(conversationId) === runId) {
        this.conversationListeners.delete(conversationId);
        await this.reclaimMailbox(conversationId);
      }
      await this.flushHeldDeliveries(conversationId);
    }).catch((cause) => this.reportDeliveryFailure(conversationId, cause));
  }

  private trackConversationListener(run: Run, state: "on" | "off"): void {
    const conversationId = this.toFoundryRun(run).conversationId;
    if (!conversationId) return;
    void this.inConversation(conversationId, async () => {
      if (state === "on") {
        this.conversationListeners.set(conversationId, run.id);
        // Anything held while the conversation was busy goes to the listener.
        const held = this.heldDeliveries.get(conversationId);
        if (held) {
          this.heldDeliveries.delete(conversationId);
          for (const delivery of held.deliveries) {
            await writeMailboxDelivery(this.mailboxDirectory, conversationId, delivery);
          }
          await this.markHandedOver(held.deliveries, run.id);
        }
        return;
      }
      if (this.conversationListeners.get(conversationId) !== run.id) return;
      this.conversationListeners.delete(conversationId);
      await this.reclaimMailbox(conversationId);
      await this.flushHeldDeliveries(conversationId);
    }).catch((cause) => this.reportDeliveryFailure(conversationId, cause));
  }

  /** Take back deliveries a listener did not read, to deliver as a run. */
  private async reclaimMailbox(conversationId: string): Promise<void> {
    // A mesh read receipt only matters to a run that was waiting for it.
    const deliveries = (await drainMailbox(this.mailboxDirectory, conversationId))
      .filter((delivery) => !(delivery.kind === "mesh" && delivery.message.kind === "ack"));
    if (deliveries.length === 0) return;
    const target = await this.deliveryTargetFor(conversationId);
    if (!target) return;
    // An event the run never read waits for the conversation's next run.
    for (const delivery of deliveries) {
      if (delivery.kind === "transmission" || delivery.kind === "agent-message") await this.assignPendingInbound(delivery.pendingId, undefined);
    }
    await this.markHandedOver(deliveries, undefined);
    this.holdDeliveries(target, deliveries);
  }

  private async deliveryTargetFor(conversationId: string): Promise<DeliveryTarget | null> {
    const conversation = await Effect.runPromise(this.data.getConversation(conversationId));
    if (!conversation) return null;
    const agent = await Effect.runPromise(this.data.getAgent(conversation.agentId));
    if (!agent) return null;
    return {
      definitionId: agent.definitionId,
      agentId: agent.id,
      conversationId,
      workspaceId: conversation.workspaceId,
    };
  }

  private holdDeliveries(target: DeliveryTarget, deliveries: ReadonlyArray<FoundryConversationDelivery>): void {
    const held = this.heldDeliveries.get(target.conversationId);
    if (held) held.deliveries.push(...deliveries.filter((delivery) => !delivery.durable || !held.deliveries.some((item) => item.durable?.id === delivery.durable!.id)));
    else this.heldDeliveries.set(target.conversationId, { target, deliveries: [...deliveries] });
  }

  private deliver(target: DeliveryTarget, deliveries: ReadonlyArray<FoundryConversationDelivery>, replay = false): Promise<void> {
    return this.inConversation(target.conversationId, async () => {
      if (!this.data.claimEvent || !this.data.putEvent || !this.data.listEvents) throw new Error("Durable event delivery requires claimEvent, putEvent, and listEvents on the data adapter.");
      const accepted: FoundryConversationDelivery[] = [];
      for (const delivery of deliveries) {
        // Compare and retain the same JSON representation on every adapter,
        // including optional undefined fields that a file-backed journal drops.
        const event: AgentEvent = JSON.parse(JSON.stringify(delivery.durable?.event ?? deliveryEvent(delivery)));
        const id = eventRecordId(target, event.id);
        const policy: FoundryEventPolicy = JSON.parse(JSON.stringify(delivery.durable?.policy ?? this.byRoute.get(target.definitionId)?.definition.eventDelivery ?? {}));
        const { durable: _transport, ...body } = delivery;
        const record: FoundryEventRecord = { id, target: { agentId: target.agentId, conversationId: target.conversationId },
          definitionId: target.definitionId, workspaceId: target.workspaceId, event, policy, delivery: body,
          status: "pending", createdAt: new Date().toISOString() };
        const fresh = await Effect.runPromise(this.data.claimEvent(record));
        const existing = fresh ? record : (await Effect.runPromise(this.data.listEvents())).find((item) => item.id === id)!;
        if (!fresh && !replay && delivery.durable && (!isDeepStrictEqual(existing.event, event) || !isDeepStrictEqual(existing.policy, policy))) {
          throw new Error(`Event id "${event.id}" already belongs to a different event or delivery policy at this target.`);
        }
        // Copy legacy delegation outbox state only after the journal owns the event.
        await this.markLegacyHandedOver([body], undefined);
        if (existing.status !== "pending") {
          if ((body.kind === "agent-message" || body.kind === "transmission") && this.data.deletePendingInbound) await Effect.runPromise(this.data.deletePendingInbound(body.pendingId));
          continue;
        }
        if (!fresh && !replay) continue;
        if (existing.event.expiresAt && Date.parse(existing.event.expiresAt) <= Date.now()) {
          await Effect.runPromise(this.data.putEvent({ ...existing, status: "expired", runId: undefined }));
          continue;
        }
        accepted.push({ ...existing.delivery, durable: { id, event: existing.event, policy: existing.policy } });
      }
      deliveries = accepted;
      if (!deliveries.length) return;
      const recipient = await Effect.runPromise(this.data.getAgent(target.agentId));
      if (recipient?.durableSubagent) { try { await this.assertDurableActive(recipient); } catch { return; } }
      if (this.conversationListeners.has(target.conversationId)) {
        for (const delivery of deliveries) {
          await writeMailboxDelivery(this.mailboxDirectory, target.conversationId, delivery);
        }
        await this.markHandedOver(deliveries, this.conversationListeners.get(target.conversationId));
        this.observability.append({
          type: "delegation.delivered",
          category: "system",
          agent: target.definitionId,
          runId: this.conversationListeners.get(target.conversationId),
          data: { conversationId: target.conversationId, mode: "live", count: deliveries.length },
        });
        return;
      }
      this.holdDeliveries(target, deliveries);
      await this.flushHeldDeliveries(target.conversationId);
    });
  }

  /** Start one run with everything held for a conversation, once nothing else holds it. */
  private async flushHeldDeliveries(conversationId: string): Promise<void> {
    if (!this.started || this.stopping) return;
    if (this.gate.busy(conversationId)) return;
    if (this.conversationListeners.has(conversationId)) return;
    const held = this.heldDeliveries.get(conversationId);
    if (!held || held.deliveries.length === 0) return;
    const records = this.data.listEvents ? await Effect.runPromise(this.data.listEvents()) : [];
    const pending = records.filter((record) => held.deliveries.some((delivery) => delivery.durable?.id === record.id) && record.status === "pending");
    const now = Date.now();
    for (const record of pending) {
      if (record.event.expiresAt && Date.parse(record.event.expiresAt) <= now) await Effect.runPromise(this.data.putEvent!({ ...record, status: "expired", runId: undefined }));
    }
    const live = pending.filter((record) => !record.event.expiresAt || Date.parse(record.event.expiresAt) > now);
    held.deliveries = held.deliveries.filter((delivery) => live.some((record) => record.id === delivery.durable?.id));
    if (!held.deliveries.length) { this.heldDeliveries.delete(conversationId); return; }
    if (!live.some((record) => eventDue(record, now))) {
      const deadlines = live.flatMap((record) => [
        ...(record.policy.deferTimeoutMs !== undefined ? [Date.parse(record.createdAt) + record.policy.deferTimeoutMs] : []),
        ...(record.event.expiresAt ? [Date.parse(record.event.expiresAt)] : []),
      ]);
      const previous = this.eventTimers.get(conversationId);
      if (previous) clearTimeout(previous);
      if (deadlines.length) {
        const timer = setTimeout(() => {
          this.eventTimers.delete(conversationId);
          void this.inConversation(conversationId, () => this.flushHeldDeliveries(conversationId)).catch((cause) => this.reportDeliveryFailure(conversationId, cause));
        }, Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - now)));
        timer.unref(); this.eventTimers.set(conversationId, timer);
      }
      return;
    }
    this.heldDeliveries.delete(conversationId);
    const { target, deliveries } = held;
    const owner = await Effect.runPromise(this.data.getAgent(target.agentId));
    if (owner?.durableSubagent) { try { await this.assertDurableActive(owner); } catch { return; } }
    const runId = await this.enqueueCoreRequest(target.definitionId, {
      agentId: target.agentId,
      conversationId,
      workspaceId: target.workspaceId,
      ...(deliveries.length === 1 ? deliveries[0]!.request : {}),
      message: renderDeliveries(deliveries),
      source: deliveries.length === 1 && deliveries[0]!.request?.source ? deliveries[0]!.request.source : deliverySource(deliveries),
    }, { eventTurn: true });
    this.occupyConversation(conversationId, runId);
    await this.markHandedOver(deliveries, runId);
    this.observability.append({
      type: "delegation.delivered",
      category: "system",
      agent: target.definitionId,
      runId,
      data: { conversationId, mode: "run", count: deliveries.length },
    });
  }

  private async markHandedOver(deliveries: ReadonlyArray<FoundryConversationDelivery>, runId: string | undefined): Promise<void> {
    if (!this.data.listEvents || !this.data.putEvent) return;
    const ids = new Set(deliveries.flatMap((delivery) => delivery.durable ? [delivery.durable.id] : []));
    for (const record of await Effect.runPromise(this.data.listEvents())) {
      if (!ids.has(record.id) || record.status !== "pending") continue;
      const acknowledged = runId && this.completedEventRuns.get(runId)?.has(record.id);
      await Effect.runPromise(this.data.putEvent({ ...record, runId, ...(acknowledged ? { status: "acknowledged" as const } : {}) }));
    }
  }

  /**
   * Deliver events again after a delay that doubles each time (1s up to 5
   * minutes), when a run withheld them because preparing them failed. They
   * stay pending meanwhile; a restart delivers them as usual.
   */
  private scheduleEventRetries(ids: ReadonlyArray<string>): void {
    if (this.stopping) return;
    for (const id of ids) {
      const retry = this.eventRetries.get(id) ?? { attempts: 0 };
      if (retry.timer) continue;
      retry.attempts++;
      const delay = Math.min(1_000 * 2 ** (retry.attempts - 1), 300_000);
      retry.timer = setTimeout(() => {
        retry.timer = undefined;
        void this.retryEvent(id).catch((cause) => this.reportDeliveryFailure("event-retry", cause));
      }, delay);
      retry.timer.unref?.();
      this.eventRetries.set(id, retry);
    }
  }

  private async retryEvent(id: string): Promise<void> {
    if (this.stopping || !this.data.listEvents) return;
    const record = (await Effect.runPromise(this.data.listEvents())).find((item) => item.id === id);
    if (!record || record.status !== "pending") { this.eventRetries.delete(id); return; }
    const owner = await Effect.runPromise(this.data.getAgent(record.target.agentId));
    if (!owner) { this.eventRetries.delete(id); return; }
    try { await this.assertDurableActive(owner); } catch { return; }
    await this.deliver({ ...record.target, definitionId: record.definitionId, workspaceId: record.workspaceId },
      [{ ...record.delivery, durable: { id: record.id, event: record.event, policy: record.policy } }], true);
  }

  private async finishEvents(runId: string, consumed: ReadonlyArray<string>): Promise<void> {
    if (!this.data.listEvents || !this.data.putEvent || this.stopping) return;
    const run = await this.getRun(runId);
    const ids = new Set(consumed);
    this.completedEventRuns.set(runId, ids);
    if (this.completedEventRuns.size > 1000) this.completedEventRuns.delete(this.completedEventRuns.keys().next().value!);
    for (const record of await Effect.runPromise(this.data.listEvents())) {
      if (record.status !== "pending" || !ids.has(record.id) || record.target.agentId !== run?.agentId || record.target.conversationId !== run?.conversationId) continue;
      const owner = await Effect.runPromise(this.data.getAgent(record.target.agentId));
      if (!owner) continue;
      try { await this.assertDurableActive(owner); } catch { continue; }
      await Effect.runPromise(this.data.putEvent({ ...record, status: record.event.expiresAt && Date.parse(record.event.expiresAt) <= Date.now() ? "expired" : "acknowledged", runId }));
      const retry = this.eventRetries.get(record.id);
      if (retry?.timer) clearTimeout(retry.timer);
      this.eventRetries.delete(record.id);
      if ((record.delivery.kind === "transmission" || record.delivery.kind === "agent-message") && this.data.deletePendingInbound) {
        await Effect.runPromise(this.data.deletePendingInbound(record.delivery.pendingId));
      }
    }
  }

  private async redeliverEvents(agentId?: string): Promise<void> {
    if (!this.data.listEvents) return;
    for (const record of await Effect.runPromise(this.data.listEvents())) {
      if (record.status !== "pending" || (agentId && record.target.agentId !== agentId)) continue;
      if (record.runId) {
        const run = await this.getRun(record.runId);
        if (run && !["completed", "failed", "cancelled"].includes(run.status)) continue;
        if (run?.status === "completed" && (run.output as FoundryResult | undefined)?.consumedEventIds?.includes(record.id)) {
          await this.finishEvents(run.id, [record.id]); continue;
        }
      }
      const owner = await Effect.runPromise(this.data.getAgent(record.target.agentId));
      if (!owner) continue;
      try { await this.assertDurableActive(owner); } catch { continue; }
      await this.deliver({ ...record.target, definitionId: record.definitionId, workspaceId: record.workspaceId }, [{ ...record.delivery, durable: { id: record.id, event: record.event, policy: record.policy } }], true);
    }
  }

  /** Clear the bookkeeping that lets a restart hand these deliveries over again. */
  private async markLegacyHandedOver(
    deliveries: ReadonlyArray<FoundryConversationDelivery>,
    runId: string | undefined,
  ): Promise<void> {
    for (const delivery of deliveries) {
      // Mesh messages keep no record of their own; the event journal holds them.
      if (delivery.kind === "mesh") continue;
      if (delivery.kind === "transmission" || delivery.kind === "agent-message") {
        // Kept until the run that took it settles, not merely until handover.
        await this.assignPendingInbound(delivery.pendingId, runId);
      } else if (delivery.kind === "reply") {
        await this.updateDelegation(delivery.delegationId, (current) => {
          const pending = [...(current.pendingReplies ?? [])];
          const pendingIds = [...(current.pendingReplyIds ?? [])];
          const index = delivery.deliveryId ? pendingIds.indexOf(delivery.deliveryId) : pending.indexOf(delivery.message);
          if (index >= 0) { pending.splice(index, 1); pendingIds.splice(index, 1); }
          return { pendingReplies: pending.length > 0 ? pending : undefined, pendingReplyIds: pendingIds.length ? pendingIds : undefined };
        });
      } else {
        await this.updateDelegation(delivery.delegationId, (current) =>
          current.undelivered === delivery.kind && (!delivery.deliveryId || current.updateId === delivery.deliveryId) ? { undelivered: undefined } : {});
      }
    }
  }

  /** Record which run is handling a pending inbound event (none while it waits). */
  private async assignPendingInbound(pendingId: string, runId: string | undefined): Promise<void> {
    for (const ids of this.pendingInboundByRun.values()) ids.delete(pendingId);
    if (runId) {
      const ids = this.pendingInboundByRun.get(runId) ?? new Set<string>();
      ids.add(pendingId);
      this.pendingInboundByRun.set(runId, ids);
    }
    if (this.data.putPendingInbound && this.data.listPendingInbound) {
      const record = (await Effect.runPromise(this.data.listPendingInbound()))
        .find((item) => item.id === pendingId);
      if (record) {
        const { runId: _previous, ...rest } = record;
        await Effect.runPromise(this.data.putPendingInbound(runId ? { ...rest, runId } : rest));
      }
    }
    // The run finished before it was recorded as handling this event.
    if (runId && this.settledRuns.has(runId)) await this.finishPendingInbound(runId);
  }

  /** The run settled: the inbound events it was handling are done with. */
  private async finishPendingInbound(runId: string): Promise<void> {
    const ids = this.pendingInboundByRun.get(runId);
    if (!ids) return;
    this.pendingInboundByRun.delete(runId);
    // A run stopped by shutdown did not finish its events: the next start delivers them.
    if (this.stopping || !this.data.deletePendingInbound) return;
    const pending = this.data.listPendingInbound ? await Effect.runPromise(this.data.listPendingInbound()) : [];
    for (const record of pending.filter((item) => ids.has(item.id))) {
      const agent = await Effect.runPromise(this.data.getAgent(record.request.agentId));
      if (agent?.durableSubagent) { try { await this.assertDurableActive(agent); } catch { return; } }
    }
    for (const id of ids) await Effect.runPromise(this.data.deletePendingInbound(id));
  }

  /**
   * Hand an inbound event to one agent's conversation. A free conversation
   * starts a run for it. A busy one gets it as a delivery: it joins the
   * running turn at its next tool step, or waits and starts the
   * conversation's next run with anything else that arrived meanwhile.
   * Returns the run handling it now, when there is one.
   */
  private async admitInbound(record: FoundryPendingInbound): Promise<FoundryRun | null> {
    if (this.data.putPendingInbound) await Effect.runPromise(this.data.putPendingInbound(record));
    const { request } = record;
    const source = request.source;
    let delivery: FoundryConversationDelivery = {
      kind: source?.kind === "agent-message" ? "agent-message" : "transmission",
      request, pendingId: record.id, routeId: source?.id ?? "", eventId: source?.eventId ?? "",
      message: typeof request.message === "string" ? request.message : JSON.stringify(request.message),
    };
    if (source?.kind === "delegation") {
      const event: AgentEvent = { id: record.id, source: "foundry:delegation", kind: "delegation.task", content: typeof request.message === "string" ? request.message : JSON.stringify(request.message) };
      delivery = { ...delivery, durable: { id: eventRecordId(request, event.id), event, policy: this.byRoute.get(record.definitionId)?.definition.eventDelivery ?? {} } };
    }
    await this.deliver({ definitionId: record.definitionId, agentId: request.agentId, conversationId: request.conversationId, workspaceId: request.workspaceId }, [delivery]);
    const event = deliveryEvent(delivery);
    const journal = this.data.listEvents && (await Effect.runPromise(this.data.listEvents())).find((item) => item.id === eventRecordId(request, event.id));
    const handlingRunId = journal?.runId ?? this.gate.activeRun(request.conversationId);
    return handlingRunId ? this.getRun(handlingRunId) : null;
  }

  /** After a restart, deliver the inbound events no run had finished with. */
  private async redeliverInbound(): Promise<void> {
    if (!this.data.listPendingInbound) return;
    const pending = [...await Effect.runPromise(this.data.listPendingInbound())]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const record of pending) {
      const owner = await Effect.runPromise(this.data.getAgent(record.request.agentId));
      if (owner?.durableSubagent) {
        try { await this.assertDurableActive(owner); } catch { continue; }
      }
      const { runId: _lost, ...waiting } = record;
      await this.admitInbound(waiting);
    }
  }

  /** After a restart, hand over whatever was waiting when the runtime stopped. */
  private async redeliverDelegations(): Promise<void> {
    for (const delegation of await this.listDelegations()) {
      // Repair a crash between persisting the task conversation and enqueueing it.
      const worker = await Effect.runPromise(this.data.getAgent(delegation.workerAgentId));
      if (worker && delegation.status === "working" && !delegation.pendingReplies?.length && this.data.listPendingInbound) {
        let active = true;
        try { await this.assertDurableActive(worker); } catch { active = false; }
        const pending = await Effect.runPromise(this.data.listPendingInbound());
        if (active && !(this.data.listEvents && (await Effect.runPromise(this.data.listEvents())).some((item) => item.target.conversationId === delegation.id)) && !pending.some((item) => item.request.conversationId === delegation.id) && (await this.loadDelegation(delegation.id))?.status === "working") {
          await this.admitInbound({
            id: `task:${delegation.id}`, definitionId: worker.definitionId, createdAt: delegation.createdAt,
            request: { agentId: worker.id, conversationId: delegation.id, workspaceId: worker.workspaceId,
              message: renderDelegatedTask({ delegationId: delegation.id, from: delegation.from.definitionId, task: delegation.task }),
              payload: { delegation }, source: { kind: "delegation", id: delegation.id } },
          });
        }
      }
      const update = undeliveredUpdate(delegation);
      if (update) await this.deliver(this.delegatorTarget(delegation), [update]);
      if (delegation.pendingReplies?.length) {
        await this.deliver(
          {
            definitionId: delegation.to,
            agentId: delegation.workerAgentId,
            conversationId: delegation.id,
            workspaceId: delegation.workspaceId,
          },
          delegation.pendingReplies.map((message, index) => ({
            deliveryId: delegation.pendingReplyIds?.[index],
            kind: "reply" as const,
            delegationId: delegation.id,
            from: delegation.from.definitionId,
            message,
          })),
        );
      }
    }
  }

  private reportDeliveryFailure(conversationId: string, cause: unknown): void {
    this.observability.append({
      type: "delegation.delivery.failed",
      category: "system",
      data: { conversationId, error: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  private async loadDelegation(id: string): Promise<FoundryDelegation | null> {
    const conversation = await Effect.runPromise(this.data.getConversation(id));
    return delegationFromContext(conversation?.context) ?? null;
  }

  private updateDelegation(
    id: string,
    change: DelegationPatch | ((current: FoundryDelegation) => DelegationPatch),
  ): Promise<FoundryDelegation | null> {
    return this.inConversation(`record:${id}`, async () => {
      const conversation = await Effect.runPromise(this.data.getConversation(id));
      const current = delegationFromContext(conversation?.context);
      if (!conversation || !current) return null;
      const patch = typeof change === "function" ? change(current) : change;
      if (Object.keys(patch).length === 0) return current;
      const now = new Date().toISOString();
      const merged: Record<string, unknown> = { ...current, ...patch, updatedAt: now };
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
      const next = Object.freeze(merged) as unknown as FoundryDelegation;
      await Effect.runPromise(this.data.putConversation(Object.freeze({
        ...conversation,
        context: Object.freeze({ ...conversation.context, delegation: next }),
        updatedAt: now,
      })));
      return next;
    });
  }

  private delegatorTarget(delegation: FoundryDelegation): DeliveryTarget {
    return {
      definitionId: delegation.from.definitionId,
      agentId: delegation.from.agentId,
      conversationId: delegation.from.conversationId,
      workspaceId: delegation.workspaceId,
    };
  }

  private async executeDelegationCommand(
    command: FoundryDelegationCommand,
    parentRunId: string,
  ): Promise<void> {
    if (!isDelegationId(command.delegationId)) {
      throw new Error(`"${command.delegationId}" is not a delegation id.`);
    }
    if (command.type === "delegate") {
      await this.startDelegation(command, parentRunId);
      return;
    }
    const delegation = await this.loadDelegation(command.delegationId);
    if (command.type === "delegate.reply") {
      if (
        !delegation
        || delegation.from.agentId !== command.agentId
        || delegation.from.conversationId !== command.conversationId
      ) {
        throw new Error(`Delegation "${command.delegationId}" was not started by this conversation.`);
      }
      // A reply answers the open question, or reopens finished work as a follow-up.
      await this.updateDelegation(delegation.id, (current) => ({
        status: "working",
        question: undefined,
        ...(current.undelivered === "question" ? { undelivered: undefined } : {}),
        pendingReplies: [...(current.pendingReplies ?? []), command.message],
        pendingReplyIds: [...(current.pendingReplyIds ?? []), command.id],
      }));
      await this.deliver(
        {
          definitionId: delegation.to,
          agentId: delegation.workerAgentId,
          conversationId: delegation.id,
          workspaceId: delegation.workspaceId,
        },
        [{ kind: "reply", deliveryId: command.id, delegationId: delegation.id, from: command.definitionId, message: command.message }],
      );
      this.observability.append({
        type: "delegation.replied",
        category: "system",
        agent: command.definitionId,
        runId: parentRunId,
        data: { delegationId: delegation.id, to: delegation.to },
      });
      return;
    }
    if (
      !delegation
      || delegation.workerAgentId !== command.agentId
      || delegation.id !== command.conversationId
    ) {
      throw new Error(`Only the worker on delegation "${command.delegationId}" can ask about it.`);
    }
    await this.updateDelegation(delegation.id, {
      status: "waiting",
      question: command.question,
      undelivered: "question",
      updateId: command.id,
    });
    await this.deliver(this.delegatorTarget(delegation), [{
      kind: "question",
      deliveryId: command.id,
      delegationId: delegation.id,
      agent: delegation.to,
      task: delegation.task,
      question: command.question,
    }]);
    this.observability.append({
      type: "delegation.question",
      category: "system",
      agent: delegation.to,
      runId: parentRunId,
      data: { delegationId: delegation.id, question: command.question },
    });
  }

  private async startDelegation(
    command: Extract<FoundryDelegationCommand, { readonly type: "delegate" }>,
    parentRunId: string,
  ): Promise<void> {
    const from: DeliveryTarget = {
      definitionId: command.definitionId,
      agentId: command.agentId,
      conversationId: command.conversationId,
      workspaceId: command.workspaceId,
    };
    const parentDefinition = this.byRoute.get(command.definitionId)?.definition;
    const durable = Object.hasOwn(parentDefinition?.durableSubagents ?? {}, command.to) ? parentDefinition!.durableSubagents![command.to] : undefined;
    const targetRoute = durable ? durableRoute(command.definitionId, command.to) : command.to;
    if (!this.byRoute.has(targetRoute)) {
      await this.deliver(from, [{
        kind: "failed",
        delegationId: command.delegationId,
        agent: command.to,
        task: command.task,
        error: `There is no "${command.to}" agent in this project.`,
      }]);
      return;
    }
    const delegator = await Effect.runPromise(this.data.getAgent(command.agentId));
    if (!delegator || delegator.workspaceId !== command.workspaceId) {
      throw new Error("A delegation must come from an agent instance in its workspace.");
    }
    let ownedWorker: AgentInstance | undefined;
    if (durable) {
      try {
        if (!this.data.putPendingInbound || !this.data.listPendingInbound || !this.data.deletePendingInbound) throw new Error("Durable delegation requires pending inbound persistence.");
        ownedWorker = await this.ensureSubagent(command.agentId, command.to);
      }
      catch (cause) {
        await this.deliver(from, [{ kind: "failed", delegationId: command.delegationId, agent: command.to, task: command.task, error: cause instanceof Error ? cause.message : String(cause) }]);
        return;
      }
    }
    const workerId = ownedWorker?.id ?? workerAgentId(command.agentId, command.to);
    const worker = ownedWorker ?? await Effect.runPromise(this.data.getAgent(workerId))
      ?? await this.createAgent(command.to, {
        id: workerId,
        workspaceId: command.workspaceId,
        context: {
          ...delegator.context,
          delegatedBy: { agentId: command.agentId, definitionId: command.definitionId },
        },
      });
    if (worker.definitionId !== targetRoute || worker.workspaceId !== command.workspaceId) {
      throw new Error(`Agent instance "${workerId}" is not a ${command.to} worker in this workspace.`);
    }
    const now = new Date().toISOString();
    const delegation: FoundryDelegation = Object.freeze({
      id: command.delegationId,
      to: targetRoute,
      workerAgentId: workerId,
      workspaceId: command.workspaceId,
      from: Object.freeze({
        definitionId: command.definitionId,
        agentId: command.agentId,
        conversationId: command.conversationId,
        runId: parentRunId,
      }),
      task: command.task,
      status: "working",
      createdAt: now,
      updatedAt: now,
    });
    const title = command.task.replace(/\s+/g, " ").trim();
    await this.createConversation(workerId, {
      id: delegation.id,
      workspaceId: command.workspaceId,
      title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
      context: { delegation },
    });
    const workerRequest: FoundryRequest = {
      agentId: workerId,
      conversationId: delegation.id,
      workspaceId: command.workspaceId,
      message: renderDelegatedTask({ delegationId: delegation.id, from: command.definitionId, task: command.task }),
      payload: { delegation },
      source: { kind: "delegation", id: delegation.id },
    };
    const runId = (await this.admitInbound({ id: `task:${delegation.id}`, definitionId: targetRoute, request: workerRequest, createdAt: now }))?.id;
    if (runId) this.occupyConversation(delegation.id, runId);
    this.observability.append({
      type: "delegation.started",
      category: "system",
      agent: command.definitionId,
      runId: parentRunId,
      data: { delegationId: delegation.id, to: command.to, workerAgentId: workerId, workerRunId: runId },
    });
  }

  /** Report a worker's finished run back to whoever delegated to it. */
  // ── Mesh ────────────────────────────────────────────────────────────────
  //
  // Foundry hosts Glove Mesh for agents that are peers: existing instances in
  // one workspace, addressed by instance id. A new message starts a thread: a
  // conversation on the recipient whose context carries the record. Messages
  // travel as "mesh" deliveries on the same durable path as delegation
  // updates: into the run working on that conversation, or as one run once it
  // is free. The recipient's final reply goes back on its own.

  /** Every thread, newest first, optionally narrowed to who started it or who it went to. */
  async listThreads(filter: {
    /** The agent that started the thread. */
    readonly agentId?: string;
    /** The conversation that started the thread. */
    readonly conversationId?: string;
    /** The agent the thread was sent to. */
    readonly to?: string;
    readonly status?: FoundryMeshThreadStatus;
  } = {}): Promise<ReadonlyArray<FoundryMeshThread>> {
    const found: FoundryMeshThread[] = [];
    for (const agent of await Effect.runPromise(this.data.listAgents())) {
      if (filter.to && agent.id !== filter.to) continue;
      for (const conversation of await Effect.runPromise(this.data.listConversations(agent.id))) {
        const thread = threadFromContext(conversation.context);
        if (!thread || thread.to.agentId !== agent.id || thread.id !== conversation.id) continue;
        if (filter.agentId && thread.from.agentId !== filter.agentId) continue;
        if (filter.conversationId && thread.from.conversationId !== filter.conversationId) continue;
        if (filter.status && thread.status !== filter.status) continue;
        found.push(thread);
      }
    }
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * At start: older thread records kept their own lists of messages not
   * handed over yet; move them to the event journal once. Then finish what a
   * stop cut short: messages committed (or being committed) to the
   * application's record and not handed over, and drafts decided but not
   * delivered or dropped. Message ids keep a retry from delivering twice.
   */
  private async redeliverThreads(): Promise<void> {
    for (const thread of await this.listThreads()) {
      if (thread.undelivered?.length || thread.pending?.length) {
        if (thread.undelivered?.length) await this.deliverMesh(this.starterTarget(thread), "starter", thread.undelivered);
        if (thread.pending?.length) await this.deliverMesh(this.recipientTarget(thread), "recipient", thread.pending);
        await this.updateThread(thread.id, { status: thread.status });
      }
      if (thread.outbox?.length) await this.flushOutbox(thread.id).catch((cause) => this.reportMeshFailure(thread, cause));
      for (const held of thread.held ?? []) {
        if (held.decision !== "draft" || !held.approvalId) continue;
        const approval = await this.getApproval(held.approvalId).catch(() => null);
        if (approval && approval.status !== "pending") await this.settleMeshDraft(approval).catch((cause) => this.reportMeshFailure(thread, cause));
      }
    }
  }

  /** The open threads a conversation started, oldest first. */
  private async openThreadsFrom(conversation: Conversation): Promise<ReadonlyArray<FoundryMeshThread>> {
    const open: FoundryMeshThread[] = [];
    for (const id of startedThreadIds(conversation.context)) {
      const thread = await this.loadThread(id);
      if (thread && thread.from.conversationId === conversation.id && isOpenThread(thread)) open.push(thread);
    }
    return open.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async loadThread(id: string): Promise<FoundryMeshThread | null> {
    const conversation = await Effect.runPromise(this.data.getConversation(id));
    const thread = threadFromContext(conversation?.context);
    return thread && thread.id === id ? thread : null;
  }

  private updateThread(
    id: string,
    change: ThreadPatch | ((current: FoundryMeshThread) => ThreadPatch),
  ): Promise<FoundryMeshThread | null> {
    return this.inConversation(`record:${id}`, async () => {
      const conversation = await Effect.runPromise(this.data.getConversation(id));
      const current = threadFromContext(conversation?.context);
      if (!conversation || !current) return null;
      const patch: Record<string, unknown> = { ...(typeof change === "function" ? change(current) : change) };
      // Once a person took the thread over, only another take-over changes that.
      if (current.status === "taken-over" && patch.status !== "taken-over") delete patch.status;
      if (Object.keys(patch).length === 0) return current;
      const now = new Date().toISOString();
      const merged: Record<string, unknown> = { ...current, ...patch, updatedAt: now };
      // Older records kept their own redelivery lists; the event journal does that now.
      delete merged.undelivered;
      delete merged.pending;
      for (const key of ["held", "outbox"]) if (Array.isArray(merged[key]) && (merged[key] as unknown[]).length === 0) delete merged[key];
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
      const next = Object.freeze(merged) as unknown as FoundryMeshThread;
      await Effect.runPromise(this.data.putConversation(Object.freeze({
        ...conversation,
        context: Object.freeze({ ...conversation.context, meshThread: next }),
        updatedAt: now,
      })));
      return next;
    });
  }

  private starterTarget(thread: FoundryMeshThread): DeliveryTarget {
    return {
      definitionId: thread.from.definitionId,
      agentId: thread.from.agentId,
      conversationId: thread.from.conversationId,
      workspaceId: thread.from.workspaceId ?? thread.workspaceId,
    };
  }

  private recipientTarget(thread: FoundryMeshThread): DeliveryTarget {
    return {
      definitionId: thread.to.definitionId,
      agentId: thread.to.agentId,
      conversationId: thread.id,
      workspaceId: thread.to.workspaceId ?? thread.workspaceId,
    };
  }

  private sideTarget(thread: FoundryMeshThread, side: FoundryMeshDelivery["side"]): DeliveryTarget {
    return side === "starter" ? this.starterTarget(thread) : this.recipientTarget(thread);
  }

  /**
   * Hand mesh messages to one side of a thread. Messages, replies and
   * failures go through durable delivery. A read receipt only ever reaches a
   * run that is listening, and is dropped otherwise.
   */
  private async deliverMesh(
    target: DeliveryTarget,
    side: FoundryMeshDelivery["side"],
    messages: ReadonlyArray<FoundryMeshMessage>,
    peer?: string,
  ): Promise<void> {
    const delivery = (message: FoundryMeshMessage): FoundryConversationDelivery => ({
      kind: "mesh", side, message, deliveryId: message.id, ...(peer && message.from.kind === "human" ? { peer } : {}),
    });
    const receipts = messages.filter((message) => message.kind === "ack");
    if (receipts.length) {
      await this.inConversation(target.conversationId, async () => {
        if (!this.conversationListeners.has(target.conversationId)) return;
        for (const message of receipts) await writeMailboxDelivery(this.mailboxDirectory, target.conversationId, delivery(message));
      });
    }
    const durable = messages.filter((message) => message.kind !== "ack");
    if (durable.length) await this.deliver(target, durable.map(delivery));
  }

  /**
   * Send messages to one side of a thread. Under the application's mesh they
   * go through the thread's outbox: committed to the application's record
   * first, then handed over, so the record and the journal agree. A side
   * that was taken over gets nothing; the record still does.
   */
  private async sendToSide(
    thread: FoundryMeshThread,
    side: FoundryMeshDelivery["side"],
    messages: ReadonlyArray<FoundryMeshMessage>,
    runId?: string,
  ): Promise<void> {
    const target = this.sideTarget(thread, side);
    const away = isTakenOverBy(thread, target.agentId);
    const peer = side === "starter" ? thread.to.agentId : undefined;
    const receipts = messages.filter((message) => message.kind === "ack");
    if (receipts.length && !away) await this.deliverMesh(target, side, receipts, peer);
    const durable = messages.filter((message) => message.kind !== "ack");
    if (!durable.length) return;
    if (!this.application.mesh) {
      if (!away) await this.deliverMesh(target, side, durable, peer);
      return;
    }
    const ids = new Set(durable.map((message) => message.id));
    await this.updateThread(thread.id, (current) => ({
      outbox: [...(current.outbox ?? []).filter((entry) => !ids.has(entry.message.id)), ...durable.map((message) => ({ message, side }))],
    }));
    await this.flushOutbox(thread.id, runId).catch((cause) => {
      // The message is accepted; the commit is retried, then delivered.
      this.reportMeshFailure(thread, cause, runId);
      this.retryOutbox(thread.id, 0);
    });
  }

  /** Commit each outbox message to the application's record, then deliver it. */
  private async flushOutbox(threadId: string, runId?: string): Promise<void> {
    const commit = this.application.mesh?.commit;
    for (;;) {
      const thread = await this.loadThread(threadId);
      const entry = thread?.outbox?.[0];
      if (!thread || !entry) return;
      if (commit) {
        const committed = await resolveResolvable(commit({ thread, message: entry.message, side: entry.side }, this.meshHookContext(runId)));
        this.observability.append({
          type: "mesh.committed",
          category: "system",
          agent: thread.to.definitionId,
          ...(runId ? { runId } : {}),
          data: { threadId, messageId: entry.message.id, record: thread.record ?? thread.id, ...(committed && committed.recordId ? { recordId: committed.recordId } : {}) },
        });
      }
      const target = this.sideTarget(thread, entry.side);
      if (!isTakenOverBy(thread, target.agentId)) {
        await this.deliverMesh(target, entry.side, [entry.message], entry.side === "starter" ? thread.to.agentId : undefined);
      }
      await this.updateThread(threadId, (current) => ({
        outbox: (current.outbox ?? []).filter((item) => item.message.id !== entry.message.id),
      }));
    }
  }

  private retryOutbox(threadId: string, attempt: number): void {
    const delay = MESH_COMMIT_RETRY_MS[attempt];
    if (delay === undefined || this.stopping) return;
    const timer = setTimeout(() => {
      if (this.stopping) return;
      void this.flushOutbox(threadId).catch(async (cause) => {
        const thread = await this.loadThread(threadId).catch(() => null);
        if (thread) this.reportMeshFailure(thread, cause);
        this.retryOutbox(threadId, attempt + 1);
      });
    }, delay);
    timer.unref?.();
  }

  private reportMeshFailure(thread: FoundryMeshThread, cause: unknown, runId?: string): void {
    this.observability.append({
      type: "mesh.commit.failed",
      category: "system",
      agent: thread.to.definitionId,
      ...(runId ? { runId } : {}),
      data: { threadId: thread.id, error: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  private meshHookContext(runId?: string): FoundryMeshHookContext {
    return { data: this.data, ...(runId ? { runId } : {}) };
  }

  private meshRefusal(): string {
    return this.application.mesh?.refusal ?? DEFAULT_MESH_REFUSAL;
  }

  /** The application's gate. Without one, everything is delivered. */
  private async gateMesh(send: FoundryMeshSend, runId?: string): Promise<FoundryMeshDecision> {
    const authorize = this.application.mesh?.authorize;
    if (!authorize) return { decision: "deliver" };
    const decided = await resolveResolvable(authorize(send, this.meshHookContext(runId)));
    switch (decided?.decision) {
      case "deliver":
      case "hold":
        return decided;
      case "draft":
        if (decided.approvalId !== undefined && !isFoundryApprovalId(decided.approvalId)) {
          throw new Error(`mesh.authorize drafted with "${decided.approvalId}", which is not an approval id (approval_<uuid>).`);
        }
        return decided;
      case "refuse":
        return { decision: "refuse", message: typeof decided.message === "string" && decided.message.trim() ? decided.message : this.meshRefusal() };
      default:
        throw new Error("mesh.authorize must decide deliver, hold, draft or refuse.");
    }
  }

  /**
   * Act on the gate's decision for one message to one side. Held and drafted
   * messages are stored on the thread, not delivered; `onDeliver` is what
   * delivery changes on the thread, applied only when it happens, because
   * the side waiting for it must not see a message it has not been given.
   */
  private async dispatchMesh(
    thread: FoundryMeshThread,
    side: FoundryMeshDelivery["side"],
    message: FoundryMeshMessage,
    decision: FoundryMeshDecision,
    origin: { readonly runId?: string; readonly agent: AgentInstance; readonly conversationId: string; readonly kind: FoundryMeshSend["kind"] },
    onDeliver?: FoundryMeshHeldMessage["onDeliver"],
  ): Promise<void> {
    if (decision.decision === "deliver") {
      if (onDeliver) await this.updateThread(thread.id, onDeliver);
      await this.sendToSide(thread, side, [message], origin.runId);
      return;
    }
    if (decision.decision === "refuse") return;
    const approvalId = decision.decision === "draft"
      ? await this.draftApproval(thread, message, decision.approvalId, origin)
      : undefined;
    const held: FoundryMeshHeldMessage = {
      message, side, decision: decision.decision,
      ...(approvalId ? { approvalId } : {}),
      ...(onDeliver ? { onDeliver } : {}),
    };
    await this.updateThread(thread.id, (current) => ({
      held: [...(current.held ?? []).filter((item) => item.message.id !== message.id), held],
    }));
    this.observability.append({
      type: decision.decision === "draft" ? "mesh.drafted" : "mesh.held",
      category: "system",
      agent: origin.agent.definitionId,
      ...(origin.runId ? { runId: origin.runId } : {}),
      data: { threadId: thread.id, messageId: message.id, from: message.from.agentId, to: message.to, side, ...(approvalId ? { approvalId } : {}) },
    });
  }

  /** A drafted message waits on an approval nobody resumes a run for. */
  private async draftApproval(
    thread: FoundryMeshThread,
    message: FoundryMeshMessage,
    requestedId: string | undefined,
    origin: { readonly runId?: string; readonly agent: AgentInstance; readonly conversationId: string; readonly kind: FoundryMeshSend["kind"] },
  ): Promise<string> {
    if (!this.approvalPolicy.durable || !this.data.putApproval || !this.data.getApproval) {
      throw new Error("A drafted mesh message needs a data adapter that stores approvals.");
    }
    const id = requestedId ?? `approval_${randomUUID()}`;
    const now = new Date();
    const approval: FoundryApproval = this.withApprovalUrl({
      id,
      runId: origin.runId ?? `mesh:${thread.id}`,
      definitionId: origin.agent.definitionId,
      agentId: origin.agent.id,
      conversationId: origin.conversationId,
      workspaceId: origin.agent.workspaceId,
      toolName: origin.kind === "reply" ? "glove_mesh_reply" : "glove_mesh_send_message",
      toolInput: { to: message.to, content: message.content, ...(message.inReplyTo ? { in_reply_to: message.inReplyTo } : {}) },
      status: "pending",
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.approvalPolicy.expiresAfterMs).toISOString(),
      // Nobody waits for it and nothing resumes: the decision delivers or drops the message.
      suspendedAt: now.toISOString(),
      settledInRun: true,
      mesh: { threadId: thread.id, messageId: message.id },
    });
    await this.withApprovals(async () => {
      const existing = await Effect.runPromise(this.data.getApproval!(id));
      if (existing && existing.mesh?.messageId !== message.id) throw new Error(`Approval "${id}" already exists.`);
      if (!existing) await Effect.runPromise(this.data.putApproval!(approval));
    });
    return id;
  }

  /** A drafted message's approval was decided: deliver it, or drop it. */
  private async settleMeshDraft(approval: FoundryApproval): Promise<void> {
    if (!approval.mesh || approval.status === "pending") return;
    await this.releaseHeld(approval.mesh.threadId, approval.mesh.messageId, approval.status === "approved" ? "deliver" : "discard", approval.id);
  }

  /**
   * Release a message the application's gate held: deliver it (committed to
   * your record first) or discard it. The sender is not told either way.
   * Drafts are decided through their approval instead.
   */
  async releaseMeshMessage(threadId: string, messageId: string, decision: "deliver" | "discard"): Promise<FoundryMeshThread> {
    const thread = await this.loadThread(threadId);
    if (!thread) throw new Error(`There is no mesh thread "${threadId}".`);
    const held = thread.held?.find((item) => item.message.id === messageId);
    if (!held) throw new Error(`Thread "${threadId}" holds no message "${messageId}".`);
    if (held.decision === "draft") throw new Error(`Message "${messageId}" is a draft: decide approval "${held.approvalId}" instead.`);
    await this.releaseHeld(threadId, messageId, decision);
    return (await this.loadThread(threadId)) ?? thread;
  }

  private async releaseHeld(threadId: string, messageId: string, decision: "deliver" | "discard", approvalId?: string): Promise<void> {
    let released: FoundryMeshHeldMessage | undefined;
    // One write moves it from held to the outbox, so a crash cannot lose it.
    const thread = await this.updateThread(threadId, (current) => {
      released = current.held?.find((item) => item.message.id === messageId && (!approvalId || item.approvalId === approvalId));
      if (!released) return {};
      const held = (current.held ?? []).filter((item) => item !== released);
      if (decision === "discard") return { held };
      return {
        held,
        ...(released.onDeliver ?? {}),
        ...(released.onDeliver?.status === "replied" ? { question: undefined } : {}),
        outbox: [...(current.outbox ?? []).filter((entry) => entry.message.id !== messageId), { message: released.message, side: released.side }],
      };
    });
    if (!thread || !released) return;
    this.observability.append({
      type: decision === "deliver" ? "mesh.released" : "mesh.discarded",
      category: "system",
      agent: thread.to.definitionId,
      data: { threadId, messageId, ...(approvalId ? { approvalId } : {}) },
    });
    if (decision === "deliver") {
      await this.flushOutbox(threadId).catch((cause) => {
        this.reportMeshFailure(thread, cause);
        this.retryOutbox(threadId, 0);
      });
    }
  }

  /**
   * A person's message in a thread, entered by the application from its own
   * record (so it is not committed again). It reaches each agent still in
   * the thread as a message from a person, and starts the recipient working
   * again. Pass `id` (your record's message id) to make a retry a no-op.
   */
  async meshHumanMessage(threadId: string, input: {
    readonly authorId: string;
    readonly name?: string;
    readonly text: string;
    readonly id?: string;
  }): Promise<FoundryMeshMessage> {
    const thread = await this.loadThread(threadId);
    if (!thread) throw new Error(`There is no mesh thread "${threadId}".`);
    if (!input.authorId.trim() || !input.text.trim()) throw new Error("A person's message needs an authorId and text.");
    const id = input.id ?? newMessageId();
    const message = (to: string): FoundryMeshMessage => ({
      kind: "message",
      id,
      threadId,
      from: { agentId: input.authorId, name: input.name ?? input.authorId, kind: "human" },
      to,
      content: input.text,
      createdAt: new Date().toISOString(),
    });
    const recipientIn = !isTakenOverBy(thread, thread.to.agentId);
    await this.updateThread(threadId, (current) => ({
      ...(recipientIn ? { status: "working" as const, question: undefined } : {}),
      messageIds: current.messageIds.includes(id) ? current.messageIds : [...current.messageIds, id],
    }));
    if (recipientIn) await this.deliverMesh(this.recipientTarget(thread), "recipient", [message(thread.to.agentId)]);
    if (!isTakenOverBy(thread, thread.from.agentId)) {
      await this.deliverMesh(this.starterTarget(thread), "starter", [message(thread.from.agentId)], thread.to.agentId);
    }
    this.observability.append({
      type: "mesh.human.message",
      category: "system",
      agent: thread.to.definitionId,
      data: { threadId, messageId: id, authorId: input.authorId },
    });
    return message(recipientIn ? thread.to.agentId : thread.from.agentId);
  }

  /**
   * A person takes a thread over. The agents named (default: both) leave it:
   * nothing more is delivered to them in this thread, what they send to it
   * is refused, and a recipient run working on it is cancelled without a
   * reply. Messages to a side that left still reach your record.
   */
  async meshTakeOver(threadId: string, options: { readonly by: string; readonly agentId?: string }): Promise<FoundryMeshThread> {
    const thread = await this.loadThread(threadId);
    if (!thread) throw new Error(`There is no mesh thread "${threadId}".`);
    const parties = [thread.from.agentId, thread.to.agentId];
    if (options.agentId && !parties.includes(options.agentId)) throw new Error(`Agent "${options.agentId}" is not in thread "${threadId}".`);
    const leaving = options.agentId ? [options.agentId] : parties;
    const updated = await this.updateThread(threadId, (current) => ({
      status: "taken-over",
      question: undefined,
      takenOver: {
        by: options.by,
        agentIds: [...new Set([...(current.takenOver?.agentIds ?? []), ...leaving])],
        at: new Date().toISOString(),
      },
    }));
    if (leaving.includes(thread.to.agentId)) {
      for (const run of await this.listRuns(thread.to.definitionId)) {
        if (run.conversationId === threadId && (run.status === "pending" || run.status === "running")) await this.cancel(run.id);
      }
    }
    this.observability.append({
      type: "mesh.taken_over",
      category: "system",
      agent: thread.to.definitionId,
      data: { threadId, by: options.by, agentIds: leaving },
    });
    return updated ?? thread;
  }

  /** A run's mesh call: answered through its request, so the tool hears the outcome. */
  private async runMeshCommand(command: FoundryMeshCommand, parentRunId: string): Promise<void> {
    const request = await getFoundryCoreCommandRequest(this.coreCommandDirectory, command.id);
    if (!request) {
      await this.executeMeshCommand(command, parentRunId);
      return;
    }
    if (!(await claimFoundryCoreCommandRequest(this.coreCommandDirectory, command.id))) return;
    try {
      if (request.runId !== parentRunId) throw new Error("This mesh call does not belong to this run.");
      const output = await this.executeMeshCommand(command, parentRunId);
      await settleFoundryCoreCommandRequest(this.coreCommandDirectory, command.id, { status: "success", output });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      this.observability.append({
        type: "mesh.refused",
        category: "system",
        agent: command.definitionId,
        runId: parentRunId,
        data: { type: command.type, error, ...(cause instanceof MeshRefusal ? { reason: cause.reason } : {}) },
      });
      await settleFoundryCoreCommandRequest(this.coreCommandDirectory, command.id, { status: "error", error });
    }
  }

  /**
   * The agents an agent may see and message: its workspace, or whoever the
   * application's `mesh.peers` names; then narrowed by its definition's rule.
   */
  private async meshPeers(sender: AgentInstance, runId?: string): Promise<ReadonlyArray<AgentInstance>> {
    const own = hostedMeshOptions(this.byRoute.get(sender.definitionId)?.definition.mesh)?.peers;
    const named = this.application.mesh?.peers;
    let candidates: AgentInstance[];
    if (named) {
      candidates = [];
      const seen = new Set<string>([sender.id]);
      for (const peer of await resolveResolvable(named(sender, this.meshHookContext(runId)))) {
        if (!peer || typeof peer.agentId !== "string" || seen.has(peer.agentId)) continue;
        seen.add(peer.agentId);
        const agent = await Effect.runPromise(this.data.getAgent(peer.agentId));
        if (!agent || !this.byRoute.has(agent.definitionId)) continue;
        candidates.push(Object.freeze({
          ...agent,
          ...(peer.name ? { name: peer.name } : {}),
          ...(peer.description ? { description: peer.description } : {}),
        }));
      }
    } else {
      candidates = (await Effect.runPromise(this.data.listAgents())).filter((agent) =>
        agent.workspaceId === sender.workspaceId
        && agent.id !== sender.id
        && this.byRoute.has(agent.definitionId));
    }
    return candidates.filter((agent) => own?.(sender, agent) ?? true);
  }

  private async executeMeshCommand(command: FoundryMeshCommand, parentRunId: string): Promise<unknown> {
    const sender = await Effect.runPromise(this.data.getAgent(command.agentId));
    if (!sender || sender.workspaceId !== command.workspaceId) {
      throw new Error("A mesh call must come from an agent instance in its workspace.");
    }
    // The sender is the run's own instance, whatever the command claims.
    const run = await this.getRun(parentRunId).catch(() => null);
    if (run && ((run.agentId && run.agentId !== sender.id) || (run.conversationId && run.conversationId !== command.conversationId))) {
      throw new Error("A mesh call must come from the run's own agent and conversation.");
    }
    const hosted = Boolean(this.application.mesh);
    const refuse = (reason: string, wording?: string): never => {
      throw hosted ? new MeshRefusal(wording ?? this.meshRefusal(), reason) : new Error(wording ?? reason);
    };
    if (command.type === "mesh.list") {
      const filter = command.name?.toLowerCase();
      return (await this.meshPeers(sender, parentRunId))
        .map(meshIdentity)
        .filter((identity) => !filter || identity.name.toLowerCase().includes(filter));
    }
    const conversation = await Effect.runPromise(this.data.getConversation(command.conversationId));
    if (!conversation || conversation.agentId !== sender.id) {
      throw new Error("A mesh call must come from one of the agent's own conversations.");
    }
    const own = threadFromContext(conversation.context);
    const ownThread = own && own.id === conversation.id && own.to.agentId === sender.id ? own : undefined;
    const startedThreads = async (): Promise<FoundryMeshThread[]> => {
      const threads: FoundryMeshThread[] = [];
      for (const id of startedThreadIds(conversation.context)) {
        const thread = await this.loadThread(id);
        if (thread && thread.from.conversationId === conversation.id) threads.push(thread);
      }
      return threads;
    };
    const origin = (kind: FoundryMeshSend["kind"]) => ({ runId: parentRunId, agent: sender, conversationId: conversation.id, kind });
    const otherSide = async (thread: FoundryMeshThread, toStarter: boolean): Promise<AgentInstance> => {
      const agent = await Effect.runPromise(this.data.getAgent(toStarter ? thread.from.agentId : thread.to.agentId));
      if (!agent) refuse("the other agent is gone", `${toStarter ? thread.from.name : thread.to.name} is no longer on the mesh.`);
      return agent!;
    };
    const decide = async (send: Omit<FoundryMeshSend, "sender" | "senderConversationId">): Promise<FoundryMeshDecision> => {
      const decision = await this.gateMesh({ ...send, sender, senderConversationId: conversation.id }, parentRunId);
      if (decision.decision === "refuse") refuse("refused by mesh.authorize", decision.message);
      return decision;
    };

    if (command.type === "mesh.ack") {
      const thread = ownThread?.messageIds.includes(command.messageId)
        ? ownThread
        : (await startedThreads()).find((item) => item.messageIds.includes(command.messageId));
      if (!thread) throw new Error(`There is no message "${command.messageId}" in your threads.`);
      if (isTakenOverBy(thread, sender.id)) refuse("the sender was taken off this thread");
      const toStarter = thread.id === ownThread?.id;
      const ack: FoundryMeshMessage = {
        kind: "ack",
        id: newMessageId(),
        threadId: thread.id,
        from: { agentId: sender.id, name: sender.name ?? sender.id },
        to: toStarter ? thread.from.agentId : thread.to.agentId,
        content: command.note,
        inReplyTo: command.messageId,
        createdAt: new Date().toISOString(),
      };
      if (hosted) {
        const decision = await this.gateMesh({
          kind: "ack", messageId: ack.id, thread, sender, senderConversationId: conversation.id,
          recipient: await otherSide(thread, toStarter), content: ack.content, inReplyTo: command.messageId,
        }, parentRunId);
        // A receipt the gate does not deliver is dropped, and the sender cannot tell.
        if (decision.decision !== "deliver") return { acknowledged: command.messageId };
      }
      await this.sendToSide(thread, toStarter ? "starter" : "recipient", [ack], parentRunId);
      return { acknowledged: command.messageId };
    }

    const { message: input } = command;
    const message = (threadId: string): FoundryMeshMessage => ({
      kind: "message",
      id: input.id,
      threadId,
      from: { agentId: sender.id, name: sender.name ?? sender.id },
      to: input.to,
      content: input.content,
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      createdAt: new Date().toISOString(),
    });
    const sent = (thread: FoundryMeshThread, direction: FoundryMeshSent["direction"]): FoundryMeshSent => {
      this.observability.append({
        type: direction === "new" ? "mesh.thread.started" : "mesh.message.sent",
        category: "system",
        agent: command.definitionId,
        runId: parentRunId,
        data: { threadId: thread.id, messageId: input.id, from: sender.id, to: input.to },
      });
      return { messageId: input.id, threadId: thread.id, to: input.to, direction };
    };

    // An answer to whoever messaged this conversation.
    if (ownThread && input.to === ownThread.from.agentId && (!input.inReplyTo || ownThread.messageIds.includes(input.inReplyTo))) {
      if (isTakenOverBy(ownThread, sender.id)) refuse("the sender was taken off this thread");
      const outgoing = message(ownThread.id);
      const decision = hosted
        ? await decide({ kind: "message", messageId: outgoing.id, thread: ownThread, recipient: await otherSide(ownThread, true), content: outgoing.content, ...(outgoing.inReplyTo ? { inReplyTo: outgoing.inReplyTo } : {}) })
        : { decision: "deliver" as const };
      await this.updateThread(ownThread.id, (current) => ({
        messageIds: current.messageIds.includes(outgoing.id) ? current.messageIds : [...current.messageIds, outgoing.id],
      }));
      // The starter sees the question once it is given it.
      await this.dispatchMesh(ownThread, "starter", outgoing, decision, origin("message"), { status: "waiting", question: outgoing.content });
      return sent(ownThread, "to-starter");
    }

    // A reply in a thread this conversation started.
    if (input.inReplyTo) {
      const thread = (await startedThreads()).find((item) =>
        item.to.agentId === input.to && item.messageIds.includes(input.inReplyTo!));
      if (!thread) {
        throw new Error(`There is no message "${input.inReplyTo}" in your threads with "${input.to}". Leave in_reply_to out to start a new thread.`);
      }
      if (isTakenOverBy(thread, sender.id)) refuse("the sender was taken off this thread");
      const outgoing = message(thread.id);
      const decision = hosted
        ? await decide({ kind: "message", messageId: outgoing.id, thread, recipient: await otherSide(thread, false), content: outgoing.content, inReplyTo: input.inReplyTo })
        : { decision: "deliver" as const };
      // An answer to the open question, or more work on a finished thread. The sender's view changes now.
      await this.updateThread(thread.id, (current) => ({
        status: "working",
        question: undefined,
        messageIds: current.messageIds.includes(outgoing.id) ? current.messageIds : [...current.messageIds, outgoing.id],
      }));
      await this.dispatchMesh(thread, "recipient", outgoing, decision, origin("message"));
      return sent(thread, "to-recipient");
    }

    // A new thread.
    if (!isThreadId(input.threadId)) throw new Error(`"${input.threadId}" is not a thread id.`);
    if (input.to === sender.id) throw new Error("That is you.");
    const recipient = (await this.meshPeers(sender, parentRunId)).find((agent) => agent.id === input.to);
    if (!recipient) {
      if (hosted) refuse("not a peer");
      throw new Error(`There is no agent "${input.to}" you can message. Use glove_mesh_list_agents to see who there is.`);
    }
    const decision = hosted
      ? await decide({ kind: "message", messageId: input.id, recipient: recipient!, content: input.content })
      : { decision: "deliver" as const };

    // The application may name the thread after its own record.
    let threadId = input.threadId;
    let record: string | undefined;
    const bind = this.application.mesh?.bindThread;
    if (bind) {
      const bound = await resolveResolvable(bind({
        proposedId: input.threadId, sender, senderConversationId: conversation.id, recipient: recipient!, messageId: input.id, content: input.content,
      }, this.meshHookContext(parentRunId)));
      if (!bound || typeof bound.threadId !== "string" || !isBindableThreadId(bound.threadId)) {
        throw new Error("mesh.bindThread must return { threadId } with letters, digits, _ . : or -.");
      }
      threadId = bound.threadId;
      if (bound.record && bound.record !== threadId) record = bound.record;
    }

    // A bound id that already holds this pair's thread, in this direction, continues it.
    const existing = threadId !== input.threadId ? await this.loadThread(threadId) : null;
    if (existing) {
      if (existing.from.agentId !== sender.id || existing.to.agentId !== recipient!.id) {
        throw new Error(`mesh.bindThread returned "${threadId}", which is another pair's thread.`);
      }
      if (isTakenOverBy(existing, sender.id)) refuse("the sender was taken off this thread");
      const outgoing = message(existing.id);
      await this.updateThread(existing.id, (current) => ({
        status: "working",
        question: undefined,
        messageIds: current.messageIds.includes(outgoing.id) ? current.messageIds : [...current.messageIds, outgoing.id],
      }));
      if (existing.from.conversationId !== conversation.id) await this.noteStartedThread(conversation.id, existing.id);
      await this.dispatchMesh(existing, "recipient", outgoing, decision, origin("message"));
      return sent(existing, "to-recipient");
    }
    if (await Effect.runPromise(this.data.getConversation(threadId))) {
      throw new Error(`mesh.bindThread returned "${threadId}", which is already a conversation.`);
    }

    const outgoing = message(threadId);
    const now = new Date().toISOString();
    const thread: FoundryMeshThread = Object.freeze({
      id: threadId,
      workspaceId: sender.workspaceId,
      from: Object.freeze({
        agentId: sender.id,
        name: sender.name ?? sender.id,
        definitionId: sender.definitionId,
        ...(recipient!.workspaceId !== sender.workspaceId ? { workspaceId: sender.workspaceId } : {}),
        conversationId: conversation.id,
        runId: parentRunId,
      }),
      to: Object.freeze({
        agentId: recipient!.id,
        name: recipient!.name ?? recipient!.id,
        definitionId: recipient!.definitionId,
        ...(recipient!.workspaceId !== sender.workspaceId ? { workspaceId: recipient!.workspaceId } : {}),
      }),
      subject: threadSubject(outgoing.content),
      status: "working",
      messageIds: Object.freeze([outgoing.id]),
      ...(record ? { record } : {}),
      createdAt: now,
      updatedAt: now,
    });
    // The recipient's side lives in the recipient's workspace.
    await this.createConversation(recipient!.id, {
      id: thread.id,
      workspaceId: recipient!.workspaceId,
      title: `${thread.from.name}: ${clipTitle(outgoing.content)}`,
      context: { meshThread: thread },
    });
    await this.noteStartedThread(conversation.id, thread.id);
    await this.dispatchMesh(thread, "recipient", outgoing, decision, origin("message"));
    return sent(thread, "new");
  }

  /** Remember on the starter's conversation that it started a thread. */
  private async noteStartedThread(conversationId: string, threadId: string): Promise<void> {
    // The same queue as thread records: this conversation may be a thread too.
    await this.inConversation(`record:${conversationId}`, async () => {
      const current = await Effect.runPromise(this.data.getConversation(conversationId));
      if (!current || startedThreadIds(current.context).includes(threadId)) return;
      await Effect.runPromise(this.data.putConversation({
        ...current,
        context: Object.freeze({
          ...current.context,
          meshThreads: [...startedThreadIds(current.context), threadId],
        }),
        updatedAt: new Date().toISOString(),
      }));
    });
  }

  /** When the recipient's run on a thread ends, its reply (or its failure) goes back. */
  private async settleThread(
    event: { readonly run: Run; readonly status: "completed" | "failed" | "cancelled"; readonly output?: string; readonly error?: string },
    run: FoundryRun,
    steered: boolean,
  ): Promise<void> {
    const thread = await this.loadThread(run.conversationId!);
    if (!thread || run.agentId !== thread.to.agentId) return;
    // Stopped by shutdown: the message that started it is still pending and is delivered again.
    if (this.stopping && event.status !== "completed") return;
    // Taken off the thread: a person answers now, not this run.
    if (isTakenOverBy(thread, thread.to.agentId)) return;
    // One reply per run, however often this is reported.
    const reply = (kind: "reply" | "failed", content: string): FoundryMeshMessage => ({
      kind,
      id: `msg_${kind}_${event.run.id}`,
      threadId: thread.id,
      from: { agentId: thread.to.agentId, name: thread.to.name },
      to: thread.from.agentId,
      content,
      createdAt: new Date().toISOString(),
    });
    if (event.status === "completed") {
      const output = parseJson(event.output) as Partial<FoundryResult> | undefined;
      // Asleep, or waiting for an answer: it replies when it finishes.
      if (output?.status === "suspended") return;
      const text = deliveryText(output?.value);
      if (!text.trim()) {
        await this.updateThread(thread.id, { status: "replied", question: undefined });
        return;
      }
      const message = reply("reply", text);
      await this.updateThread(thread.id, (current) => ({
        messageIds: current.messageIds.includes(message.id) ? current.messageIds : [...current.messageIds, message.id],
      }));
      const replied = { status: "replied" as const, reply: text, question: undefined };
      const decision = await this.gateReply(thread, message, event.run.id);
      if (decision.decision === "refuse") {
        // Refused at the gate: the thread ends here for the recipient, and the starter is not told why.
        await this.updateThread(thread.id, { status: "replied", question: undefined });
        this.observability.append({
          type: "mesh.refused",
          category: "system",
          agent: thread.to.definitionId,
          runId: event.run.id,
          data: { type: "mesh.reply", threadId: thread.id, messageId: message.id, error: decision.message },
        });
        return;
      }
      const recipient = await Effect.runPromise(this.data.getAgent(thread.to.agentId));
      await this.dispatchMesh(thread, "starter", message, decision,
        { runId: event.run.id, agent: recipient ?? ({ id: thread.to.agentId, definitionId: thread.to.definitionId, workspaceId: thread.to.workspaceId ?? thread.workspaceId } as AgentInstance), conversationId: thread.id, kind: "reply" },
        replied);
      if (decision.decision === "deliver") {
        this.observability.append({
          type: "mesh.thread.replied",
          category: "system",
          agent: thread.to.definitionId,
          runId: event.run.id,
          data: { threadId: thread.id },
        });
      }
      return;
    }
    if (event.status === "cancelled" && steered) return;
    const error = event.status === "cancelled" ? "The work was cancelled." : event.error ?? "The run failed.";
    const message = reply("failed", error);
    await this.updateThread(thread.id, (current) => ({
      status: event.status === "cancelled" ? "cancelled" : "failed",
      error,
      messageIds: current.messageIds.includes(message.id) ? current.messageIds : [...current.messageIds, message.id],
    }));
    // Foundry's own notice: committed to the application's record, not gated.
    await this.sendToSide(thread, "starter", [message], event.run.id);
    this.observability.append({
      type: event.status === "cancelled" ? "mesh.thread.cancelled" : "mesh.thread.failed",
      category: "system",
      agent: thread.to.definitionId,
      runId: event.run.id,
      data: { threadId: thread.id, error },
    });
  }

  /** The gate for a recipient's final answer, when the application has one. */
  private async gateReply(thread: FoundryMeshThread, message: FoundryMeshMessage, runId: string): Promise<FoundryMeshDecision> {
    if (!this.application.mesh?.authorize) return { decision: "deliver" };
    const [sender, recipient] = await Promise.all([
      Effect.runPromise(this.data.getAgent(thread.to.agentId)),
      Effect.runPromise(this.data.getAgent(thread.from.agentId)),
    ]);
    if (!sender || !recipient) return { decision: "refuse", message: this.meshRefusal() };
    return this.gateMesh({
      kind: "reply", messageId: message.id, thread, sender, senderConversationId: thread.id, recipient, content: message.content,
    }, runId);
  }

  /**
   * A run whose definition restricts built-ins may only send the commands its
   * mounted tools send. Anything else is refused, however it was emitted.
   */
  private withheldBuiltinRefusal(command: FoundryCoreCommand, runId: string): string | null {
    const mounted = this.runBuiltins.get(runId);
    if (!mounted) return null;
    const tools = builtinsForCommand(command.type);
    if (!tools) return null;
    if (tools.some((name) => mounted.tools.has(name))) return null;
    if (command.type === "transmit" && mounted.transmissionTools) return null;
    return `This run has no tool that can send "${command.type}".`;
  }

  private async refuseCoreCommand(command: FoundryCoreCommand, runId: string, error: string, route: string): Promise<void> {
    this.observability.append({
      type: "foundry.builtin.refused",
      category: "system",
      agent: route,
      runId,
      data: { type: command.type, error },
    });
    // A tool waiting on this command hears the refusal instead of timing out.
    if (await getFoundryCoreCommandRequest(this.coreCommandDirectory, command.id).catch(() => null)) {
      await settleFoundryCoreCommandRequest(this.coreCommandDirectory, command.id, { status: "error", error }).catch(() => undefined);
    }
  }

  private async handleRunSettled(event: {
    readonly route: string;
    readonly run: Run;
    readonly status: "completed" | "failed" | "cancelled";
    readonly output?: string;
    readonly error?: string;
  }): Promise<void> {
    void this.settleApprovalsOf(event.run.id).catch((cause) => this.reportApprovalFailure(event.run.id, cause));
    this.runBuiltins.delete(event.run.id);
    this.recentlySettledRuns.set(event.run.id, event.status);
    if (this.recentlySettledRuns.size > 1_000) this.recentlySettledRuns.delete(this.recentlySettledRuns.keys().next().value!);
    void this.settleOccurrence(event.run.id, event.status).catch((cause) => {
      this.observability.append({
        type: "activation.persistence.error",
        category: "activation",
        agent: event.route,
        runId: event.run.id,
        data: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    });
    this.releaseConversationRun(event.run.id);
    // The conversation's next run starts once this one's process has let go.
    void this.waitForRunProcessRelease(this.toFoundryRun(event.run), event.route)
      .finally(() => this.gate.settled(event.run.id));
    const finishDelivery = async (): Promise<void> => {
      this.settledRuns.add(event.run.id);
      if (this.settledRuns.size > 1_000) this.settledRuns.delete(this.settledRuns.values().next().value!);
      if (event.status === "completed") {
        const result = parseJson(event.output) as FoundryResult | undefined;
        await this.finishEvents(event.run.id, result?.consumedEventIds ?? []);
        if (result?.retryEventIds?.length) this.scheduleEventRetries(result.retryEventIds);
      }
      await this.finishPendingInbound(event.run.id).catch((cause) =>
        this.reportDeliveryFailure(this.toFoundryRun(event.run).conversationId ?? "settle", cause));
    };
    const steered = this.steeredRuns.delete(event.run.id);
    const run = this.toFoundryRun(event.run);
    if (run.conversationId && (isThreadId(run.conversationId) || (this.application.mesh?.bindThread && await this.loadThread(run.conversationId)))) {
      await finishDelivery();
      await this.settleThread(event, run, steered);
      return;
    }
    if (!run.conversationId || !isDelegationId(run.conversationId)) { await finishDelivery(); return; }
    const delegation = await this.loadDelegation(run.conversationId);
    if (!delegation || run.agentId !== delegation.workerAgentId) { await finishDelivery(); return; }
    if (this.stopping && event.status !== "completed") {
      const worker = await Effect.runPromise(this.data.getAgent(delegation.workerAgentId));
      if (worker?.durableSubagent) return;
    }
    if (event.status === "completed") {
      const output = parseJson(event.output) as Partial<FoundryResult> | undefined;
      // Asleep, or waiting for an answer: it reports when it finishes.
      if (output?.status === "suspended") { await finishDelivery(); return; }
      const result = deliveryText(output?.value);
      await this.updateDelegation(delegation.id, {
        status: "completed",
        result,
        question: undefined,
        undelivered: "result",
        updateId: `result:${event.run.id}`,
      });
      await finishDelivery();
      await this.deliver(this.delegatorTarget(delegation), [{
        kind: "result",
        deliveryId: `result:${event.run.id}`,
        delegationId: delegation.id,
        agent: delegation.to,
        task: delegation.task,
        result,
      }]);
      this.observability.append({
        type: "delegation.completed",
        category: "system",
        agent: delegation.to,
        runId: event.run.id,
        data: { delegationId: delegation.id },
      });
      return;
    }
    if (event.status === "cancelled" && steered) { await finishDelivery(); return; }
    const error = event.status === "cancelled" ? "The work was cancelled." : event.error ?? "The run failed.";
    await this.updateDelegation(delegation.id, {
      status: event.status === "cancelled" ? "cancelled" : "failed",
      error,
      undelivered: "failed",
      updateId: `failed:${event.run.id}`,
    });
    await finishDelivery();
    await this.deliver(this.delegatorTarget(delegation), [{
      kind: "failed",
      deliveryId: `failed:${event.run.id}`,
      delegationId: delegation.id,
      agent: delegation.to,
      task: delegation.task,
      error,
    }]);
    this.observability.append({
      type: event.status === "cancelled" ? "delegation.cancelled" : "delegation.failed",
      category: "system",
      agent: delegation.to,
      runId: event.run.id,
      data: { delegationId: delegation.id, error },
    });
  }

  private async enqueueCoreRequest(
    definitionId: string,
    request: FoundryRequest,
    options: { readonly eventTurn?: boolean } = {},
  ): Promise<string> {
    const discovered = this.byRoute.get(definitionId);
    if (!discovered) throw new Error(`Foundry agent definition "${definitionId}" was not found.`);
    const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
    const conversation = await Effect.runPromise(this.data.getConversation(request.conversationId));
    if (!agent || !conversation) throw new Error("Core command references an unknown agent instance or conversation.");
    return this.admitRun(discovered.executionName, request, options);
  }

  /**
   * Create the run for a request through its conversation's gate: it starts
   * at once when the conversation is free and waits parked, holding no
   * concurrency slot, behind the run that holds it otherwise. A parked run
   * starts from an envelope built when its turn comes, not when it was asked
   * for, so it sees the conversation as the runs ahead of it left it.
   */
  private admitRun(
    executionName: string,
    request: FoundryRequest,
    options: { readonly front?: boolean; readonly eventTurn?: boolean } = {},
  ): Promise<string> {
    return this.gate.admit(
      request.conversationId,
      async (parked) => this.signalRunner.triggerSignal(
        executionName,
        await this.executionEnvelope(request, { leased: true, eventTurn: options.eventTurn }),
        { parked },
      ),
      async (runId) => this.signalRunner.releaseRun(
        runId,
        await this.executionEnvelope(request, { leased: true, eventTurn: options.eventTurn }),
      ),
      options,
    );
  }

  private withActivationTransition<T>(work: () => Promise<T>): Promise<T> {
    return Effect.runPromise(this.activationTransitions.withPermits(1)(Effect.tryPromise({
      try: work,
      catch: (cause) => cause,
    })));
  }

  private async executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void> {
    if (command.type === "sleep" || command.type === "schedule" || command.type.startsWith("schedule.")) {
      return this.withActivationTransition(() => this.executeCoreCommandUnlocked(command, parentRunId));
    }
    return this.executeCoreCommandUnlocked(command, parentRunId);
  }

  private async executeCoreCommandUnlocked(command: FoundryCoreCommand, parentRunId: string): Promise<void> {
    if (isMeshCommand(command)) {
      await this.runMeshCommand(command, parentRunId);
      return;
    }
    if (command.type === "agent.message") {
      try {
        const output = await this.executeAgentMessage(command);
        await settleFoundryCoreCommandRequest(this.coreCommandDirectory, command.id, { status: "success", output });
      } catch (cause) {
        await settleFoundryCoreCommandRequest(this.coreCommandDirectory, command.id, { status: "error", error: cause instanceof Error ? cause.message : String(cause) });
      }
      return;
    }
    if (command.agentId) {
      const sender = await Effect.runPromise(this.data.getAgent(command.agentId));
      if (sender) await this.assertDurableActive(sender);
    }
    if (command.type === "delegate" || command.type === "delegate.reply" || command.type === "delegate.ask") {
      if (command.type === "delegate") await this.inConversation("durable:mutations", () => this.executeDelegationCommand(command, parentRunId));
      else await this.executeDelegationCommand(command, parentRunId);
      return;
    }
    if (command.type === "transmit") {
      const request = await getFoundryCoreCommandRequest(
        this.coreCommandDirectory,
        command.id,
      );
      if (!request) {
        if (
          command.payload && typeof command.payload === "object"
          && (command.payload as { readonly privateRequest?: unknown }).privateRequest === true
        ) {
          throw new Error("Foundry transmission private request is missing or invalid.");
        }
        await this.deliverOutbound(command, parentRunId);
        return;
      }
      const executable = request.command ?? command;
      const claimed = await claimFoundryCoreCommandRequest(
        this.coreCommandDirectory,
        command.id,
      );
      if (!claimed) return;
      const delivery = new AbortController();
      const monitoring = new AbortController();
      const monitor = monitorFoundryCoreCommandRequest(
        this.coreCommandDirectory,
        request,
        delivery,
        monitoring.signal,
      );
      try {
        if (request.runId !== parentRunId) {
          throw new Error("Foundry transmission call does not belong to this run.");
        }
        if (
          executable.id !== command.id
          || executable.definitionId !== command.definitionId
          || executable.agentId !== command.agentId
          || executable.conversationId !== command.conversationId
          || executable.workspaceId !== command.workspaceId
          || executable.routeId !== command.routeId
          || executable.applicationId !== command.applicationId
          || executable.transmissionId !== command.transmissionId
        ) {
          throw new Error("Foundry transmission command metadata does not match its private request.");
        }
        if (Date.parse(request.expiresAt) <= Date.now()) {
          throw new Error("Foundry transmission call expired before delivery.");
        }
        const output = await this.deliverOutbound(
          executable,
          parentRunId,
          delivery.signal,
        );
        await settleFoundryCoreCommandRequest(
          this.coreCommandDirectory,
          command.id,
          { status: "success", output },
        );
      } catch (cause) {
        await settleFoundryCoreCommandRequest(
          this.coreCommandDirectory,
          command.id,
          {
            status: "error",
            error: cause instanceof Error ? cause.message : String(cause),
          },
        );
        throw cause;
      } finally {
        monitoring.abort();
        await monitor;
      }
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
    if (command.type === "schedule.pause") {
      await this.pauseScheduledActivation(command, parentRunId);
      return;
    }
    if (command.type === "schedule.resume") {
      await this.resumeScheduledActivation(command, parentRunId);
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
    this.validatePlaybooks(command.definitionId, updated.playbooks, (await this.effectiveAgent(updated)).installations);
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

  private async disarmActivation(
    activation: FoundryActivationRecord,
    reason: "paused" | "cancelled" | "superseded",
  ): Promise<void> {
    this.activationDispatches.delete(activation.id);
    const timer = this.activationTimers.get(activation.id);
    if (timer) {
      clearTimeout(timer);
      this.activationTimers.delete(activation.id);
    }
    // A one-shot's run is the activation's only work, so it stops with it.
    // A recurring schedule's run already in progress finishes.
    if (activation.timing.kind === "at" && activation.lastRunId) {
      await this.signalRunner.cancel(activation.lastRunId);
    }
    // Claimed but not yet handed to a run: it never fires now.
    const now = new Date().toISOString();
    for (const occurrence of await this.listScheduleOccurrences({ activationId: activation.id, status: "pending" })) {
      await this.putOccurrence({ ...occurrence, status: "cancelled", reason, updatedAt: now, settledAt: now });
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
      await this.disarmActivation(stale, "cancelled");
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
          await this.disarmActivation(existing, "cancelled");
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
      if (existing) await this.disarmActivation(existing, "superseded");
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
    await this.disarmActivation(existing, "superseded");
    // An update arms the schedule again from now, as a new one would be;
    // only a restart resumes from the stored cursor.
    const { nextOccurrenceAt: _cursor, scheduleRevision: _revision, ...unarmed } = existing;
    const updated: FoundryActivationRecord = {
      ...unarmed,
      ...command.patch,
      status: existing.status === "paused" ? "paused" : "pending",
      createdByRunId: parentRunId,
      lastRunId: undefined,
      updatedAt: new Date().toISOString(),
    };
    await Effect.runPromise(this.data.putActivation(updated));
    if (updated.status !== "paused") await this.materializeActivation(updated);
    this.observability.append({
      type: "scheduled-action.updated",
      category: "activation",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, activationId: updated.id },
    });
  }

  private async pauseScheduledActivation(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.pause" }>,
    parentRunId: string,
  ): Promise<void> {
    const existing = await Effect.runPromise(this.data.getActivation(command.activationId));
    if (!existing) throw new Error(`Scheduled activation "${command.activationId}" was not found.`);
    this.assertActivationOwnership(existing, command);
    if (existing.status === "completed" || existing.status === "cancelled") {
      throw new Error(`Scheduled activation "${command.activationId}" cannot be paused from status "${existing.status}".`);
    }
    if (existing.status !== "paused") {
      await this.disarmActivation(existing, "paused");
      await Effect.runPromise(this.data.putActivation({
        ...existing,
        status: "paused",
        updatedAt: new Date().toISOString(),
      }));
    }
    this.observability.append({
      type: "scheduled-action.paused",
      category: "activation",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, activationId: existing.id },
    });
  }

  private async resumeScheduledActivation(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.resume" }>,
    parentRunId: string,
  ): Promise<void> {
    const existing = await Effect.runPromise(this.data.getActivation(command.activationId));
    if (!existing) throw new Error(`Scheduled activation "${command.activationId}" was not found.`);
    this.assertActivationOwnership(existing, command);
    if (existing.status !== "paused") {
      throw new Error(`Scheduled activation "${command.activationId}" is not paused.`);
    }
    // Occurrences that fell inside the pause were deliberately not delivered:
    // resuming starts the schedule again from now.
    const { nextOccurrenceAt: _paused, scheduleRevision: _revision, ...unpaused } = existing;
    const resumed: FoundryActivationRecord = {
      ...unpaused,
      status: "pending",
      createdByRunId: parentRunId,
      lastRunId: undefined,
      updatedAt: new Date().toISOString(),
    };
    await Effect.runPromise(this.data.putActivation(resumed));
    await this.materializeActivation(resumed);
    this.observability.append({
      type: "scheduled-action.resumed",
      category: "activation",
      agent: command.definitionId,
      runId: parentRunId,
      data: { commandId: command.id, activationId: existing.id },
    });
  }

  private async cancelScheduledActivation(
    command: Extract<FoundryCoreCommand, { readonly type: "schedule.cancel" }>,
    parentRunId: string,
  ): Promise<void> {
    const existing = await Effect.runPromise(this.data.getActivation(command.activationId));
    if (!existing) throw new Error(`Scheduled activation "${command.activationId}" was not found.`);
    this.assertActivationOwnership(existing, command);
    await this.disarmActivation(existing, "cancelled");
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

  private reconstructActivations(): Promise<void> {
    return this.withActivationTransition(async () => {
      // Occurrences a previous process claimed and did not finish come first,
      // under the identity they were claimed with.
      await this.replayScheduleOccurrences();
      for (const activation of await Effect.runPromise(this.data.listActivations())) {
        if (activation.status === "paused" || activation.status === "completed" || activation.status === "cancelled") continue;
        await this.materializeActivation(activation);
      }
    });
  }

  /** List occurrences of schedules and sleeps: what came due, when it was meant for, and what became of it. */
  async listScheduleOccurrences(
    filter: FoundryScheduleOccurrenceFilter = {},
  ): Promise<ReadonlyArray<FoundryScheduleOccurrence>> {
    if (this.durableOccurrences()) return Effect.runPromise(this.data.listScheduleOccurrences!(filter));
    return [...this.memoryOccurrences.values()]
      .filter((item) => matchesOccurrenceFilter(item, filter))
      .sort(compareOccurrences)
      .map((item) => structuredClone(item));
  }

  private durableOccurrences(): boolean {
    return Boolean(this.data.claimScheduleOccurrence && this.data.putScheduleOccurrence
      && this.data.getScheduleOccurrence && this.data.listScheduleOccurrences);
  }

  private async claimOccurrence(occurrence: FoundryScheduleOccurrence): Promise<boolean> {
    if (this.durableOccurrences()) return Effect.runPromise(this.data.claimScheduleOccurrence!(occurrence));
    if (this.memoryOccurrences.has(occurrence.id)) return false;
    this.memoryOccurrences.set(occurrence.id, structuredClone(occurrence));
    return true;
  }

  private async putOccurrence(occurrence: FoundryScheduleOccurrence): Promise<void> {
    if (this.durableOccurrences()) return Effect.runPromise(this.data.putScheduleOccurrence!(occurrence));
    this.memoryOccurrences.set(occurrence.id, structuredClone(occurrence));
    for (const id of prunableOccurrences(this.memoryOccurrences.values(), occurrence.activationId)) this.memoryOccurrences.delete(id);
  }

  private async getOccurrence(id: string): Promise<FoundryScheduleOccurrence | null> {
    if (this.durableOccurrences()) return Effect.runPromise(this.data.getScheduleOccurrence!(id));
    const occurrence = this.memoryOccurrences.get(id);
    return occurrence ? structuredClone(occurrence) : null;
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
      if (storedAgent) await this.assertDurableActive(storedAgent);
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
      const now = new Date();
      // The same configuration resumes from its stored cursor, keeping the
      // stored revision so occurrence ids already derived from it hold; a new
      // or changed one starts from now. A one-shot that already fired has no
      // cursor and waits for its occurrence to settle.
      const stored = activation.scheduleRevision;
      const resumes = stored !== undefined && scheduleRevisionMatches(activation, stored);
      const revision = resumes ? stored : activationScheduleRevision(activation);
      const cursor = resumes
        ? activation.nextOccurrenceAt
        : firstScheduledTime(activation.timing, now).toISOString();
      const { nextOccurrenceAt: _previous, ...rest } = activation;
      const active: FoundryActivationRecord = {
        ...rest,
        status: "active",
        ...(activation.timing.kind === "at" && !resumes ? { lastRunId: undefined } : {}),
        scheduleRevision: revision,
        ...(cursor ? { nextOccurrenceAt: cursor } : {}),
        updatedAt: now.toISOString(),
      };
      if (!cursor) {
        await this.settleFiredOneShot(active);
        return;
      }
      await Effect.runPromise(this.data.putActivation(active));
      this.observability.append({
        type: "scheduled-action.created",
        category: "activation",
        agent: activation.definitionId,
        runId: activation.createdByRunId,
        data: { commandId: activation.id, recurring: activation.timing.kind !== "at", nextRunAt: cursor },
      });
      // Dispatch acquires the transition lock after materialization releases it, even when overdue.
      this.armActivation(active);
    } catch (cause) {
      this.materializedActivations.delete(activation.id);
      throw cause;
    }
  }

  /** A one-shot that fired before a restart: finish it if its occurrence has settled. */
  private async settleFiredOneShot(activation: FoundryActivationRecord): Promise<void> {
    const occurrences = (await this.listScheduleOccurrences({ activationId: activation.id }))
      .filter((item) => item.revision === activation.scheduleRevision);
    const latest = occurrences.at(-1);
    if (latest && !TERMINAL_OCCURRENCE_STATUSES.has(latest.status)) return;
    await Effect.runPromise(this.data.putActivation({
      ...activation,
      status: latest && latest.status !== "cancelled" && latest.status !== "skipped" ? "completed" : "cancelled",
    }));
  }

  /** Wait for the activation's cursor, then fire; repeat while it has one. */
  private armActivation(activation: FoundryActivationRecord): void {
    const id = activation.id;
    const revision = activation.scheduleRevision!;
    let dueAt = activation.nextOccurrenceAt;
    let failures = 0;
    const generation = {};
    this.activationDispatches.set(id, generation);
    const arm = (): void => {
      if (this.activationDispatches.get(id) !== generation || !dueAt || this.stopping || this.disposed) {
        if (this.activationDispatches.get(id) === generation) this.activationDispatches.delete(id);
        return;
      }
      const remaining = Date.parse(dueAt) - Date.now();
      if (remaining > 0) {
        this.activationTimers.set(id, setTimeout(arm, Math.min(remaining, 2_147_483_647)));
        return;
      }
      this.activationTimers.delete(id);
      void this.fireActivation(id, revision, generation).then((next) => {
        failures = 0;
        dueAt = next;
        arm();
      }, (cause) => {
        // The cursor has not moved past an occurrence it failed to store, so
        // trying again later keeps the obligation.
        failures++;
        this.observability.append({
          type: "activation.dispatch.error",
          category: "activation",
          agent: activation.definitionId,
          runId: activation.createdByRunId,
          data: { activationId: id, error: cause instanceof Error ? cause.message : String(cause) },
        });
        if (this.activationDispatches.get(id) !== generation) return;
        this.activationTimers.set(id, setTimeout(arm, Math.min(1_000 * 2 ** Math.min(failures - 1, 8), 300_000)));
      });
    };
    arm();
  }

  /**
   * Take the occurrence at the activation's cursor: store it, then move the
   * cursor past it, then hand it to a run. Returns the new cursor.
   */
  private fireActivation(id: string, revision: string, generation: object): Promise<string | undefined> {
    return this.withActivationTransition(async () => {
      // A timer may already be waiting for the lock when an update or pause disarms it.
      if (this.activationDispatches.get(id) !== generation || this.stopping || this.disposed) return undefined;
      const current = await Effect.runPromise(this.data.getActivation(id));
      if (!current || current.status !== "active" || current.scheduleRevision !== revision || !current.nextOccurrenceAt) {
        return undefined;
      }
      const scheduledFor = new Date(current.nextOccurrenceAt);
      const now = new Date();
      const plan = planScheduleOccurrence(current.timing, scheduledFor, now);
      const occurrence = this.newOccurrence(current, scheduledFor, plan, now);
      const fresh = await this.claimOccurrence(occurrence);
      const { nextOccurrenceAt: _fired, ...rest } = current;
      const advanced: FoundryActivationRecord = {
        ...rest,
        ...(plan.next ? { nextOccurrenceAt: plan.next.toISOString() } : {}),
        updatedAt: now.toISOString(),
      };
      await Effect.runPromise(this.data.putActivation(advanced));
      // Not fresh: a previous process claimed it and crashed before moving the
      // cursor. Deliver it unless it is already in hand or finished.
      const stored = fresh ? occurrence : await this.getOccurrence(occurrence.id);
      if (stored?.status === "pending" || (stored?.status === "accepted" && !fresh)) {
        await this.deliverOccurrence(stored, advanced);
      } else if (stored?.status === "skipped" && fresh) {
        this.observability.append({
          type: "scheduled-action.skipped",
          category: "activation",
          agent: current.definitionId,
          runId: current.createdByRunId,
          data: { activationId: id, occurrenceId: stored.id, scheduledFor: stored.scheduledFor, reason: stored.reason },
        });
      } else if (stored && TERMINAL_OCCURRENCE_STATUSES.has(stored.status) && !plan.next) {
        await this.settleFiredOneShot(advanced);
      }
      return plan.next?.toISOString();
    });
  }

  private newOccurrence(
    activation: FoundryActivationRecord,
    scheduledFor: Date,
    plan: ScheduleOccurrencePlan,
    now: Date,
  ): FoundryScheduleOccurrence {
    const at = scheduledFor.toISOString();
    const timestamp = now.toISOString();
    const id = scheduleOccurrenceId(activation.id, activation.scheduleRevision!, at);
    return {
      id,
      activationId: activation.id,
      revision: activation.scheduleRevision!,
      scheduledFor: at,
      definitionId: activation.definitionId,
      agentId: activation.agentId,
      conversationId: activation.conversationId,
      workspaceId: activation.workspaceId,
      request: {
        agentId: activation.agentId,
        conversationId: activation.conversationId,
        workspaceId: activation.workspaceId,
        message: activation.message,
        ...(activation.payload !== undefined ? { payload: activation.payload } : {}),
        source: { kind: "activation", id: activation.id, occurrenceId: id, scheduledFor: at },
      },
      status: plan.deliver ? "pending" : "skipped",
      ...(plan.deliver ? {} : { reason: "misfire", settledAt: timestamp }),
      attempts: 0,
      ...(plan.coalesced ? { coalesced: plan.coalesced } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * Hand an occurrence to its conversation. Runs under the activation lock,
   * so a pause or cancel never sees it half handed over.
   */
  private async deliverOccurrence(
    occurrence: FoundryScheduleOccurrence,
    activation: FoundryActivationRecord,
  ): Promise<void> {
    if (this.occurrencesInHand.has(occurrence.id)) return;
    this.occurrencesInHand.add(occurrence.id);
    try {
      // Grants and worker state are checked when it fires, not when it was scheduled.
      const agent = await Effect.runPromise(this.data.getAgent(occurrence.agentId));
      let inactive = !agent;
      if (agent?.durableSubagent) {
        try { await this.assertDurableActive(agent); } catch { inactive = true; }
      }
      if (inactive) {
        const now = new Date().toISOString();
        await this.putOccurrence({ ...occurrence, status: "cancelled", reason: "agent-inactive", updatedAt: now, settledAt: now });
        this.occurrencesInHand.delete(occurrence.id);
        return;
      }
      const runId = await this.enqueueCoreRequest(occurrence.definitionId, occurrence.request);
      this.occurrenceRuns.set(runId, occurrence.id);
      const latest = (await this.getOccurrence(occurrence.id)) ?? occurrence;
      const now = new Date().toISOString();
      await this.putOccurrence({
        ...latest,
        status: "accepted",
        runId,
        runIds: [...(latest.runIds ?? []), runId],
        attempts: latest.attempts + 1,
        acceptedAt: now,
        updatedAt: now,
      });
      const current = await Effect.runPromise(this.data.getActivation(activation.id));
      if (current && current.status !== "cancelled" && current.status !== "completed") {
        await Effect.runPromise(this.data.putActivation({ ...current, lastRunId: runId, updatedAt: now }));
      }
      this.observability.append({
        type: "core.command.accepted",
        category: "system",
        agent: occurrence.definitionId,
        runId: activation.createdByRunId,
        data: {
          commandId: activation.id, childRunId: runId, type: activation.kind,
          occurrenceId: occurrence.id, scheduledFor: occurrence.scheduledFor, attempt: latest.attempts + 1,
        },
      });
      // The run may have finished before it was recorded as handling this occurrence.
      const settled = this.recentlySettledRuns.get(runId);
      if (settled) await this.settleOccurrence(runId, settled, { locked: true });
    } catch (cause) {
      this.occurrencesInHand.delete(occurrence.id);
      throw cause;
    }
  }

  /** The run handling an occurrence settled. A run stopped by shutdown did not: the next start delivers it again. */
  private async settleOccurrence(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    options: { readonly locked?: boolean } = {},
  ): Promise<void> {
    const occurrenceId = this.occurrenceRuns.get(runId);
    if (!occurrenceId || this.stopping) return;
    const work = async (): Promise<void> => {
      const occurrence = await this.getOccurrence(occurrenceId);
      this.occurrenceRuns.delete(runId);
      if (!occurrence || occurrence.runId !== runId || TERMINAL_OCCURRENCE_STATUSES.has(occurrence.status)) return;
      const now = new Date().toISOString();
      await this.putOccurrence({
        ...occurrence,
        status,
        ...(status === "cancelled" ? { reason: "run-cancelled" } : {}),
        updatedAt: now,
        settledAt: now,
      });
      this.occurrencesInHand.delete(occurrenceId);
      const activation = await Effect.runPromise(this.data.getActivation(occurrence.activationId));
      if (
        activation?.timing.kind === "at" && activation.status === "active" &&
        activation.scheduleRevision === occurrence.revision && activation.lastRunId === runId
      ) {
        await Effect.runPromise(this.data.putActivation({
          ...activation,
          status: status === "cancelled" ? "cancelled" : "completed",
          updatedAt: now,
        }));
      }
    };
    await (options.locked ? work() : this.withActivationTransition(work));
  }

  /**
   * After a restart: hand over every occurrence a previous process claimed
   * and no run finished, unless its activation has since been paused,
   * cancelled or changed.
   */
  private async replayScheduleOccurrences(): Promise<void> {
    for (const occurrence of await this.listScheduleOccurrences({ status: ["pending", "accepted"] })) {
      if (this.occurrencesInHand.has(occurrence.id)) continue;
      if (occurrence.runId && await this.signalRunner.getRun(occurrence.runId)) continue;
      const activation = await Effect.runPromise(this.data.getActivation(occurrence.activationId));
      const reason = !activation || activation.status === "cancelled" || activation.status === "completed"
        ? "cancelled"
        : activation.status === "paused"
          ? "paused"
          // Compare with the configuration as stored now, not the revision field,
          // which is only rewritten when the activation is armed again.
          : !scheduleRevisionMatches(activation, occurrence.revision) ? "superseded" : undefined;
      if (reason) {
        const now = new Date().toISOString();
        await this.putOccurrence({ ...occurrence, status: "cancelled", reason, updatedAt: now, settledAt: now });
        continue;
      }
      try {
        await this.deliverOccurrence(occurrence, activation!);
      } catch (cause) {
        // Left pending: the next start, or the activation's own timer, tries again.
        this.observability.append({
          type: "activation.dispatch.error",
          category: "activation",
          agent: occurrence.definitionId,
          data: { activationId: occurrence.activationId, occurrenceId: occurrence.id, error: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    }
  }

  private async deliverOutbound(
    command: Extract<FoundryCoreCommand, { readonly type: "transmit" }>,
    parentRunId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.dispatchOutbound({
      routeId: command.routeId,
      agentId: command.agentId,
      runId: parentRunId,
      payload: command.payload,
      commandId: command.id,
      ...(command.applicationId ? { applicationId: command.applicationId } : {}),
      ...(command.transmissionId
        ? { transmissionId: command.transmissionId }
        : {}),
      ...(signal ? { signal } : {}),
    });
  }

  private async executionEnvelope(
    request: FoundryRequest,
    options: { readonly leased?: boolean; readonly eventTurn?: boolean } = {},
  ): Promise<unknown> {
    const agent = await Effect.runPromise(this.data.getAgent(request.agentId));
    const conversation = await Effect.runPromise(this.data.getConversation(request.conversationId));
    if (!agent || !conversation) throw new Error("Cannot schedule an unknown agent instance or conversation.");
    const effective = await this.effectiveAgent(agent);
    const owners: Record<string, Pick<AgentInstance, "id" | "definitionId" | "workspaceId">> = {};
    let ancestor = agent;
    while (ancestor.durableSubagent) {
      ancestor = (await Effect.runPromise(this.data.getAgent(ancestor.durableSubagent.parentAgentId)))!;
      owners[ancestor.definitionId] = { id: ancestor.id, definitionId: ancestor.definitionId, workspaceId: ancestor.workspaceId };
    }
    const activations = (await Effect.runPromise(this.data.listActivations(request.workspaceId)))
      .filter((activation) => activation.agentId === request.agentId);
    const delegations = await this.openDelegationsFrom(request.agentId, request.conversationId);
    const threads = await this.openThreadsFrom(conversation);
    return {
      [FOUNDRY_EXECUTION_MARKER]: true,
      request: { ...request, context: { ...request.context, durableMemoryOwners: owners } },
      eventTurn: options.eventTurn ?? false,
      agent: effective,
      conversation,
      activations,
      delegations,
      threads,
      events: options.leased && this.data.listEvents ? (await Effect.runPromise(this.data.listEvents()))
        .filter((record) => record.status === "pending" && record.target.agentId === agent.id && record.target.conversationId === conversation.id)
        .map((record) => ({ ...record.delivery, durable: { id: record.id, event: record.event, policy: record.policy } })) : [],
      ...(options.leased ? { conversationLease: true } : {}),
    };
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
