import { Context, Effect, Layer, Option, Ref } from "effect";
import type {
  AccountId,
  AccountNotFound,
  AccountReference,
  AccountSessionUnavailable,
  AgentBinding,
  AgentId,
  BindingId,
  BindingNotFound,
  EventId,
  EventNotFound,
  EventReference,
  TransmissionId,
  Route,
  RouteId,
  RouteNotFound,
  RunId,
  TopologyConflict,
} from "./domain.js";
import {
  AccountNotFound as AccountNotFoundError,
  BindingNotFound as BindingNotFoundError,
  EventNotFound as EventNotFoundError,
  RouteNotFound as RouteNotFoundError,
} from "./domain.js";

export interface AccountFilter {
  readonly transmissionId?: TransmissionId;
}

/**
 * Read-only account metadata supplied by the application. Deliberately no
 * create, authorize, refresh, revoke, token, or credential methods exist.
 */
export class AccountDirectory extends Context.Tag(
  "@glove-foundry/AccountDirectory",
)<
  AccountDirectory,
  {
    readonly get: (
      id: AccountId,
    ) => Effect.Effect<AccountReference, AccountNotFound>;
    readonly list: (
      filter?: AccountFilter,
    ) => Effect.Effect<ReadonlyArray<AccountReference>>;
  }
>() {}

export interface RouteFilter {
  readonly transmissionId?: TransmissionId;
  readonly accountId?: AccountId;
  readonly direction?: Route["direction"];
  readonly enabled?: boolean;
}

export interface BindingFilter {
  readonly agentId?: AgentId;
  readonly transmissionId?: TransmissionId;
  readonly accountId?: AccountId;
  readonly routeId?: RouteId;
  readonly enabled?: boolean;
}

/** Durable desired topology. It stores opaque account ids, never credentials. */
export class TopologyStore extends Context.Tag("@glove-foundry/TopologyStore")<
  TopologyStore,
  {
    readonly getRoute: (id: RouteId) => Effect.Effect<Route, RouteNotFound>;
    readonly listRoutes: (
      filter?: RouteFilter,
    ) => Effect.Effect<ReadonlyArray<Route>>;
    readonly putRoute: (
      route: Route,
    ) => Effect.Effect<Route, TopologyConflict>;
    readonly removeRoute: (id: RouteId) => Effect.Effect<void, RouteNotFound>;
    readonly getBinding: (
      id: BindingId,
    ) => Effect.Effect<AgentBinding, BindingNotFound>;
    readonly listBindings: (
      filter?: BindingFilter,
    ) => Effect.Effect<ReadonlyArray<AgentBinding>>;
    readonly putBinding: (
      binding: AgentBinding,
    ) => Effect.Effect<AgentBinding, TopologyConflict>;
    readonly removeBinding: (
      id: BindingId,
    ) => Effect.Effect<void, BindingNotFound>;
  }
>() {}

export class EventStore extends Context.Tag("@glove-foundry/EventStore")<
  EventStore,
  {
    readonly put: (
      reference: EventReference,
      payload: unknown,
    ) => Effect.Effect<void>;
    readonly getReference: (
      id: EventId,
    ) => Effect.Effect<EventReference, EventNotFound>;
    readonly getPayload: (id: EventId) => Effect.Effect<unknown, EventNotFound>;
  }
>() {}

export interface AccountSessionRequest {
  readonly account: AccountReference;
  readonly operation: string;
  readonly runId?: RunId;
}

/**
 * A user-owned adapter that produces an operation-scoped Effect Layer. Its
 * implementation owns credential lookup, refresh, SDK construction, and
 * cleanup. Foundry only provides the resulting service to the operation.
 */
export interface AccountSessionAdapter<TSession> {
  readonly layer: (
    request: AccountSessionRequest,
  ) => Layer.Layer<TSession, AccountSessionUnavailable>;
}

function routeMatches(route: Route, filter: RouteFilter): boolean {
  return (
    (filter.transmissionId === undefined ||
      route.transmissionId === filter.transmissionId) &&
    (filter.accountId === undefined || route.accountId === filter.accountId) &&
    (filter.direction === undefined || route.direction === filter.direction) &&
    (filter.enabled === undefined || route.enabled === filter.enabled)
  );
}

function bindingMatches(
  binding: AgentBinding,
  filter: BindingFilter,
): boolean {
  return (
    (filter.agentId === undefined || binding.agentId === filter.agentId) &&
    (filter.transmissionId === undefined ||
      binding.transmissionId === filter.transmissionId) &&
    (filter.accountId === undefined ||
      binding.accountId === filter.accountId) &&
    (filter.routeId === undefined || binding.routeId === filter.routeId) &&
    (filter.enabled === undefined || binding.enabled === filter.enabled)
  );
}

export function memoryAccountDirectory(
  accounts: ReadonlyArray<AccountReference>,
): Layer.Layer<AccountDirectory> {
  return Layer.succeed(AccountDirectory, {
    get: (id) => {
      const account = accounts.find((candidate) => candidate.id === id);
      return account
        ? Effect.succeed(account)
        : Effect.fail(new AccountNotFoundError({ accountId: id }));
    },
    list: (filter = {}) =>
      Effect.succeed(
        accounts.filter(
          (account) =>
            filter.transmissionId === undefined ||
            account.transmissionId === filter.transmissionId,
        ),
      ),
  });
}

export const memoryTopologyStore: Layer.Layer<TopologyStore> = Layer.effect(
  TopologyStore,
  Effect.gen(function* () {
    const routes = yield* Ref.make(new Map<RouteId, Route>());
    const bindings = yield* Ref.make(new Map<BindingId, AgentBinding>());

    return {
      getRoute: (id) =>
        Ref.get(routes).pipe(
          Effect.flatMap((state) =>
            Option.fromNullable(state.get(id)).pipe(
              Option.match({
                onNone: () => Effect.fail(new RouteNotFoundError({ routeId: id })),
                onSome: Effect.succeed,
              }),
            ),
          ),
        ),
      listRoutes: (filter = {}) =>
        Ref.get(routes).pipe(
          Effect.map((state) =>
            [...state.values()].filter((route) => routeMatches(route, filter)),
          ),
        ),
      putRoute: (route) =>
        Ref.update(routes, (state) => {
          const next = new Map(state);
          next.set(route.id, route);
          return next;
        }).pipe(Effect.as(route)),
      removeRoute: (id) =>
        Ref.modify(routes, (state) => {
          if (!state.has(id)) {
            return [false, state] as const;
          }
          const next = new Map(state);
          next.delete(id);
          return [true, next] as const;
        }).pipe(
          Effect.flatMap((removed) =>
            removed
              ? Effect.void
              : Effect.fail(new RouteNotFoundError({ routeId: id })),
          ),
        ),
      getBinding: (id) =>
        Ref.get(bindings).pipe(
          Effect.flatMap((state) =>
            Option.fromNullable(state.get(id)).pipe(
              Option.match({
                onNone: () =>
                  Effect.fail(new BindingNotFoundError({ bindingId: id })),
                onSome: Effect.succeed,
              }),
            ),
          ),
        ),
      listBindings: (filter = {}) =>
        Ref.get(bindings).pipe(
          Effect.map((state) =>
            [...state.values()].filter((binding) =>
              bindingMatches(binding, filter),
            ),
          ),
        ),
      putBinding: (binding) =>
        Ref.update(bindings, (state) => {
          const next = new Map(state);
          next.set(binding.id, binding);
          return next;
        }).pipe(Effect.as(binding)),
      removeBinding: (id) =>
        Ref.modify(bindings, (state) => {
          if (!state.has(id)) {
            return [false, state] as const;
          }
          const next = new Map(state);
          next.delete(id);
          return [true, next] as const;
        }).pipe(
          Effect.flatMap((removed) =>
            removed
              ? Effect.void
              : Effect.fail(new BindingNotFoundError({ bindingId: id })),
          ),
        ),
    };
  }),
);

export const memoryEventStore: Layer.Layer<EventStore> = Layer.effect(
  EventStore,
  Effect.gen(function* () {
    const references = yield* Ref.make(new Map<EventId, EventReference>());
    const payloads = yield* Ref.make(new Map<EventId, unknown>());
    return {
      put: (reference, payload) =>
        Ref.update(references, (state) => {
          const next = new Map(state);
          next.set(reference.id, reference);
          return next;
        }).pipe(
          Effect.andThen(
            Ref.update(payloads, (state) => {
              const next = new Map(state);
              next.set(reference.id, payload);
              return next;
            }),
          ),
        ),
      getReference: (id) =>
        Ref.get(references).pipe(
          Effect.flatMap((state) => {
            const reference = state.get(id);
            return reference
              ? Effect.succeed(reference)
              : Effect.fail(new EventNotFoundError({ eventId: id }));
          }),
        ),
      getPayload: (id) =>
        Ref.get(payloads).pipe(
          Effect.flatMap((state) =>
            state.has(id)
              ? Effect.succeed(state.get(id))
              : Effect.fail(new EventNotFoundError({ eventId: id })),
          ),
        ),
    };
  }),
);
