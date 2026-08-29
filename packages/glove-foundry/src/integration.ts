import { Effect, JSONSchema, Schema } from "effect";
import type {
  AccountReference,
  InboundRoute,
  OutboundRoute,
  RunGrant,
} from "./domain.js";
import type { AgentPlaybook } from "./playbook.js";
import { fileDefinitionKey, fileIdentified } from "./identity.js";

export const FOUNDRY_TRANSMISSION_BRAND = Symbol.for(
  "glove-foundry-transmission",
);
export const FOUNDRY_TRANSMISSION_PREDICATE_BRAND = Symbol.for(
  "glove-foundry-transmission-predicate",
);
export const FOUNDRY_TRANSMISSION_EVENT_BRAND = Symbol.for(
  "glove-foundry-transmission-event",
);

export type TransmissionEventDirection = "inbound" | "outbound";

export interface TransmissionEventOptions<
  TDirection extends TransmissionEventDirection = TransmissionEventDirection,
> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly direction: TDirection;
  readonly description?: string;
}

export type FoundryTransmissionEvent<
  TDirection extends TransmissionEventDirection = TransmissionEventDirection,
> = Readonly<TransmissionEventOptions<TDirection>> & {
  readonly id: string;
  readonly [FOUNDRY_TRANSMISSION_EVENT_BRAND]: true;
};

export interface TransmissionPredicateOptions<
  TEvent = unknown,
  TError = never,
  TRequirements = never,
> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description?: string;
  readonly match: (
    event: TEvent,
    parameters: Readonly<Record<string, unknown>>,
    context: IngressContext,
  ) => Effect.Effect<boolean, TError, TRequirements>;
}

export type FoundryTransmissionPredicate<
  TEvent = unknown,
  TError = never,
  TRequirements = never,
> = Readonly<TransmissionPredicateOptions<TEvent, TError, TRequirements>> & {
  readonly id: string;
  readonly [FOUNDRY_TRANSMISSION_PREDICATE_BRAND]: true;
};

export interface CapabilityDefinition {
  readonly id: string;
  readonly description: string;
  readonly account: "none" | "optional" | "required";
  readonly effect: "read" | "write";
}

export interface IngressContext {
  readonly route: InboundRoute;
  readonly account?: AccountReference;
}

export interface TransmissionSerializationContext extends IngressContext {
  readonly eventId: string;
  readonly eventName: string;
  readonly threadKey: string;
  readonly playbooks: ReadonlyArray<AgentPlaybook>;
}

export interface EgressContext {
  readonly route: OutboundRoute;
  readonly account?: AccountReference;
  readonly grant: RunGrant;
}

/** Provider ingress remains adapter-owned and returns typed Effects. */
export interface IngressAdapter<TEvent, TError = never, TRequirements = never> {
  readonly authenticate: (
    raw: unknown,
    context: IngressContext,
  ) => Effect.Effect<boolean, TError, TRequirements>;
  readonly normalize: (
    raw: unknown,
    context: IngressContext,
  ) => Effect.Effect<TEvent, TError, TRequirements>;
}

/** Provider delivery remains adapter-owned and revalidates its route per call. */
export interface EgressAdapter<
  TInput,
  TOutput,
  TError = never,
  TRequirements = never,
> {
  readonly deliver: (
    input: TInput,
    context: EgressContext,
  ) => Effect.Effect<TOutput, TError, TRequirements>;
}

export interface AccountContract<
  TMetadata extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> {
  readonly required: boolean;
  readonly metadata: TMetadata;
}

export interface InboundContract<
  TConfig extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  TEvent extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  TError = never,
  TRequirements = never,
> {
  readonly config: TConfig;
  readonly event: TEvent;
  readonly adapter?: IngressAdapter<
    Schema.Schema.Type<TEvent>,
    TError,
    TRequirements
  >;
  /** Resolve a predefined event after normalization. Omit to use provider event data at runtime. */
  readonly classify?: (
    event: Schema.Schema.Type<TEvent>,
    context: IngressContext,
  ) => Effect.Effect<FoundryTransmissionEvent<"inbound">, TError, TRequirements>;
  /** Executable definitions referenced directly by code-authored playbooks. */
  readonly predicates?: ReadonlyArray<FoundryTransmissionPredicate<
    Schema.Schema.Type<TEvent>,
    TError,
    TRequirements
  >>;
  /** Transmission-owned event rendering. Omit for Foundry's deterministic XML serializer. */
  readonly serialize?: (
    event: Schema.Schema.Type<TEvent>,
    context: TransmissionSerializationContext,
  ) => Effect.Effect<string, TError, TRequirements>;
}

export interface OutboundContract<
  TConfig extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  TInput extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  TOutput extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  TError = never,
  TRequirements = never,
> {
  readonly config: TConfig;
  readonly input: TInput;
  readonly output: TOutput;
  readonly adapter?: EgressAdapter<
    Schema.Schema.Type<TInput>,
    Schema.Schema.Type<TOutput>,
    TError,
    TRequirements
  >;
}

export interface TransmissionOptions {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly account?: AccountContract;
  readonly capabilities?: ReadonlyArray<CapabilityDefinition>;
  /** Events this transmission can receive or deliver. */
  readonly events?: ReadonlyArray<FoundryTransmissionEvent>;
  readonly inbound?: InboundContract;
  readonly outbound?: OutboundContract;
}

export type FoundryTransmission<TOptions extends TransmissionOptions> = Readonly<
  TOptions
> & {
  readonly id: string;
  readonly [FOUNDRY_TRANSMISSION_BRAND]: true;
};

export type AnyFoundryTransmission = FoundryTransmission<TransmissionOptions>;
export type InferAccountMetadata<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["account"] extends AccountContract<infer TSchema>
      ? Schema.Schema.Type<TSchema>
      : never
    : never;

export type InferInboundEvent<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["inbound"] extends InboundContract<
        Schema.Schema.AnyNoContext,
        infer TEvent
      >
      ? Schema.Schema.Type<TEvent>
      : never
    : never;

export type InferInboundConfig<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["inbound"] extends InboundContract<infer TConfig, Schema.Schema.AnyNoContext>
      ? Schema.Schema.Type<TConfig>
      : never
    : never;

export type InferOutboundConfig<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["outbound"] extends OutboundContract<infer TConfig, Schema.Schema.AnyNoContext, Schema.Schema.AnyNoContext>
      ? Schema.Schema.Type<TConfig>
      : never
    : never;

export type InferOutboundInput<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["outbound"] extends OutboundContract<
        Schema.Schema.AnyNoContext,
        infer TInput,
        Schema.Schema.AnyNoContext
      >
      ? Schema.Schema.Type<TInput>
      : never
    : never;

export type InferOutboundOutput<TTransmission> =
  TTransmission extends FoundryTransmission<infer TOptions>
    ? TOptions["outbound"] extends OutboundContract<
        Schema.Schema.AnyNoContext,
        Schema.Schema.AnyNoContext,
        infer TOutput
      >
      ? Schema.Schema.Type<TOutput>
      : never
    : never;

const TRANSMISSION_ID = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const CAPABILITY_ID = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;
const CREDENTIAL_FIELD_NAMES = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
  "password",
  "apikey",
  "credential",
  "credentials",
]);

function assertSchemaContainsNoCredentialFields(
  transmissionId: string,
  area: string,
  schema: Schema.Schema.AnyNoContext,
): void {
  const json = JSONSchema.make(schema) as unknown as Record<string, unknown>;
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    const object = value as Record<string, unknown>;
    const properties = object.properties;
    if (properties && typeof properties === "object") {
      for (const [name, child] of Object.entries(
        properties as Record<string, unknown>,
      )) {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (CREDENTIAL_FIELD_NAMES.has(normalized)) {
          throw new Error(
            `Foundry transmission "${transmissionId}" declares credential field "${path}.${name}" in ${area}. Store an opaque accessRef on the account instead.`,
          );
        }
        visit(child, `${path}.${name}`);
      }
    }
    for (const [name, child] of Object.entries(object)) {
      if (name !== "properties") visit(child, path);
    }
  };
  visit(json, area);
}

export function isFoundryTransmission(
  value: unknown,
): value is AnyFoundryTransmission {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[FOUNDRY_TRANSMISSION_BRAND] ===
        true,
  );
}

export function defineTransmissionPredicate<
  TEvent = unknown,
  TError = never,
  TRequirements = never,
>(
  options: TransmissionPredicateOptions<TEvent, TError, TRequirements>,
): FoundryTransmissionPredicate<TEvent, TError, TRequirements> {
  if (options.id && !TRANSMISSION_ID.test(options.id)) {
    throw new Error(`Invalid transmission predicate id "${options.id}".`);
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_TRANSMISSION_PREDICATE_BRAND]: true as const,
  }, "predicate", id));
}

export function defineTransmissionEvent<
  const TDirection extends TransmissionEventDirection,
>(
  options: TransmissionEventOptions<TDirection>,
): FoundryTransmissionEvent<TDirection> {
  if (options.id && !TRANSMISSION_ID.test(options.id)) {
    throw new Error(`Invalid transmission event id "${options.id}".`);
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_TRANSMISSION_EVENT_BRAND]: true as const,
  }, "event", id));
}

export function transmissionPredicate(
  transmission: AnyFoundryTransmission,
  id: string,
): FoundryTransmissionPredicate | undefined {
  return transmission.inbound?.predicates?.find((candidate) => candidate.id === id);
}

/** Define a provider-neutral transmission backed by Effect adapters. */
export function defineTransmission<const TOptions extends TransmissionOptions>(
  options: TOptions,
): FoundryTransmission<TOptions> {
  if (options.id && !TRANSMISSION_ID.test(options.id)) {
    throw new Error(
      `Invalid Foundry transmission id "${options.id}". Use lowercase letters, digits, and hyphens.`,
    );
  }
  const label = options.id ?? "<transmission file route>";
  const capabilities = options.capabilities ?? [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new Error(
        `Invalid capability id "${capability.id}" in transmission "${label}".`,
      );
    }
    if (seen.has(capability.id)) {
      throw new Error(
        `Duplicate capability "${capability.id}" in transmission "${label}".`,
      );
    }
    seen.add(capability.id);
  }
  const eventKeys = new Set<object | string>();
  for (const event of options.events ?? []) {
    const key = fileDefinitionKey(event);
    if (eventKeys.has(key)) {
      throw new Error(`Duplicate event in transmission "${label}".`);
    }
    eventKeys.add(key);
  }
  if (options.account) {
    assertSchemaContainsNoCredentialFields(
      label,
      "account.metadata",
      options.account.metadata,
    );
  }
  if (options.inbound) {
    assertSchemaContainsNoCredentialFields(
      label,
      "inbound.config",
      options.inbound.config,
    );
    const predicateIds = new Set<object | string>();
    for (const predicate of options.inbound.predicates ?? []) {
      const key = fileDefinitionKey(predicate);
      if (predicateIds.has(key)) {
        throw new Error(
          `Duplicate predicate in transmission "${label}".`,
        );
      }
      predicateIds.add(key);
    }
  }
  if (options.outbound) {
    assertSchemaContainsNoCredentialFields(
      label,
      "outbound.config",
      options.outbound.config,
    );
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    capabilities: Object.freeze([...capabilities]),
    events: Object.freeze([...(options.events ?? [])]),
    ...(options.inbound
      ? {
          inbound: Object.freeze({
            ...options.inbound,
            predicates: Object.freeze([...(options.inbound.predicates ?? [])]),
          }),
        }
      : {}),
    [FOUNDRY_TRANSMISSION_BRAND]: true as const,
  }, "transmission", id)) as FoundryTransmission<TOptions>;
}
