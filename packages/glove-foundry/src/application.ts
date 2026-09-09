import type { Effect, Layer } from "effect";
import type { StoreAdapter } from "glove-core";
import type { AccountReference, AgentBinding, Route } from "./domain.js";
import type { FoundryDataAdapter } from "./primitives.js";
import type { AccountDirectory, EventStore, TopologyStore } from "./services.js";
import type { FoundryInstanceProvisioner } from "./subscription.js";

export const FOUNDRY_APPLICATION_BRAND = Symbol.for(
  "glove-foundry-application",
);

/**
 * Secret-bearing HTTP request data passed only to the consumer-owned
 * authorization adapter. Foundry does not persist or observe this value.
 */
export interface FoundryRequestAuthorizationInput {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly remoteAddress?: string;
}

/**
 * Gate the Foundry HTTP surface without making credential acquisition or
 * refresh a framework concern. The adapter may validate a basic/bearer
 * credential, a session cookie, or an identity asserted by a trusted proxy.
 */
export interface FoundryRequestAuthorizationAdapter<
  TError = never,
> {
  readonly identifier: string;
  /** Value for WWW-Authenticate when access is denied. */
  readonly challenge?: string;
  readonly authorize: (
    input: FoundryRequestAuthorizationInput,
  ) => Effect.Effect<boolean, TError, never>;
}

/** Process infrastructure only; agent files own runtime capabilities. */
export interface FoundryApplicationOptions {
  readonly name: string;
  readonly accounts?: ReadonlyArray<AccountReference>;
  readonly routes?: ReadonlyArray<Route>;
  readonly bindings?: ReadonlyArray<AgentBinding>;
  readonly data?: FoundryDataAdapter;
  readonly conversationStore?: (scope: {
    readonly definitionId: string;
    readonly agentId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
  }) => Promise<StoreAdapter> | StoreAdapter;
  /**
   * User-owned HTTP authorization boundary. Required for non-loopback binds;
   * credential values never enter Foundry data, manifests, or observability.
   */
  readonly requestAuthorization?: FoundryRequestAuthorizationAdapter<unknown>;
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
