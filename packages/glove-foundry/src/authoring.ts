import { Schema } from "effect";
import type { FoundryAgentApplication } from "./capabilities.js";
import {
  AccountReference as AccountReferenceSchema,
  AgentBinding as AgentBindingSchema,
  InboundRoute as InboundRouteSchema,
  OutboundRoute as OutboundRouteSchema,
  type AccountReference,
  type AgentBinding,
  type InboundRoute,
  type OutboundRoute,
} from "./domain.js";
import type {
  AnyFoundryTransmission,
  CapabilityDefinition,
  InferAccountMetadata,
  InferInboundConfig,
  InferOutboundConfig,
} from "./integration.js";
import type { AgentInstance } from "./primitives.js";

const accountTransmissions = new WeakMap<object, AnyFoundryTransmission>();
const routeTransmissions = new WeakMap<object, AnyFoundryTransmission>();

export type DefineAccountOptions<
  TTransmission extends AnyFoundryTransmission = AnyFoundryTransmission,
> = Omit<AccountReference, "id" | "transmissionId" | "metadata"> & {
  readonly id: string;
  readonly transmission: TTransmission;
  readonly metadata: InferAccountMetadata<TTransmission>;
};

export function defineAccount<TTransmission extends AnyFoundryTransmission>(
  options: DefineAccountOptions<TTransmission>,
): AccountReference & { readonly metadata: InferAccountMetadata<TTransmission> } {
  const { transmission, ...data } = options;
  if (!transmission.account) {
    throw new Error("The referenced transmission has no account contract.");
  }
  const metadata = Schema.decodeUnknownSync(transmission.account.metadata)(data.metadata);
  const decoded = Schema.decodeUnknownSync(AccountReferenceSchema)({
    ...data,
    metadata,
    transmissionId: "pending",
  });
  const account = { ...decoded } as AccountReference & Record<string, unknown>;
  Object.defineProperty(account, "transmissionId", {
    enumerable: true,
    get: () => transmission.id,
  });
  accountTransmissions.set(account, transmission);
  return Object.freeze(account) as AccountReference & {
    readonly metadata: InferAccountMetadata<TTransmission>;
  };
}

interface RouteReferenceOptions<TTransmission extends AnyFoundryTransmission> {
  readonly transmission: TTransmission;
  readonly account?: AccountReference;
}

export type DefineInboundRouteOptions<
  TTransmission extends AnyFoundryTransmission = AnyFoundryTransmission,
> = Omit<
  InboundRoute,
  "id" | "direction" | "transmissionId" | "accountId" | "config"
> & RouteReferenceOptions<TTransmission> & {
  readonly id: string;
  readonly config: InferInboundConfig<TTransmission>;
};

export function defineInboundRoute<TTransmission extends AnyFoundryTransmission>(
  options: DefineInboundRouteOptions<TTransmission>,
): InboundRoute & { readonly config: InferInboundConfig<TTransmission> } {
  const { transmission, account, ...data } = options;
  if (!transmission.inbound) {
    throw new Error("The referenced transmission has no inbound contract.");
  }
  if (account && accountTransmissions.get(account) !== transmission) {
    throw new Error(`Account "${account.id}" belongs to another transmission.`);
  }
  const config = Schema.decodeUnknownSync(transmission.inbound.config)(data.config);
  const decoded = Schema.decodeUnknownSync(InboundRouteSchema)({
    ...data,
    config,
    direction: "inbound",
    transmissionId: "pending",
    ...(account ? { accountId: account.id } : {}),
  });
  const route = { ...decoded } as InboundRoute & Record<string, unknown>;
  Object.defineProperty(route, "transmissionId", {
    enumerable: true,
    get: () => transmission.id,
  });
  routeTransmissions.set(route, transmission);
  return Object.freeze(route) as InboundRoute & {
    readonly config: InferInboundConfig<TTransmission>;
  };
}

export type DefineOutboundRouteOptions<
  TTransmission extends AnyFoundryTransmission = AnyFoundryTransmission,
> = Omit<
  OutboundRoute,
  "id" | "direction" | "transmissionId" | "accountId" | "config"
> & RouteReferenceOptions<TTransmission> & {
  readonly id: string;
  readonly config: InferOutboundConfig<TTransmission>;
};

export function defineOutboundRoute<TTransmission extends AnyFoundryTransmission>(
  options: DefineOutboundRouteOptions<TTransmission>,
): OutboundRoute & { readonly config: InferOutboundConfig<TTransmission> } {
  const { transmission, account, ...data } = options;
  if (!transmission.outbound) {
    throw new Error("The referenced transmission has no outbound contract.");
  }
  if (account && accountTransmissions.get(account) !== transmission) {
    throw new Error(`Account "${account.id}" belongs to another transmission.`);
  }
  const config = Schema.decodeUnknownSync(transmission.outbound.config)(data.config);
  const decoded = Schema.decodeUnknownSync(OutboundRouteSchema)({
    ...data,
    config,
    direction: "outbound",
    transmissionId: "pending",
    ...(account ? { accountId: account.id } : {}),
  });
  const route = { ...decoded } as OutboundRoute & Record<string, unknown>;
  Object.defineProperty(route, "transmissionId", {
    enumerable: true,
    get: () => transmission.id,
  });
  routeTransmissions.set(route, transmission);
  return Object.freeze(route) as OutboundRoute & {
    readonly config: InferOutboundConfig<TTransmission>;
  };
}

export interface DefineBindingOptions extends Omit<
  AgentBinding,
  "id" | "agentId" | "transmissionId" | "accountId" | "routeId" | "capabilities" | "reply"
> {
  readonly id: string;
  readonly agent: AgentInstance;
  readonly application?: FoundryAgentApplication;
  readonly transmission: AnyFoundryTransmission;
  readonly account?: AccountReference;
  readonly route?: InboundRoute | OutboundRoute;
  readonly capabilities: ReadonlyArray<CapabilityDefinition>;
  readonly reply?:
    | { readonly mode: "none" | "origin" }
    | { readonly mode: "route"; readonly route: OutboundRoute };
}

export function defineBinding(options: DefineBindingOptions): AgentBinding {
  const {
    agent,
    application,
    transmission,
    account,
    route,
    capabilities,
    reply,
    ...data
  } = options;
  if (
    application &&
    !application.transmissions?.some(
      (candidate) => candidate === transmission,
    )
  ) {
    throw new Error(
      `Application "${application.id}" does not own transmission "${transmission.id}".`,
    );
  }
  if (route && routeTransmissions.get(route) !== transmission) {
    throw new Error(
      `Route "${route.id}" does not belong to the referenced transmission.`,
    );
  }
  if (account && accountTransmissions.get(account) !== transmission) {
    throw new Error(
      `Account "${account.id}" does not belong to the referenced transmission.`,
    );
  }
  const decoded = Schema.decodeUnknownSync(AgentBindingSchema)({
    ...data,
    agentId: agent.id,
    transmissionId: "pending",
    ...(account ? { accountId: account.id } : {}),
    ...(route ? { routeId: route.id } : {}),
    capabilities: capabilities.map((capability) => capability.id),
    ...(reply
      ? {
          reply: reply.mode === "route"
            ? { mode: "route", routeId: reply.route.id }
            : reply,
        }
      : {}),
  });
  const binding = { ...decoded } as AgentBinding & Record<string, unknown>;
  Object.defineProperty(binding, "transmissionId", {
    enumerable: true,
    get: () => transmission.id,
  });
  return Object.freeze(binding);
}
