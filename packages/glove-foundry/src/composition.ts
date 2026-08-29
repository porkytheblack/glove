import {
  EMPTY_CAPABILITY_REGISTRY,
  FOUNDRY_AGENT_APPLICATION_BRAND,
  FOUNDRY_MCP_BRAND,
  FOUNDRY_MEMORY_BRAND,
  FOUNDRY_SHARED_TOOL_BRAND,
  type FoundryAgentApplication,
  type FoundryCapabilityRegistry,
  type FoundryMcp,
  type FoundryMemoryProfile,
  type FoundrySharedTool,
} from "./capabilities.js";
import {
  EMPTY_NATIVE_REGISTRY,
  FOUNDRY_LAYER_BRAND,
  FOUNDRY_SUBSCRIBER_BRAND,
  type FoundryLayer,
  type FoundryNativeRegistry,
  type FoundrySubscriber,
} from "./surfaces.js";
import { fileDefinitionKey, fileDefinitionLabel } from "./identity.js";

export type FoundryAgentComponent =
  | FoundrySharedTool<any>
  | FoundryAgentApplication
  | FoundryMcp
  | FoundryMemoryProfile
  | FoundryLayer<any>
  | FoundrySubscriber;

export interface FoundryAgentComposition {
  readonly capabilities: FoundryCapabilityRegistry;
  readonly native: FoundryNativeRegistry;
}

export type FoundryCompositionSource =
  | FoundryAgentComponent
  | FoundryAgentComposition
  | ReadonlyArray<FoundryCompositionSource>
  | (() => FoundryCompositionSource)
  | false
  | null
  | undefined;

function addUnique<T extends { readonly id: string }>(
  values: T[],
  value: T,
  kind: string,
): void {
  const key = fileDefinitionKey(value);
  if (values.some((candidate) => fileDefinitionKey(candidate) === key)) {
    throw new Error(`Duplicate agent-local ${kind} "${fileDefinitionLabel(value)}".`);
  }
  values.push(value);
}

/**
 * Compose colocated, headless agent parts into one immutable catalogue.
 * Functions are factories, not runtime installers: they return definitions and
 * never receive or mutate a Glove instance.
 */
export function composeAgent(
  ...sources: ReadonlyArray<FoundryCompositionSource>
): FoundryAgentComposition {
  const capabilities = {
    tools: [...EMPTY_CAPABILITY_REGISTRY.tools],
    applications: [...EMPTY_CAPABILITY_REGISTRY.applications],
    mcp: [...EMPTY_CAPABILITY_REGISTRY.mcp],
    memory: [...EMPTY_CAPABILITY_REGISTRY.memory],
  };
  const native = {
    layers: [...EMPTY_NATIVE_REGISTRY.layers],
    subscribers: [...EMPTY_NATIVE_REGISTRY.subscribers],
  };

  const visit = (source: FoundryCompositionSource): void => {
    if (!source) return;
    if (typeof source === "function") {
      visit(source());
      return;
    }
    if (Array.isArray(source)) {
      for (const child of source) visit(child);
      return;
    }
    if ("capabilities" in source && "native" in source) {
      visit([
        ...source.capabilities.tools,
        ...source.capabilities.applications,
        ...source.capabilities.mcp,
        ...source.capabilities.memory,
        ...source.native.layers,
        ...source.native.subscribers,
      ]);
      return;
    }
    const branded = source as FoundryAgentComponent &
      Record<PropertyKey, unknown>;
    if (branded[FOUNDRY_SHARED_TOOL_BRAND] === true) {
      addUnique(capabilities.tools, branded as FoundrySharedTool<any>, "tool");
    } else if (branded[FOUNDRY_AGENT_APPLICATION_BRAND] === true) {
      addUnique(
        capabilities.applications,
        branded as FoundryAgentApplication,
        "application",
      );
    } else if (branded[FOUNDRY_MCP_BRAND] === true) {
      addUnique(capabilities.mcp, branded as FoundryMcp, "MCP");
    } else if (branded[FOUNDRY_MEMORY_BRAND] === true) {
      addUnique(
        capabilities.memory,
        branded as FoundryMemoryProfile,
        "memory",
      );
    } else if (branded[FOUNDRY_LAYER_BRAND] === true) {
      addUnique(native.layers, branded as FoundryLayer<any>, "layer");
    } else if (branded[FOUNDRY_SUBSCRIBER_BRAND] === true) {
      addUnique(native.subscribers, branded as FoundrySubscriber, "subscriber");
    } else {
      throw new Error("composeAgent received an unrecognized Foundry definition.");
    }
  };

  for (const source of sources) visit(source);
  return Object.freeze({
    capabilities: Object.freeze({
      tools: Object.freeze(capabilities.tools),
      applications: Object.freeze(capabilities.applications),
      mcp: Object.freeze(capabilities.mcp),
      memory: Object.freeze(capabilities.memory),
    }),
    native: Object.freeze({
      layers: Object.freeze(native.layers),
      subscribers: Object.freeze(native.subscribers),
    }),
  });
}

export const EMPTY_AGENT_COMPOSITION = composeAgent();
