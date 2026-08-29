import { readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { FoundryApplication } from "./application.js";
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
import {
  EMPTY_NATIVE_REGISTRY,
  FOUNDRY_LAYER_BRAND,
  FOUNDRY_SUBSCRIBER_BRAND,
  type FoundryLayer,
  type FoundryNativeRegistry,
  type FoundrySubscriber,
} from "./surfaces.js";
import { bindFileIdentity } from "./identity.js";

const MODULE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);

export interface FoundryRegistryDirectories {
  readonly tools: string;
  readonly applications: string;
  readonly mcp: string;
  readonly memory: string;
  readonly layers: string;
  readonly subscribers: string;
}

export const DEFAULT_REGISTRY_DIRECTORIES: FoundryRegistryDirectories =
  Object.freeze({
    tools: "tools",
    applications: "applications",
    mcp: "mcp",
    memory: "memory",
    layers: "layers",
    subscribers: "subscribers",
  });

export interface DiscoveredCapability {
  readonly kind: "tool" | "application" | "mcp" | "memory";
  readonly id: string;
  readonly filePath: string;
  readonly relativePath: string;
}

export interface DiscoveredFoundryRegistry {
  readonly capabilities: FoundryCapabilityRegistry;
  readonly native: FoundryNativeRegistry;
  readonly files: ReadonlyArray<DiscoveredCapability>;
  readonly nativeFiles: ReadonlyArray<{
    readonly kind: "layer" | "subscriber";
    readonly id: string;
    readonly filePath: string;
    readonly relativePath: string;
  }>;
}

type CapabilityKind = DiscoveredCapability["kind"];

interface KindConfig {
  readonly kind: CapabilityKind;
  readonly directory: keyof FoundryRegistryDirectories;
  readonly suffix: string;
  readonly brand: symbol;
}

const KINDS: ReadonlyArray<KindConfig> = [
  {
    kind: "tool",
    directory: "tools",
    suffix: ".tool",
    brand: FOUNDRY_SHARED_TOOL_BRAND,
  },
  {
    kind: "application",
    directory: "applications",
    suffix: ".application",
    brand: FOUNDRY_AGENT_APPLICATION_BRAND,
  },
  { kind: "mcp", directory: "mcp", suffix: ".mcp", brand: FOUNDRY_MCP_BRAND },
  {
    kind: "memory",
    directory: "memory",
    suffix: ".memory",
    brand: FOUNDRY_MEMORY_BRAND,
  },
];

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

async function moduleFiles(directory: string, suffix: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory, { recursive: true });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw cause;
  }
  return entries
    .filter((entry) => {
      if (entry.endsWith(".d.ts")) return false;
      const extension = extname(entry);
      return (
        MODULE_EXTENSIONS.has(extension) &&
        entry.slice(0, -extension.length).endsWith(suffix)
      );
    })
    .map((entry) => resolve(directory, entry))
    .sort();
}

function routeFromModule(
  directory: string,
  filePath: string,
  suffix: string,
): string {
  const rel = normalizePath(relative(directory, filePath));
  const extension = extname(rel);
  return rel.slice(0, -extension.length - suffix.length);
}

async function importDefault(filePath: string, cacheBust: boolean): Promise<unknown> {
  const url = pathToFileURL(filePath);
  if (cacheBust) url.searchParams.set("t", String(Date.now()));
  const imported = (await import(url.href)) as { default?: unknown };
  return imported.default;
}

async function importModule(filePath: string, cacheBust: boolean): Promise<Record<string, unknown>> {
  const url = pathToFileURL(filePath);
  if (cacheBust) url.searchParams.set("t", String(Date.now()));
  return (await import(url.href)) as Record<string, unknown>;
}

function isToolBody(value: unknown): value is {
  readonly description: string;
  readonly do: (...args: any[]) => unknown;
  readonly inputSchema?: unknown;
  readonly jsonSchema?: unknown;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return typeof body.description === "string" && typeof body.do === "function" &&
    (body.inputSchema !== undefined || body.jsonSchema !== undefined);
}

function assembleToolModule(route: string, module: Record<string, unknown>): FoundrySharedTool<any> {
  const branded = module.default;
  if (branded && typeof branded === "object" &&
      (branded as Record<PropertyKey, unknown>)[FOUNDRY_SHARED_TOOL_BRAND] === true) {
    return branded as FoundrySharedTool<any>;
  }
  const body = isToolBody(module.default)
    ? module.default
    : isToolBody(module.tool)
      ? module.tool
      : isToolBody(module)
        ? module
        : null;
  if (!body) {
    throw new Error(`Tool route "${route}" must export a Glove tool body as default, as \`tool\`, or as named description/inputSchema/do constants.`);
  }
  const name = route.replaceAll("/", "__").replaceAll("-", "_");
  return defineSharedTool({
    id: route,
    description: typeof module.summary === "string" ? module.summary : body.description,
    tool: { ...body, name } as any,
  });
}

function addUnique<T extends { readonly id: string }>(
  target: T[],
  values: ReadonlyArray<T>,
  label: string,
): void {
  const ids = new Set(target.map((value) => value.id));
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new Error(`Duplicate Foundry ${label} id "${value.id}".`);
    }
    ids.add(value.id);
    target.push(value);
  }
}

export async function discoverFoundryRegistry(options: {
  readonly rootDir: string;
  readonly directories?: Partial<FoundryRegistryDirectories>;
  readonly application?: FoundryApplication;
  readonly strictFileRoutes?: boolean;
  readonly cacheBust?: boolean;
  /** @deprecated Runtime capabilities are agent-local. Kept for explicit tooling only. */
  readonly capabilities?: boolean;
  /** @deprecated Runtime surfaces are agent-local. Kept for explicit tooling only. */
  readonly native?: boolean;
}): Promise<DiscoveredFoundryRegistry> {
  const directories = {
    ...DEFAULT_REGISTRY_DIRECTORIES,
    ...options.directories,
  };
  const registry = {
    tools: [...EMPTY_CAPABILITY_REGISTRY.tools],
    applications: [...EMPTY_CAPABILITY_REGISTRY.applications],
    mcp: [...EMPTY_CAPABILITY_REGISTRY.mcp],
    memory: [...EMPTY_CAPABILITY_REGISTRY.memory],
  };
  const files: DiscoveredCapability[] = [];
  const native = {
    layers: [...EMPTY_NATIVE_REGISTRY.layers],
    subscribers: [...EMPTY_NATIVE_REGISTRY.subscribers],
  };
  const nativeFiles: Array<{
    kind: "layer" | "subscriber";
    id: string;
    filePath: string;
    relativePath: string;
  }> = [];

  for (const config of options.capabilities === false ? [] : KINDS) {
    const directory = resolve(options.rootDir, directories[config.directory]);
    for (const filePath of await moduleFiles(directory, config.suffix)) {
      const route = routeFromModule(directory, filePath, config.suffix);
      const imported = await importModule(filePath, options.cacheBust ?? false);
      const value = config.kind === "tool"
        ? assembleToolModule(route, imported)
        : imported.default;
      if (
        !value ||
        typeof value !== "object" ||
        (value as Record<PropertyKey, unknown>)[config.brand] !== true
      ) {
        throw new Error(
          `${normalizePath(relative(options.rootDir, filePath))} must default-export a Foundry ${config.kind} definition.`,
        );
      }
      const definition = value as { readonly id: string };
      bindFileIdentity(value as object, route, config.kind);
      if ((options.strictFileRoutes ?? true) && definition.id !== route) {
        throw new Error(
          `Foundry ${config.kind} route mismatch in ${filePath}: file resolves to "${route}" but declares "${definition.id}".`,
        );
      }
      if (config.kind === "tool") {
        addUnique(registry.tools, [value as FoundrySharedTool<any>], "shared tool");
      } else if (config.kind === "application") {
        addUnique(
          registry.applications,
          [value as FoundryAgentApplication],
          "agent application",
        );
      } else if (config.kind === "mcp") {
        addUnique(registry.mcp, [value as FoundryMcp], "MCP");
      } else if (config.kind === "memory") {
        addUnique(
          registry.memory,
          [value as FoundryMemoryProfile],
          "memory profile",
        );
      }
      files.push({
        kind: config.kind,
        id: definition.id,
        filePath,
        relativePath: normalizePath(relative(options.rootDir, filePath)),
      });
    }
  }

  for (const config of options.native === false ? [] : [
    {
      kind: "layer" as const,
      directory: "layers" as const,
      suffix: ".layer",
      brand: FOUNDRY_LAYER_BRAND,
    },
    {
      kind: "subscriber" as const,
      directory: "subscribers" as const,
      suffix: ".subscriber",
      brand: FOUNDRY_SUBSCRIBER_BRAND,
    },
  ]) {
    const directory = resolve(options.rootDir, directories[config.directory]);
    for (const filePath of await moduleFiles(directory, config.suffix)) {
      const route = routeFromModule(directory, filePath, config.suffix);
      const value = await importDefault(filePath, options.cacheBust ?? false);
      if (
        !value ||
        typeof value !== "object" ||
        (value as Record<PropertyKey, unknown>)[config.brand] !== true
      ) {
        throw new Error(
          `${normalizePath(relative(options.rootDir, filePath))} must default-export a Foundry ${config.kind} definition.`,
        );
      }
      const definition = value as { readonly id: string };
      bindFileIdentity(value as object, route, config.kind);
      if ((options.strictFileRoutes ?? true) && definition.id !== route) {
        throw new Error(
          `Foundry ${config.kind} route mismatch in ${filePath}: file resolves to "${route}" but declares "${definition.id}".`,
        );
      }
      if (config.kind === "layer") {
        addUnique(native.layers, [value as FoundryLayer], "layer");
      } else {
        addUnique(
          native.subscribers,
          [value as FoundrySubscriber],
          "subscriber",
        );
      }
      nativeFiles.push({
        kind: config.kind,
        id: definition.id,
        filePath,
        relativePath: normalizePath(relative(options.rootDir, filePath)),
      });
    }
  }

  return {
    capabilities: Object.freeze({
      tools: Object.freeze(registry.tools),
      applications: Object.freeze(registry.applications),
      mcp: Object.freeze(registry.mcp),
      memory: Object.freeze(registry.memory),
    }),
    native: Object.freeze({
      layers: Object.freeze(native.layers),
      subscribers: Object.freeze(native.subscribers),
    }),
    files: Object.freeze(files),
    nativeFiles: Object.freeze(nativeFiles),
  };
}
