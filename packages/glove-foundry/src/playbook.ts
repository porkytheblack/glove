/** A serializable instruction rendered into an inbound transmission turn. */
export interface PlaybookDirective {
  readonly action: string;
  readonly instruction: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface PlaybookActionOptions {
  /** @deprecated File-routed definitions derive identity from their filename. */
  readonly id?: string;
  readonly description?: string;
}

export type FoundryPlaybookAction = Readonly<PlaybookActionOptions> & {
  readonly id: string;
  readonly [FOUNDRY_PLAYBOOK_ACTION_BRAND]: true;
};

export interface PlaybookDirectiveInput extends Omit<PlaybookDirective, "action"> {
  readonly action: FoundryPlaybookAction;
}

/** Declarative match policy. Executable predicates live on the transmission definition. */
export interface PlaybookMatch {
  readonly event?: string;
  readonly routeIds?: ReadonlyArray<string>;
  readonly predicate?: {
    readonly name: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  };
}

export interface PlaybookOutboundDirective {
  readonly routeId: string;
  readonly applicationId?: string;
  readonly event?: string;
  readonly accountId?: string;
  readonly applicationAccountId?: string;
  readonly instruction?: string;
}

/**
 * Instance-owned, persistable transmission policy. Playbooks deliberately
 * contain no functions; transmission definitions own all executable logic.
 */
export interface AgentPlaybook {
  readonly id: string;
  readonly transmissionId: string;
  readonly enabled?: boolean;
  readonly match?: PlaybookMatch;
  readonly directives: ReadonlyArray<PlaybookDirective>;
  readonly applications?: ReadonlyArray<string>;
  readonly outbound?: ReadonlyArray<PlaybookOutboundDirective>;
  readonly serialization?: Readonly<Record<string, unknown>>;
  readonly origin?: "agent-definition" | "instance";
  readonly playbookName?: string;
  readonly definitionRevision?: string;
}

export interface PlaybookMatchInput extends Omit<PlaybookMatch, "event" | "routeIds" | "predicate"> {
  readonly event?: FoundryTransmissionEvent<"inbound">;
  readonly routes?: ReadonlyArray<InboundRoute>;
  readonly predicate?: {
    readonly definition: FoundryTransmissionPredicate<any, any, any>;
    readonly parameters?: Readonly<Record<string, unknown>>;
  };
}

export interface PlaybookOutboundInput extends Omit<
  PlaybookOutboundDirective,
  "routeId" | "applicationId" | "event" | "accountId" | "applicationAccountId"
> {
  readonly route: OutboundRoute;
  readonly application?: FoundryAgentApplication;
  readonly event?: FoundryTransmissionEvent<"outbound">;
  readonly account?: AccountReference;
  readonly applicationAccount?: AccountReference;
}

/** Internal authoring shape used while runtime composition is materialized. */
export interface AgentPlaybookInput extends Omit<
  AgentPlaybook,
  "id" | "transmissionId" | "match" | "directives" | "applications" | "outbound"
> {
  readonly id?: string;
  readonly transmission: AnyFoundryTransmission;
  readonly match?: PlaybookMatchInput;
  readonly directives: ReadonlyArray<PlaybookDirectiveInput>;
  readonly applications?: ReadonlyArray<FoundryAgentApplication>;
  readonly outbound?: ReadonlyArray<PlaybookOutboundInput>;
}

export interface ComposedAgentPlaybookInput extends Omit<AgentPlaybookInput, "id"> {
  readonly name: string;
}

export type ComposedAgentPlaybook = Readonly<ComposedAgentPlaybookInput> & {
  readonly [FOUNDRY_COMPOSED_PLAYBOOK_BRAND]: true;
};

const ID = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

function assertData(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === undefined) throw new Error(`Playbook ${path} cannot contain undefined.`);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Playbook ${path} must contain a finite number.`);
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error(`Playbook ${path} must be serializable data, not ${typeof value}.`);
  }
  if (!value || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Playbook ${path} must contain plain objects and arrays only.`);
  }
  if (seen.has(value)) throw new Error(`Playbook ${path} cannot contain circular data.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertData(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) assertData(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function cloneData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneData) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneData(item)]),
    ) as T;
  }
  return value;
}

function freezeData<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const item of Object.values(value as Record<string, unknown>)) freezeData(item);
  return Object.freeze(value);
}

function normalizePlaybook(
  playbook: AgentPlaybookInput | AgentPlaybook,
): Readonly<AgentPlaybook> {
  const authored = "transmission" in playbook;
  const id = playbook.id;
  if (!id) throw new Error("A persisted playbook must have an id.");
  const transmissionId = authored ? playbook.transmission.id : playbook.transmissionId;
  const normalized: AgentPlaybook = {
    id,
    transmissionId,
    ...(playbook.enabled !== undefined ? { enabled: playbook.enabled } : {}),
    ...(playbook.match
      ? {
          match: {
            ...(playbook.match.event
              ? { event: authored ? playbook.match.event.id : playbook.match.event }
              : {}),
            ...((authored ? playbook.match.routes?.length : playbook.match.routeIds?.length)
              ? {
                  routeIds: authored
                    ? playbook.match.routes?.map((route) => route.id)
                    : playbook.match.routeIds,
                }
              : {}),
            ...(playbook.match.predicate
              ? {
                  predicate: {
                    name: authored
                      ? playbook.match.predicate.definition.id
                      : playbook.match.predicate.name,
                    ...(playbook.match.predicate.parameters
                      ? { parameters: playbook.match.predicate.parameters }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    directives: authored
      ? playbook.directives.map((directive) => ({
          action: directive.action.id,
          instruction: directive.instruction,
          ...(directive.parameters ? { parameters: directive.parameters } : {}),
        }))
      : playbook.directives,
    ...(playbook.applications
      ? {
          applications: authored
            ? playbook.applications.map((application) => application.id)
            : playbook.applications,
        }
      : {}),
    ...(playbook.outbound
      ? {
          outbound: authored
            ? (playbook.outbound as ReadonlyArray<PlaybookOutboundInput>).map(
                (outbound) => ({
                  routeId: outbound.route.id,
                  ...(outbound.application
                    ? { applicationId: outbound.application.id }
                    : {}),
                  ...(outbound.event ? { event: outbound.event.id } : {}),
                  ...(outbound.account ? { accountId: outbound.account.id } : {}),
                  ...(outbound.applicationAccount
                    ? { applicationAccountId: outbound.applicationAccount.id }
                    : {}),
                  ...(outbound.instruction
                    ? { instruction: outbound.instruction }
                    : {}),
                }),
              )
            : (playbook.outbound as ReadonlyArray<PlaybookOutboundDirective>).map(
                (outbound) => ({ ...outbound }),
              ),
        }
      : {}),
    ...(playbook.serialization ? { serialization: playbook.serialization } : {}),
    ...("origin" in playbook && playbook.origin ? { origin: playbook.origin } : {}),
    ...("playbookName" in playbook && playbook.playbookName ? { playbookName: playbook.playbookName } : {}),
    ...("definitionRevision" in playbook && playbook.definitionRevision ? { definitionRevision: playbook.definitionRevision } : {}),
  };
  if (!ID.test(id)) throw new Error(`Invalid playbook id "${id}".`);
  if (!ID.test(transmissionId)) {
    throw new Error(`Invalid transmission id "${transmissionId}" in playbook "${playbook.id}".`);
  }
  if (normalized.directives.length === 0) {
    throw new Error(`Playbook "${playbook.id}" must define at least one action directive.`);
  }
  if (normalized.match?.predicate && !normalized.match.predicate.name) {
    throw new Error(`Playbook "${playbook.id}" predicate must reference a definition.`);
  }
  for (const outbound of normalized.outbound ?? []) {
    if (!outbound.routeId) throw new Error(`Playbook "${playbook.id}" outbound must reference a route.`);
  }
  assertData(normalized, normalized.id);
  return freezeData(cloneData(normalized));
}

/** Compose runtime policy from direct references to transmission primitives. */
export function composePlaybook(
  playbook: ComposedAgentPlaybookInput,
): ComposedAgentPlaybook {
  if (!playbook.name.trim()) throw new Error("A composed playbook name is required.");
  if (playbook.directives.length === 0) throw new Error("A playbook must define an action directive.");
  for (const directive of playbook.directives) {
    if (!directive.instruction) throw new Error("A playbook directive must have an instruction.");
    if (directive.parameters) assertData(directive.parameters, "directive.parameters");
  }
  const transmissionEvents = new Set(
    (playbook.transmission.events ?? []).map(fileDefinitionKey),
  );
  for (const event of [
    playbook.match?.event,
    ...(playbook.outbound ?? []).map((entry) => entry.event),
  ]) {
    if (event && !transmissionEvents.has(fileDefinitionKey(event))) {
      throw new Error("A playbook event must be declared by its transmission definition.");
    }
  }
  if (playbook.serialization) assertData(playbook.serialization, "serialization");
  return Object.freeze({
    ...playbook,
    directives: Object.freeze([...playbook.directives]),
    [FOUNDRY_COMPOSED_PLAYBOOK_BRAND]: true as const,
  });
}

/** @internal Convert a lazy composition to immutable instance data. */
export function materializeComposedPlaybook(
  playbook: ComposedAgentPlaybook,
  id: string,
  revision: string,
): AgentPlaybook {
  return normalizePlaybook({
    ...playbook,
    id,
    origin: "agent-definition",
    playbookName: playbook.name,
    definitionRevision: revision,
  } as unknown as AgentPlaybookInput & AgentPlaybook);
}

/** Rehydrate the JSON-safe data representation held by an instance adapter. */
export function reconstructPlaybook(
  playbook: AgentPlaybook,
): Readonly<AgentPlaybook> {
  return normalizePlaybook(playbook);
}
import type { FoundryAgentApplication } from "./capabilities.js";
import { createHash } from "node:crypto";
import type { AccountReference, InboundRoute, OutboundRoute } from "./domain.js";
import { fileDefinitionKey, fileIdentified } from "./identity.js";
import type {
  AnyFoundryTransmission,
  FoundryTransmissionEvent,
  FoundryTransmissionPredicate,
} from "./integration.js";

export const FOUNDRY_PLAYBOOK_ACTION_BRAND = Symbol.for("glove-foundry-playbook-action");
export const FOUNDRY_COMPOSED_PLAYBOOK_BRAND = Symbol.for("glove-foundry-composed-playbook");

export function agentPlaybookId(definitionId: string, agentId: string, name: string): string {
  return `playbook-${createHash("sha256")
    .update(`${definitionId}\0${agentId}\0${name}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function composedPlaybookRevision(playbook: ComposedAgentPlaybook): string {
  const materialized = materializeComposedPlaybook(playbook, "playbook-revision", "pending");
  const { id: _id, definitionRevision: _revision, ...data } = materialized;
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function definePlaybookAction(
  options: PlaybookActionOptions = {},
): FoundryPlaybookAction {
  if (options.id && !ID.test(options.id)) {
    throw new Error(`Invalid playbook action id "${options.id}".`);
  }
  const { id, ...definition } = options;
  return Object.freeze(fileIdentified({
    ...definition,
    [FOUNDRY_PLAYBOOK_ACTION_BRAND]: true as const,
  }, "action", id));
}
