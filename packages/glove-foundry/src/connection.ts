import { Effect } from "effect";
import type { AccountReference, InboundRoute } from "./domain.js";
import type { AnyFoundryTransmission } from "./integration.js";
import { fileDefinitionKey, fileIdentified } from "./identity.js";

export const FOUNDRY_CONNECTION_BRAND = Symbol.for(
  "glove-foundry-application-connection",
);

export interface ConnectionReceiveInput {
  readonly route: InboundRoute;
  readonly eventId: string;
  readonly threadKey: string;
  readonly raw: unknown;
}

export interface ApplicationConnectionContext {
  readonly applicationId: string;
  readonly connectionId: string;
  readonly definitionId: string;
  readonly workspaceId: string;
  readonly account?: AccountReference;
  readonly routes: ReadonlyArray<InboundRoute>;
  readonly signal: AbortSignal;
  readonly ready: () => Effect.Effect<void>;
  readonly receive: (input: ConnectionReceiveInput) => Effect.Effect<void, unknown, never>;
  readonly withAccountSession?: <A>(
    operation: string,
    use: (session: unknown) => Effect.Effect<A, unknown, never>,
  ) => Effect.Effect<A, unknown, never>;
}

export interface DefineConnectionOptions<
  TError = never,
  TRequirements = never,
> {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description: string;
  /** Every inbound transmission this provider connection may emit. */
  readonly transmissions: ReadonlyArray<AnyFoundryTransmission>;
  readonly connect: (
    context: ApplicationConnectionContext,
  ) => Effect.Effect<void, TError, TRequirements>;
}

export type FoundryApplicationConnection = Readonly<
  DefineConnectionOptions<any, any>
> & {
  readonly id: string;
  readonly [FOUNDRY_CONNECTION_BRAND]: true;
};

export type ApplicationConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export interface ApplicationConnectionState {
  readonly id: string;
  readonly applicationId: string;
  readonly connectionId: string;
  readonly definitionId: string;
  readonly workspaceId: string;
  readonly accountId?: string;
  readonly routeIds: ReadonlyArray<string>;
  readonly status: ApplicationConnectionStatus;
  readonly attempts: number;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
  readonly lastEventAt?: string;
  readonly error?: string;
}

const ID = /^[a-z][a-z0-9-]*$/;

export function defineConnection<TError = never, TRequirements = never>(
  options: DefineConnectionOptions<TError, TRequirements>,
): FoundryApplicationConnection {
  if (options.id && !ID.test(options.id)) {
    throw new Error(`Invalid application connection id "${options.id}".`);
  }
  if (options.transmissions.length === 0) {
    throw new Error(`Application connection "${options.id}" must receive at least one transmission.`);
  }
  const seen = new Set<object | string>();
  for (const transmission of options.transmissions) {
    if (!transmission.inbound) {
      throw new Error(
        `Application connection "${options.id ?? "<file route>"}" references an outbound-only transmission.`,
      );
    }
    const key = fileDefinitionKey(transmission);
    if (seen.has(key)) {
      throw new Error(
        `Application connection "${options.id ?? "<file route>"}" repeats a transmission.`,
      );
    }
    seen.add(key);
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    transmissions: Object.freeze([...options.transmissions]),
    [FOUNDRY_CONNECTION_BRAND]: true as const,
  }, "connection", id));
}
