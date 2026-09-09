import type { Layer } from "effect";
import type { StoreAdapter } from "glove-core";
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
