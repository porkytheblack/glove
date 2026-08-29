import { Schema } from "effect";

const Slug = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/),
  Schema.annotations({
    description: "A lowercase, hyphen-delimited Foundry identifier",
  }),
);

const RoutePath = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/),
  Schema.annotations({ description: "A file-routed Foundry agent identifier" }),
);

export const TransmissionId = Slug.pipe(Schema.brand("FoundryTransmissionId"));
export type TransmissionId = typeof TransmissionId.Type;
export const AgentDefinitionId = RoutePath.pipe(
  Schema.brand("FoundryAgentDefinitionId"),
);
export type AgentDefinitionId = typeof AgentDefinitionId.Type;

/** Runtime instance id. It is intentionally distinct from a file-routed definition id. */
export const AgentId = Schema.NonEmptyTrimmedString.pipe(Schema.brand("FoundryAgentId"));
export type AgentId = typeof AgentId.Type;

export const AccountId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("FoundryAccountId"),
);
export type AccountId = typeof AccountId.Type;

export const RouteId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("FoundryRouteId"),
);
export type RouteId = typeof RouteId.Type;

export const BindingId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("FoundryBindingId"),
);
export type BindingId = typeof BindingId.Type;

export const EventId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("FoundryEventId"),
);
export type EventId = typeof EventId.Type;

export const RunId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("FoundryRunId"),
);
export type RunId = typeof RunId.Type;

export const CapabilityId = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/),
  Schema.brand("FoundryCapabilityId"),
);
export type CapabilityId = typeof CapabilityId.Type;

export const StringRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

/**
 * Public metadata for an external identity. `accessRef` is an opaque pointer
 * owned by the application's account-session adapter. Foundry never resolves
 * it into credential material itself and never serializes it into manifests.
 */
export const AccountReference = Schema.Struct({
  id: AccountId,
  transmissionId: TransmissionId,
  externalAccountId: Schema.NonEmptyTrimmedString,
  label: Schema.optional(Schema.NonEmptyTrimmedString),
  accessRef: Schema.NonEmptyTrimmedString,
  metadata: StringRecord,
});
export type AccountReference = typeof AccountReference.Type;

/** Account metadata safe to expose over Foundry's operator API. */
export const AccountSummary = Schema.Struct({
  id: AccountId,
  transmissionId: TransmissionId,
  externalAccountId: Schema.NonEmptyTrimmedString,
  label: Schema.optional(Schema.NonEmptyTrimmedString),
  metadata: StringRecord,
});
export type AccountSummary = typeof AccountSummary.Type;

const RouteFields = {
  id: RouteId,
  transmissionId: TransmissionId,
  accountId: Schema.optional(AccountId),
  visibility: Schema.Literal("private", "workspace"),
  enabled: Schema.Boolean,
  config: StringRecord,
} as const;

export const InboundRoute = Schema.Struct({
  ...RouteFields,
  direction: Schema.Literal("inbound"),
});
export type InboundRoute = typeof InboundRoute.Type;

export const OutboundRoute = Schema.Struct({
  ...RouteFields,
  direction: Schema.Literal("outbound"),
});
export type OutboundRoute = typeof OutboundRoute.Type;

export const Route = Schema.Union(InboundRoute, OutboundRoute);
export type Route = typeof Route.Type;

export const ReplyPolicy = Schema.Union(
  Schema.Struct({ mode: Schema.Literal("none") }),
  Schema.Struct({ mode: Schema.Literal("origin") }),
  Schema.Struct({ mode: Schema.Literal("route"), routeId: RouteId }),
);
export type ReplyPolicy = typeof ReplyPolicy.Type;

export const AgentBinding = Schema.Struct({
  id: BindingId,
  agentId: AgentId,
  transmissionId: TransmissionId,
  accountId: Schema.optional(AccountId),
  routeId: Schema.optional(RouteId),
  capabilities: Schema.Array(CapabilityId),
  reply: Schema.optional(ReplyPolicy),
  enabled: Schema.Boolean,
});
export type AgentBinding = typeof AgentBinding.Type;

/** Authority calculated for one run. Grants are data, not prompt text. */
export const RunGrant = Schema.Struct({
  runId: RunId,
  agentId: AgentId,
  accountIds: Schema.Array(AccountId),
  outboundRouteIds: Schema.Array(RouteId),
  capabilities: Schema.Array(CapabilityId),
  reply: ReplyPolicy,
});
export type RunGrant = typeof RunGrant.Type;

/** A concise pointer to an event whose full payload can live out-of-band. */
export const EventReference = Schema.Struct({
  id: EventId,
  transmissionId: TransmissionId,
  routeId: RouteId,
  accountId: Schema.optional(AccountId),
  externalEventId: Schema.NonEmptyTrimmedString,
  threadKey: Schema.NonEmptyTrimmedString,
  emittedAt: Schema.NonEmptyTrimmedString,
  payloadRef: Schema.NonEmptyTrimmedString,
});
export type EventReference = typeof EventReference.Type;

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>(
  "AccountNotFound",
)("AccountNotFound", { accountId: AccountId }) {
  override get message(): string {
    return `Foundry account "${this.accountId}" was not found.`;
  }
}

export class RouteNotFound extends Schema.TaggedError<RouteNotFound>(
  "RouteNotFound",
)("RouteNotFound", { routeId: RouteId }) {
  override get message(): string {
    return `Foundry route "${this.routeId}" was not found.`;
  }
}

export class BindingNotFound extends Schema.TaggedError<BindingNotFound>(
  "BindingNotFound",
)("BindingNotFound", { bindingId: BindingId }) {
  override get message(): string {
    return `Foundry binding "${this.bindingId}" was not found.`;
  }
}

export class EventNotFound extends Schema.TaggedError<EventNotFound>(
  "EventNotFound",
)("EventNotFound", { eventId: EventId }) {
  override get message(): string {
    return `Foundry event "${this.eventId}" was not found.`;
  }
}

export class TopologyConflict extends Schema.TaggedError<TopologyConflict>(
  "TopologyConflict",
)("TopologyConflict", {
  resource: Schema.Literal("route", "binding"),
  id: Schema.NonEmptyTrimmedString,
  reason: Schema.NonEmptyTrimmedString,
}) {}

export class AccountSessionUnavailable extends Schema.TaggedError<AccountSessionUnavailable>(
  "AccountSessionUnavailable",
)("AccountSessionUnavailable", {
  accountId: AccountId,
  operation: Schema.NonEmptyTrimmedString,
  reason: Schema.NonEmptyTrimmedString,
}) {
  override get message(): string {
    return `Account session for "${this.accountId}" is unavailable during ${this.operation}: ${this.reason}`;
  }
}

export class GrantResolutionError extends Schema.TaggedError<GrantResolutionError>(
  "GrantResolutionError",
)("GrantResolutionError", {
  runId: RunId,
  agentId: AgentId,
  reason: Schema.NonEmptyTrimmedString,
}) {}

export type FoundryDomainError =
  | AccountNotFound
  | RouteNotFound
  | BindingNotFound
  | EventNotFound
  | TopologyConflict
  | AccountSessionUnavailable
  | GrantResolutionError;
