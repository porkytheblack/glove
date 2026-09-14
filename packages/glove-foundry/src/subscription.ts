import type { FoundryAgentDefinition } from "./definition.js";
import type { AgentInstallation } from "./capabilities.js";
import {
  reconstructPlaybook,
  type AgentPlaybook,
  type AgentPlaybookInput,
} from "./playbook.js";
import type { InboundRoute } from "./domain.js";
import type { CreateAgentInstanceOptions } from "./primitives.js";
import { Effect } from "effect";
import { fileIdentified } from "./identity.js";

export const FOUNDRY_PLAYBOOK_SUBSCRIPTION_BRAND = Symbol.for(
  "glove-foundry-playbook-subscription",
);

export type AgentProvisioningPolicy =
  | { readonly mode: "singleton"; readonly key?: string }
  | { readonly mode: "per-thread" }
  | { readonly mode: "per-event" }
  | { readonly mode: "existing"; readonly agentIds: ReadonlyArray<string> }
  | { readonly mode: "custom"; readonly adapter: string };

export interface PlaybookSubscriptionTarget {
  readonly definitionId: string;
  readonly provisioning: AgentProvisioningPolicy;
  readonly context: Readonly<Record<string, unknown>>;
  readonly installations: ReadonlyArray<AgentInstallation>;
}

export interface PlaybookSubscription {
  readonly id: string;
  readonly workspaceId: string;
  readonly enabled: boolean;
  readonly playbook: AgentPlaybook;
  readonly targets: ReadonlyArray<PlaybookSubscriptionTarget>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlaybookSubscriptionTargetInput {
  readonly agent: FoundryAgentDefinition;
  readonly provisioning?: AgentProvisioningPolicy;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly installations?: ReadonlyArray<AgentInstallation>;
}

export interface DefinePlaybookSubscriptionOptions {
  /** @deprecated File-routed subscriptions derive identity from their filename. */
  readonly id?: string;
  readonly workspaceId?: string;
  readonly enabled?: boolean;
  readonly playbook: AgentPlaybookInput | AgentPlaybook;
  readonly targets: ReadonlyArray<PlaybookSubscriptionTargetInput>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface CustomProvisioningContext {
  readonly subscription: PlaybookSubscription;
  readonly target: PlaybookSubscriptionTarget;
  readonly route: InboundRoute;
  readonly eventId: string;
  readonly eventName: string;
  readonly threadKey: string;
  readonly event: unknown;
}

export interface CustomProvisionedAgent extends CreateAgentInstanceOptions {
  /** Stable uniqueness key; the data adapter enforces it atomically. */
  readonly provisioningKey: string;
}

export interface FoundryInstanceProvisioner {
  readonly identifier: string;
  provision(
    adapter: string,
    context: CustomProvisioningContext,
  ): Effect.Effect<ReadonlyArray<CustomProvisionedAgent>, unknown, never>;
}

const ID = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

function freezeData<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeData(child);
  return Object.freeze(value);
}

export function definePlaybookSubscription(
  options: DefinePlaybookSubscriptionOptions,
): PlaybookSubscription {
  if (options.id && !ID.test(options.id)) {
    throw new Error(`Invalid playbook subscription id "${options.id}".`);
  }
  if (options.targets.length === 0) {
    throw new Error("A playbook subscription must target at least one agent.");
  }
  const now = new Date().toISOString();
  const targets = options.targets.map((target) => {
    const authored = {
      provisioning: target.provisioning ?? { mode: "singleton" as const },
      context: structuredClone(target.context ?? {}),
      installations: target.installations ?? [],
    } as PlaybookSubscriptionTarget & Record<string, unknown>;
    Object.defineProperty(authored, "definitionId", {
      enumerable: true,
      get: () => target.agent.id,
    });
    return Object.freeze(authored);
  });
  const authored = fileIdentified({
    workspaceId: options.workspaceId ?? "default",
    enabled: options.enabled ?? true,
    playbook: options.playbook,
    targets,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    [FOUNDRY_PLAYBOOK_SUBSCRIPTION_BRAND]: true as const,
  }, "subscription", options.id);
  return Object.freeze(authored) as PlaybookSubscription;
}

/** Rehydrate the value-only representation returned by a durable adapter. */
export function reconstructPlaybookSubscription(
  subscription: PlaybookSubscription,
): PlaybookSubscription {
  // Code-authored playbooks may still contain direct definition references
  // until reconstructPlaybook resolves them. Do not structuredClone those
  // Effect Schema/function-bearing objects first.
  const { playbook, ...data } = subscription;
  return freezeData({
    ...structuredClone(data),
    // A file-routed subscription owns exactly one playbook, so its route is
    // also the stable persisted playbook identity when the author supplied a
    // composed policy without a runtime id.
    playbook: reconstructPlaybook(
      playbook.id ? playbook : { ...playbook, id: subscription.id },
    ),
  });
}
