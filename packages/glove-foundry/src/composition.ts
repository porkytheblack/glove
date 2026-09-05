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
  defineSharedTool,
} from "./capabilities.js";
import type { GloveFoldArgs } from "glove-core";
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

/**
 * A colocated `*.tool.ts` may export the Glove tool body directly. Foundry
 * supplies the runtime tool name from the file route, so the authored module
 * never has to repeat its identity as a string.
 */
export type FoundryToolBody = Omit<GloveFoldArgs<any>, "name">;

export interface FoundryAgentComposition {
  readonly capabilities: FoundryCapabilityRegistry;
  readonly native: FoundryNativeRegistry;
}

export type FoundryCompositionSource =
  | FoundryAgentComponent
  | FoundryToolBody
  | FoundryAgentComposition
  | ReadonlyArray<FoundryCompositionSource>
  | (() => FoundryCompositionSource)
  | false
  | null
  | undefined;

const composedToolBodies = new WeakMap<object, FoundrySharedTool<any>>();

function isToolBody(value: unknown): value is FoundryToolBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return typeof body.description === "string" && typeof body.do === "function" &&
    (body.inputSchema !== undefined || body.jsonSchema !== undefined);
}

function toolFromBody(body: FoundryToolBody): FoundrySharedTool<any> {
  const existing = composedToolBodies.get(body as object);
  if (existing) return existing;

  let definition!: FoundrySharedTool<any>;
  const tool = { ...body } as GloveFoldArgs<any>;
  Object.defineProperty(tool, "name", {
    enumerable: true,
    get: () => definition.id.replaceAll("/", "__").replaceAll("-", "_"),
  });
  definition = defineSharedTool({
    description: body.description,
    tool,
  });
  composedToolBodies.set(body as object, definition);
  return definition;
}

/** @internal Resolve the wrapper created when composeAgent saw a bare tool module. */
export function composedToolDefinition(
  body: unknown,
): FoundrySharedTool<any> | undefined {
  if (!isToolBody(body)) return undefined;
  return composedToolBodies.get(body as object) ?? toolFromBody(body);
}

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
    } else if (isToolBody(source)) {
      addUnique(capabilities.tools, toolFromBody(source), "tool");
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
