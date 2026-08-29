import { readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defineAgentFromModule,
  internalAgentName,
  type FoundryAgentConventionModule,
  type FoundryAgentDefinition,
} from "./definition.js";
import { FOUNDRY_LAYER_BRAND } from "./surfaces.js";
import {
  FOUNDRY_AGENT_APPLICATION_BRAND,
  FOUNDRY_MCP_BRAND,
  FOUNDRY_MEMORY_BRAND,
  FOUNDRY_SHARED_TOOL_BRAND,
} from "./capabilities.js";
import { FOUNDRY_CONNECTION_BRAND } from "./connection.js";
import {
  FOUNDRY_TRANSMISSION_BRAND,
  FOUNDRY_TRANSMISSION_EVENT_BRAND,
  FOUNDRY_TRANSMISSION_PREDICATE_BRAND,
} from "./integration.js";
import { FOUNDRY_SUBSCRIBER_BRAND } from "./surfaces.js";
import { FOUNDRY_PLAYBOOK_ACTION_BRAND } from "./playbook.js";
import { FOUNDRY_PLAYBOOK_SUBSCRIPTION_BRAND } from "./subscription.js";
import {
  bindFileIdentity,
  type FoundryFileDefinitionKind,
} from "./identity.js";

const AGENT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);

const LOCAL_DEFINITION_FILES: ReadonlyArray<{
  readonly suffix: string;
  readonly kind: FoundryFileDefinitionKind;
  readonly brand: symbol;
}> = [
  { suffix: ".action", kind: "action", brand: FOUNDRY_PLAYBOOK_ACTION_BRAND },
  { suffix: ".app", kind: "application", brand: FOUNDRY_AGENT_APPLICATION_BRAND },
  { suffix: ".connection", kind: "connection", brand: FOUNDRY_CONNECTION_BRAND },
  { suffix: ".event", kind: "event", brand: FOUNDRY_TRANSMISSION_EVENT_BRAND },
  { suffix: ".layer", kind: "layer", brand: FOUNDRY_LAYER_BRAND },
  { suffix: ".mcp", kind: "mcp", brand: FOUNDRY_MCP_BRAND },
  { suffix: ".memory", kind: "memory", brand: FOUNDRY_MEMORY_BRAND },
  { suffix: ".predicate", kind: "predicate", brand: FOUNDRY_TRANSMISSION_PREDICATE_BRAND },
  { suffix: ".subscriber", kind: "subscriber", brand: FOUNDRY_SUBSCRIBER_BRAND },
  { suffix: ".subscription", kind: "subscription", brand: FOUNDRY_PLAYBOOK_SUBSCRIPTION_BRAND },
  { suffix: ".tool", kind: "tool", brand: FOUNDRY_SHARED_TOOL_BRAND },
  { suffix: ".transmission", kind: "transmission", brand: FOUNDRY_TRANSMISSION_BRAND },
];

export interface DiscoveredAgent {
  route: string;
  filePath: string;
  relativePath: string;
  definition: FoundryAgentDefinition;
  executionName: string;
}

export interface FoundryManifestAgent {
  id: string;
  description: string;
  mode: "agent";
  file: string;
  tags: readonly string[];
  invocationContract: "foundry/request-v1";
  resultContract: "foundry/result-v1";
  assembly: "foundry" | "custom";
  handler: "glove" | "custom";
  layers: readonly string[];
  subscribers: readonly string[];
  tools: readonly string[];
  hooks: readonly string[];
  skills: readonly string[];
  subagents: readonly string[];
  memory: readonly string[];
  inboxLoader: boolean;
  calls: readonly string[];
  schedules: readonly string[];
  playbooks: readonly string[];
  mesh: boolean;
  workingEnvironment: boolean;
  repl: "javascript" | "python" | "lisp" | "dynamic" | null;
  lazy: readonly string[];
}

export interface FoundryManifest {
  version: 1;
  generatedAt: string;
  agents: FoundryManifestAgent[];
}

function hasAgentExtension(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  return AGENT_EXTENSIONS.has(extname(file));
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function localDefinitionRoute(agentDirectory: string, filePath: string, suffix: string): string {
  const relativePath = normalizePath(relative(agentDirectory, filePath));
  const extension = extname(relativePath);
  const withoutSuffix = relativePath.slice(0, -extension.length - suffix.length);
  const segments = withoutSuffix.split("/");
  if (["actions", "apps", "connections", "events", "layers", "mcp", "memory", "playbooks", "predicates", "subscribers", "subscriptions", "tools", "transmissions"].includes(segments[0] ?? "")) {
    segments.shift();
  }
  return segments.join("/");
}

/** @internal Bind colocated convention definitions in an execution process. */
export async function bindAgentLocalDefinitions(
  agentDirectory: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(agentDirectory, { recursive: true });
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    if (entry.endsWith(".d.ts")) continue;
    const extension = extname(entry);
    if (!AGENT_EXTENSIONS.has(extension)) continue;
    const matched = LOCAL_DEFINITION_FILES.find(({ suffix }) =>
      entry.slice(0, -extension.length).endsWith(suffix),
    );
    if (!matched) continue;
    const filePath = resolve(agentDirectory, entry);
    const url = pathToFileURL(filePath);
    const imported = (await import(url.href)) as { default?: unknown };
    const value = imported.default;
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<PropertyKey, unknown>)[matched.brand] !== true
    ) {
      throw new Error(
        `${normalizePath(relative(agentDirectory, filePath))} must default-export its Foundry ${matched.kind} definition so the file can own its identity.`,
      );
    }
    const route = localDefinitionRoute(agentDirectory, filePath, matched.suffix);
    bindFileIdentity(value, route, matched.kind);
  }
}

export function routeFromAgentFile(
  agentsDir: string,
  filePath: string,
): string | null {
  const rel = normalizePath(relative(agentsDir, filePath));
  if (rel.startsWith("../") || rel === "..") return null;
  const extension = extname(rel);
  if (!AGENT_EXTENSIONS.has(extension)) return null;
  const withoutExtension = rel.slice(0, -extension.length);
  if (withoutExtension === "agent") return "default";
  if (withoutExtension.endsWith("/agent")) {
    return withoutExtension.slice(0, -"/agent".length);
  }
  if (withoutExtension.endsWith(".agent")) {
    return withoutExtension.slice(0, -".agent".length);
  }
  return null;
}

export async function findAgentFiles(agentsDir: string): Promise<string[]> {
  const absolute = resolve(agentsDir);
  let entries: string[];
  try {
    entries = await readdir(absolute, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read Foundry agents directory ${absolute}: ${message}`);
  }
  return entries
    .filter((entry) => hasAgentExtension(entry))
    .map((entry) => resolve(absolute, entry))
    .filter((file) => routeFromAgentFile(absolute, file) !== null)
    .sort();
}

export async function discoverAgents(options: {
  agentsDir: string;
  strictFileRoutes?: boolean;
  cacheBust?: boolean;
}): Promise<DiscoveredAgent[]> {
  const agentsDir = resolve(options.agentsDir);
  const files = await findAgentFiles(agentsDir);
  const discovered: DiscoveredAgent[] = [];
  const seen = new Map<string, string>();

  for (const filePath of files) {
    const route = routeFromAgentFile(agentsDir, filePath);
    if (!route) continue;
    const url = pathToFileURL(filePath);
    if (options.cacheBust) url.searchParams.set("t", String(Date.now()));
    const imported = (await import(url.href)) as FoundryAgentConventionModule;
    if (
      imported.id &&
      (options.strictFileRoutes ?? true) &&
      imported.id !== route
    ) {
      throw new Error(
        `Foundry route mismatch in ${filePath}: file resolves to "${route}" but the agent declares "${imported.id}".`,
      );
    }
    const definition = defineAgentFromModule(route, imported);
    await bindAgentLocalDefinitions(
      dirname(filePath),
    );
    const prior = seen.get(route);
    if (prior) {
      throw new Error(
        `Duplicate Foundry agent id "${route}" in ${prior} and ${filePath}.`,
      );
    }
    seen.set(route, filePath);
    discovered.push({
      route,
      filePath,
      relativePath: normalizePath(relative(agentsDir, filePath)),
      definition,
      executionName: internalAgentName(route),
    });
  }
  return discovered;
}

export function createManifest(
  agents: readonly DiscoveredAgent[],
): FoundryManifest {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    agents: agents.map(({ route, definition, relativePath }) => ({
      id: route,
      description: definition.description,
      mode: "agent" as const,
      file: relativePath,
      tags: definition.tags ?? [],
      invocationContract: "foundry/request-v1" as const,
      resultContract: "foundry/result-v1" as const,
      assembly: "foundry" as const,
      handler: definition.run || definition.handler || definition.spawn ? "custom" as const : "glove" as const,
      layers: (typeof definition.layers === "function" ? [] : definition.layers ?? []).map((selection) =>
        FOUNDRY_LAYER_BRAND in selection ? selection.id : selection.layer.id,
      ),
      subscribers: (typeof definition.subscribers === "function" ? [] : definition.subscribers ?? []).flatMap((subscriber) =>
        "id" in subscriber
            ? [String(subscriber.id)]
            : [],
      ),
      tools: (typeof definition.tools === "function" ? [] : definition.tools ?? []).map((tool) => tool.name),
      hooks: (typeof definition.hooks === "function" ? [] : definition.hooks ?? []).map((hook) => hook.name),
      skills: (typeof definition.skills === "function" ? [] : definition.skills ?? []).map((skill) => skill.name),
      subagents: (typeof definition.subagents === "function" ? [] : definition.subagents ?? []).map(
        (subagent) => subagent.name,
      ),
      memory: (typeof definition.memory === "function" ? [] : definition.memory ?? []).map(
        (selection) => {
          const profile = "profile" in selection ? selection.profile : selection;
          return profile.id;
        },
      ),
      inboxLoader: definition.inboxes !== undefined,
      calls: (typeof definition.calls === "function" ? [] : definition.calls ?? []).map(
        (call) => call.name,
      ),
      schedules: (typeof definition.schedules === "function" ? [] : definition.schedules ?? []).map(
        (schedule) => schedule.name,
      ),
      playbooks: (typeof definition.playbooks === "function" ? [] : definition.playbooks ?? []).map(
        (playbook) => playbook.name,
      ),
      mesh: definition.mesh !== undefined,
      workingEnvironment: definition.workingEnvironment !== undefined,
      repl: definition.repl === undefined
        ? null
        : typeof definition.repl === "function"
          ? "dynamic" as const
          : definition.repl.language,
      lazy: [
        "model", "systemPrompt", "displayManager", "compactionLimit",
        "compactionInstructions", "maxTurns", "tools", "hooks", "skills",
        "subagents", "memory", "inboxes", "subscribers", "layers", "calls", "schedules", "playbooks", "mesh",
        "workingEnvironment", "repl",
      ].filter((field) => typeof definition[field as keyof typeof definition] === "function"),
    })),
  };
}
