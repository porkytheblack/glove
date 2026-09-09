import type { Layer } from "effect";
import type { StoreAdapter } from "glove-core";
import type { StationNetworkAdapter, StationRole } from "station-network";
import type { ScheduleAdapter } from "station-schedules";
import type { SignalQueueAdapter } from "station-signal";
import type { AccountReference, AgentBinding, Route } from "./domain.js";
import type { FoundryDataAdapter } from "./primitives.js";
import type { AccountDirectory, EventStore, TopologyStore } from "./services.js";
import type { FoundryInstanceProvisioner } from "./subscription.js";

export const FOUNDRY_APPLICATION_BRAND = Symbol.for(
  "glove-foundry-application",
);

/**
 * Durable storage for one deployment's execution state.
 *
 * Foundry's execution engine stays private, but its *storage* is a deployment
 * decision. Left unset, runs and schedules live in the process that created
 * them: fine for development, and the reason a second process would own its
 * own runs and arm its own copy of every schedule.
 *
 * Supplying these changes both. Run ownership already carries a lease and a
 * fencing token, so a shared queue lets any process claim work and recover a
 * peer's abandoned attempts; a shared schedule store decides one winner per due
 * occurrence, so a schedule fires once however many processes are running.
 *
 * Ownership follows who constructed the value: Foundry closes only the adapters
 * it made itself. An adapter passed in here — and any pool it shares with the
 * data adapter — is closed by the application that built it.
 *
 * This belongs in the application file and nowhere else. Agent definitions stay
 * deployment-neutral, and nothing here reaches them.
 */
export interface FoundryExecutionAdapters {
  /** Durable run queue. Omit for an in-process queue. */
  readonly runs?: SignalQueueAdapter;
  /** Durable schedule store. Omit for an in-process store. */
  readonly schedules?: ScheduleAdapter;
  /**
   * Stable identity for this process, recorded on every run it claims.
   *
   * Two processes sharing a queue MUST NOT share this value. Foundry
   * generates a per-process id when it is unset, which is correct but
   * anonymous; a deployment that can name its replicas should, so an
   * abandoned run is traceable to the process that lost it.
   */
  readonly stationId?: string;
  /**
   * How long a claimed run stays owned before another process may recover it.
   * The holder renews while it works, so this bounds recovery after a crash,
   * not the length of a run.
   */
  readonly leaseDurationMs?: number;
  /**
   * What this process is for.
   *
   * `standalone` (the default) serves the API, reconciles schedules and
   * executes runs — one process doing everything, which is what development
   * and a single deployment want.
   *
   * Splitting the planes gives `headquarters` (serves the API and reconciles
   * schedules, claims nothing) and `station` (claims and executes, reconciles
   * nothing). Exactly one process should be Headquarters; stations scale
   * horizontally beneath it.
   *
   * The split is what makes schedule reconstruction safe at size: a station
   * never arms an activation, so adding stations does not multiply the work
   * done at boot.
   */
  readonly role?: StationRole;
  /** Fleet membership. Required for the roles to see each other across processes. */
  readonly network?: FoundryNetworkMembership;
  /**
   * Run the execution loop at all. Defaults to `false` for `headquarters` and
   * `true` otherwise. Setting it false on a station is how you drain one
   * permanently; for a rolling drain prefer `canClaim`.
   */
  readonly runRunners?: boolean;
  /**
   * Admission gate consulted before each claim attempt. Return false to stop
   * taking new work while letting in-flight runs finish — the shape a graceful
   * deploy wants.
   */
  readonly canClaim?: () => Promise<boolean>;
}

/**
 * Where this process announces itself and how peers find it.
 *
 * Foundry stores nothing here itself; the adapter owns membership, controller
 * leases and liveness. Without one, a non-standalone role runs blind: it will
 * behave correctly on its own but no peer can see it, so placement and
 * network-wide concurrency have nothing to coordinate through.
 */
export interface FoundryNetworkMembership {
  /** Logical fleet name. Processes only coordinate within one id. */
  readonly id?: string;
  /** Human-readable name for this process in fleet views. Defaults to its station id. */
  readonly name?: string;
  /** Durable membership storage. Omit and the fleet is invisible across processes. */
  readonly adapter?: StationNetworkAdapter;
  /**
   * Facts about this process that work can be routed by — region, hardware,
   * tenancy. A definition's placement requirements are matched against these.
   */
  readonly labels?: Record<string, string>;
  /** Address peers and dashboards can reach this process on. */
  readonly endpoint?: string;
  /** How often this process reports liveness and capacity. */
  readonly heartbeatIntervalMs?: number;
  /** How long its membership survives without a heartbeat. */
  readonly membershipLeaseMs?: number;
}

/** Process infrastructure only; agent files own runtime capabilities. */
export interface FoundryApplicationOptions {
  readonly name: string;
  readonly accounts?: ReadonlyArray<AccountReference>;
  readonly routes?: ReadonlyArray<Route>;
  readonly bindings?: ReadonlyArray<AgentBinding>;
  readonly data?: FoundryDataAdapter;
  /** Durable execution storage. Omit to keep everything in this process. */
  readonly execution?: FoundryExecutionAdapters;
  readonly conversationStore?: (scope: {
    readonly definitionId: string;
    readonly agentId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
  }) => Promise<StoreAdapter> | StoreAdapter;
  /** User-owned strategy for subscriptions using `provisioning.mode = "custom"`. */
  readonly provisioner?: FoundryInstanceProvisioner;
  readonly services?: Layer.Layer<
    AccountDirectory | TopologyStore | EventStore,
    unknown
  >;
}

export type FoundryApplication = Readonly<FoundryApplicationOptions> & {
  readonly [FOUNDRY_APPLICATION_BRAND]: true;
};

export function isFoundryApplication(
  value: unknown,
): value is FoundryApplication {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[FOUNDRY_APPLICATION_BRAND] === true,
  );
}

function assertUnique(
  label: string,
  values: ReadonlyArray<{ readonly id: string }>,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new Error(`Duplicate Foundry ${label} id "${value.id}".`);
    }
    seen.add(value.id);
  }
}

/** Define infrastructure. Agent composition is deliberately absent here. */
export function defineApplication(
  options: FoundryApplicationOptions,
): FoundryApplication {
  if (!options.name.trim()) throw new Error("Foundry application name is required.");
  const accounts = Object.freeze([...(options.accounts ?? [])]);
  const routes = Object.freeze([...(options.routes ?? [])]);
  const bindings = Object.freeze([...(options.bindings ?? [])]);
  assertUnique("account", accounts);
  assertUnique("route", routes);
  assertUnique("binding", bindings);
  return Object.freeze({
    ...options,
    accounts,
    routes,
    bindings,
    [FOUNDRY_APPLICATION_BRAND]: true as const,
  });
}

export const EMPTY_FOUNDRY_APPLICATION = defineApplication({
  name: "Glove Foundry",
});
